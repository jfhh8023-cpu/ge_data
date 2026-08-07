#!/usr/bin/env python3
"""Copy a read-only production database snapshot into the local dev database.

Production safety contract:
- remote commands are limited to SHOW/SELECT and mysqldump;
- the dump is streamed over SSH and never written to the production filesystem;
- no production migration, import, DDL, service restart, or file mutation is performed.

The local database is backed up before it is replaced. Run this script only while
the local DevTracker backend is stopped.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
from datetime import datetime

import paramiko
import pymysql

from deploy import SERVER_HOST, SERVER_PASSWORD, SERVER_PORT, SERVER_USER, REMOTE_BACKEND


ROOT = Path(__file__).resolve().parents[1]
BACKEND_ENV = ROOT / 'backend' / '.env'
BACKUP_ROOT = ROOT / 'deploy' / 'backups'
EXPECTED_LOCAL_DATABASE = 'devtracker'
LOCAL_HOSTS = {'localhost', '127.0.0.1', '::1'}
SAFE_TABLE_NAME = re.compile(r'^[A-Za-z0-9_]+$')


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def find_mysql_binary(name: str) -> str:
    candidates = [
        shutil.which(name),
        str(Path(r'C:\Program Files\MySQL\MySQL Server 8.0\bin') / f'{name}.exe'),
        str(Path(r'C:\Program Files\MySQL\MySQL Workbench 8.0') / f'{name}.exe'),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise RuntimeError(f'Cannot find local {name} executable')


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest().upper()


def mysql_env(password: str) -> dict[str, str]:
    env = os.environ.copy()
    env['MYSQL_PWD'] = password
    return env


def local_connection(config: dict[str, str], database: str | None = None):
    return pymysql.connect(
        host=config['DB_HOST'],
        port=int(config.get('DB_PORT', '3306')),
        user=config['DB_USER'],
        password=config['DB_PASS'],
        database=database,
        charset='utf8mb4',
        autocommit=True,
    )


def database_manifest(connection) -> dict[str, int]:
    with connection.cursor() as cursor:
        cursor.execute('SHOW TABLES')
        tables = [row[0] for row in cursor.fetchall()]
        result: dict[str, int] = {}
        for table in tables:
            if not SAFE_TABLE_NAME.fullmatch(table):
                raise RuntimeError(f'Unsafe table name returned by database: {table!r}')
            cursor.execute(f'SELECT COUNT(*) FROM `{table}`')
            result[table] = int(cursor.fetchone()[0])
        return result


def local_core_metrics(config: dict[str, str]) -> dict[str, float | int]:
    with local_connection(config, config['DB_NAME']) as connection:
        with connection.cursor() as cursor:
            cursor.execute('SELECT COUNT(*), COALESCE(SUM(hours), 0) FROM work_records')
            record_count, total_hours = cursor.fetchone()
            cursor.execute('SELECT COUNT(*) FROM staff')
            staff_count = cursor.fetchone()[0]
            cursor.execute('SELECT COUNT(*) FROM collection_tasks')
            task_count = cursor.fetchone()[0]
            cursor.execute('SELECT COUNT(*) FROM product_managers')
            pm_count = cursor.fetchone()[0]
            cursor.execute('SELECT COUNT(*) FROM match_groups')
            group_count = cursor.fetchone()[0]
    return {
        'collection_tasks': int(task_count),
        'staff': int(staff_count),
        'product_managers': int(pm_count),
        'work_records': int(record_count),
        'match_groups': int(group_count),
        'total_hours': float(total_hours),
    }


def remote_prefix() -> str:
    env_path = shlex.quote(f'{REMOTE_BACKEND}/.env')
    return f'set -a; . {env_path}; set +a; '


def remote_mysql_command(query: str) -> str:
    return (
        remote_prefix()
        + 'MYSQL_PWD="$DB_PASS" mysql '
        + '-h "${DB_HOST:-localhost}" -P "${DB_PORT:-3306}" -u "$DB_USER" '
        + '--batch --skip-column-names "$DB_NAME" -e '
        + shlex.quote(query)
    )


def ssh_exec_text(ssh: paramiko.SSHClient, command: str) -> str:
    _, stdout, stderr = ssh.exec_command(command, timeout=180)
    output = stdout.read().decode('utf-8', errors='replace')
    error = stderr.read().decode('utf-8', errors='replace')
    code = stdout.channel.recv_exit_status()
    if code != 0:
        raise RuntimeError(f'Remote read-only command failed with exit {code}: {error.strip()}')
    return output.strip()


def remote_manifest(ssh: paramiko.SSHClient) -> dict[str, int]:
    table_output = ssh_exec_text(ssh, remote_mysql_command('SHOW TABLES'))
    tables = [line.strip() for line in table_output.splitlines() if line.strip()]
    result: dict[str, int] = {}
    for table in tables:
        if not SAFE_TABLE_NAME.fullmatch(table):
            raise RuntimeError(f'Unsafe production table name: {table!r}')
        count = ssh_exec_text(ssh, remote_mysql_command(f'SELECT COUNT(*) FROM `{table}`'))
        result[table] = int(count)
    return result


def remote_core_metrics(ssh: paramiko.SSHClient) -> dict[str, float | int]:
    query = (
        "SELECT "
        "(SELECT COUNT(*) FROM collection_tasks),"
        "(SELECT COUNT(*) FROM staff),"
        "(SELECT COUNT(*) FROM product_managers),"
        "(SELECT COUNT(*) FROM work_records),"
        "(SELECT COUNT(*) FROM match_groups),"
        "(SELECT COALESCE(SUM(hours), 0) FROM work_records)"
    )
    values = ssh_exec_text(ssh, remote_mysql_command(query)).split('\t')
    if len(values) != 6:
        raise RuntimeError(f'Unexpected production metrics output: {values!r}')
    return {
        'collection_tasks': int(values[0]),
        'staff': int(values[1]),
        'product_managers': int(values[2]),
        'work_records': int(values[3]),
        'match_groups': int(values[4]),
        'total_hours': float(values[5]),
    }


def stream_production_dump(ssh: paramiko.SSHClient, target: Path) -> None:
    command = (
        remote_prefix()
        + 'exec env MYSQL_PWD="$DB_PASS" mysqldump '
        + '-h "${DB_HOST:-localhost}" -P "${DB_PORT:-3306}" -u "$DB_USER" '
        + '--single-transaction --skip-lock-tables --quick --routines --triggers --hex-blob '
        + '--databases "$DB_NAME"'
    )
    _, stdout, stderr = ssh.exec_command(command, timeout=300)
    with target.open('wb') as handle:
        while True:
            chunk = stdout.read(1024 * 1024)
            if not chunk:
                break
            handle.write(chunk)
    error = stderr.read().decode('utf-8', errors='replace')
    code = stdout.channel.recv_exit_status()
    if code != 0:
        raise RuntimeError(f'Production mysqldump failed with exit {code}: {error.strip()}')
    if target.stat().st_size < 100_000:
        raise RuntimeError(f'Production dump is unexpectedly small: {target.stat().st_size} bytes')
    tail = target.read_bytes()[-4096:].decode('utf-8', errors='replace')
    if 'Dump completed' not in tail:
        raise RuntimeError('Production dump completion marker is missing')


def dump_local_database(config: dict[str, str], mysqldump: str, target: Path) -> None:
    command = [
        mysqldump,
        '-h', config['DB_HOST'],
        '-P', config.get('DB_PORT', '3306'),
        '-u', config['DB_USER'],
        '--single-transaction',
        '--skip-lock-tables',
        '--quick',
        '--routines',
        '--triggers',
        '--hex-blob',
        '--column-statistics=0',
        '--databases', config['DB_NAME'],
        f'--result-file={target}',
    ]
    result = subprocess.run(command, env=mysql_env(config['DB_PASS']), capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f'Local backup failed: {result.stderr.strip()}')
    if target.stat().st_size < 100_000:
        raise RuntimeError(f'Local backup is unexpectedly small: {target.stat().st_size} bytes')


def replace_local_database(config: dict[str, str], mysql: str, source: Path) -> None:
    with local_connection(config) as connection:
        with connection.cursor() as cursor:
            cursor.execute(f'DROP DATABASE IF EXISTS `{EXPECTED_LOCAL_DATABASE}`')
            cursor.execute(
                f'CREATE DATABASE `{EXPECTED_LOCAL_DATABASE}` '
                'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
            )
    command = [
        mysql,
        '-h', config['DB_HOST'],
        '-P', config.get('DB_PORT', '3306'),
        '-u', config['DB_USER'],
        '--default-character-set=utf8mb4',
    ]
    with source.open('rb') as stdin:
        result = subprocess.run(command, stdin=stdin, env=mysql_env(config['DB_PASS']), capture_output=True)
    if result.returncode != 0:
        error = result.stderr.decode('utf-8', errors='replace')
        raise RuntimeError(f'Local import failed: {error.strip()}')


def main() -> int:
    config = load_env(BACKEND_ENV)
    if config.get('DB_HOST') not in LOCAL_HOSTS:
        raise RuntimeError(f'Refusing to replace non-local host: {config.get("DB_HOST")!r}')
    if config.get('DB_NAME') != EXPECTED_LOCAL_DATABASE:
        raise RuntimeError(f'Refusing to replace unexpected database: {config.get("DB_NAME")!r}')

    mysql = find_mysql_binary('mysql')
    mysqldump = find_mysql_binary('mysqldump')
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_dir = BACKUP_ROOT / f'local_before_prod_sync_{timestamp}'
    backup_dir.mkdir(parents=True, exist_ok=False)
    local_backup = backup_dir / f'local_devtracker_before_sync_{timestamp}.sql'
    production_dump = backup_dir / f'production_devtracker_snapshot_{timestamp}.sql'
    manifest_path = backup_dir / 'sync_manifest.json'

    print(f'[1/6] Backing up local database to {local_backup}')
    local_before = local_core_metrics(config)
    dump_local_database(config, mysqldump, local_backup)

    print('[2/6] Connecting to production for read-only snapshot')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(
        SERVER_HOST,
        port=SERVER_PORT,
        username=SERVER_USER,
        password=SERVER_PASSWORD,
        timeout=15,
    )
    try:
        production_before = remote_core_metrics(ssh)
        print('[3/6] Streaming production mysqldump directly to local disk')
        stream_production_dump(ssh, production_dump)
        production_after = remote_core_metrics(ssh)
        production_tables_after = remote_manifest(ssh)
    finally:
        ssh.close()

    print('[4/6] Replacing local devtracker database from production snapshot')
    replace_local_database(config, mysql, production_dump)
    with local_connection(config, config['DB_NAME']) as connection:
        local_tables_after = database_manifest(connection)
    local_after = local_core_metrics(config)

    common_tables = sorted(set(production_tables_after) & set(local_tables_after))
    table_differences = {
        table: {
            'production_after_dump': production_tables_after[table],
            'local_snapshot': local_tables_after[table],
        }
        for table in common_tables
        if production_tables_after[table] != local_tables_after[table]
    }
    missing_local_tables = sorted(set(production_tables_after) - set(local_tables_after))

    manifest = {
        'timestamp': timestamp,
        'production_host': SERVER_HOST,
        'production_access': 'read-only SHOW/SELECT/mysqldump streamed over SSH',
        'production_before_dump': production_before,
        'production_after_dump': production_after,
        'local_before_sync': local_before,
        'local_after_import': local_after,
        'production_table_counts_after_dump': production_tables_after,
        'local_table_counts_after_import': local_tables_after,
        'table_count_differences': table_differences,
        'missing_local_tables': missing_local_tables,
        'production_changed_during_dump': production_before != production_after,
        'local_backup': str(local_backup),
        'local_backup_sha256': sha256(local_backup),
        'production_snapshot': str(production_dump),
        'production_snapshot_sha256': sha256(production_dump),
        'production_snapshot_bytes': production_dump.stat().st_size,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    print('[5/6] Validating imported snapshot')
    if missing_local_tables:
        raise RuntimeError(f'Local import is missing production tables: {missing_local_tables}')
    if production_before == production_after and local_after != production_after:
        raise RuntimeError(
            'Production was stable during dump but local core metrics do not match: '
            f'production={production_after}, local={local_after}'
        )
    if table_differences and production_before == production_after:
        raise RuntimeError(f'Table row counts do not match stable production: {table_differences}')

    print('[6/6] Sync complete')
    print(json.dumps({
        'backup_dir': str(backup_dir),
        'production_before_dump': production_before,
        'production_after_dump': production_after,
        'local_after_import': local_after,
        'production_changed_during_dump': manifest['production_changed_during_dump'],
        'table_count_differences': table_differences,
        'production_snapshot_sha256': manifest['production_snapshot_sha256'],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f'[ERROR] {error}', file=sys.stderr)
        raise
