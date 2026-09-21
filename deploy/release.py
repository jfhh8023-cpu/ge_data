#!/usr/bin/env python3
"""Restricted production release for DevTracker (conventions 14.1-14.4, 16).

Phases (run in order, each writes evidence under docs/@test/production_release_<date>/):

  python deploy/release.py backup   # mysqldump + application tar on the server, download, hash, rollback.sh
  python deploy/release.py deploy   # build frontend, stage + hash-verify, swap code only, pm2 restart, verify
  python deploy/release.py verify   # re-run post-release checks (health, pm2, table counts, public pages)

Safety contract:
- Only /opt/devtracker and the PM2 process `devtracker` are touched; .env, node_modules, Nginx and other projects are never modified.
- The database is only read (SHOW/SELECT/mysqldump). No import, DDL, DROP or TRUNCATE.
- Code switch is atomic per directory (mv/cp); if the health check fails the previous code is restored automatically.
- rollback.sh restores code only and preserves the database.
"""
from __future__ import annotations

import hashlib
import json
import os
import posixpath
import shlex
import stat
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import paramiko

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deploy import (  # noqa: E402
    PM2_APP, REMOTE_BACKEND, REMOTE_ROOT, SERVER_HOST, SERVER_PASSWORD, SERVER_PORT, SERVER_USER,
)

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = Path(__file__).resolve().parents[1]
RELEASE_DATE = os.environ.get('RELEASE_DATE') or datetime.now().strftime('%Y%m%d')
EVIDENCE = ROOT / 'docs' / '@test' / f'production_release_{RELEASE_DATE}'
LOCAL_BACKUPS = ROOT / 'deploy' / 'backups'
STATE_FILE = EVIDENCE / 'release-state.json'
PUBLIC_BASE = os.environ.get('DEVTRACKER_PUBLIC_BASE', f'https://{SERVER_HOST}/devtracker')
RELEASE_PATHS = ['backend/src', 'backend/package.json', 'backend/package-lock.json', 'frontend/dist']
NGINX_FILES = ['/etc/nginx/conf.d/unified.conf', '/etc/nginx/conf.d/sandilizi-ssl.conf']


# ----------------------------------------------------------------------------- helpers
def now_iso() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def write_json(name: str, data) -> None:
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / name).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'[evidence] {EVIDENCE / name}')


def load_state() -> dict:
    return json.loads(STATE_FILE.read_text(encoding='utf-8')) if STATE_FILE.exists() else {}


def save_state(**kwargs) -> None:
    state = load_state()
    state.update(kwargs)
    write_json(STATE_FILE.name, state)


def connect() -> paramiko.SSHClient:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SERVER_HOST, SERVER_PORT, SERVER_USER, SERVER_PASSWORD, timeout=30)
    return ssh


def sh(ssh: paramiko.SSHClient, cmd: str, timeout: int = 300, check: bool = True) -> str:
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    text = out.read().decode('utf-8', 'replace')
    error = err.read().decode('utf-8', 'replace')
    code = out.channel.recv_exit_status()
    if check and code != 0:
        raise RuntimeError(f'remote exit {code}: {cmd[:120]}\n{error.strip()}')
    return text.strip()


def env_prefix() -> str:
    return f'set -a; . {shlex.quote(REMOTE_BACKEND + "/.env")}; set +a; '


def mysql_cmd(query: str) -> str:
    return (env_prefix() + 'MYSQL_PWD="$DB_PASS" mysql -h "${DB_HOST:-localhost}" -P "${DB_PORT:-3306}" '
            '-u "$DB_USER" --batch --skip-column-names "$DB_NAME" -e ' + shlex.quote(query))


def db_snapshot(ssh) -> dict:
    tables = sh(ssh, mysql_cmd('SHOW TABLES')).split()
    counts = {t: int(sh(ssh, mysql_cmd(f'SELECT COUNT(*) FROM `{t}`'))) for t in tables}
    wr = sh(ssh, mysql_cmd('SELECT COUNT(*), COALESCE(SUM(hours),0), COALESCE(SUM(delivery_progress IS NULL),0), '
                           'COALESCE(SUM(delivery_progress = 0),0), COALESCE(SUM(CRC32(CONCAT_WS("|",id,task_id,staff_id,'
                           'IFNULL(version,""),IFNULL(requirement_title,""),hours,IFNULL(delivery_progress,"null")))),0) FROM work_records')).split('\t')
    return {
        'capturedAt': now_iso(),
        'tables': counts,
        'workRecords': {'count': int(wr[0]), 'hours': float(wr[1]), 'nullProgress': int(wr[2]),
                        'zeroProgress': int(wr[3]), 'fieldChecksum': wr[4]},
    }


def nginx_hashes(ssh) -> list[str]:
    return sh(ssh, 'sha256sum ' + ' '.join(NGINX_FILES), check=False).splitlines()


def pm2_state(ssh) -> dict:
    raw = sh(ssh, 'pm2 jlist')
    for proc in json.loads(raw[raw.index('['):]):
        if proc.get('name') == PM2_APP:
            env = proc['pm2_env']
            return {'name': PM2_APP, 'pid': proc.get('pid'), 'status': env.get('status'),
                    'restart_time': env.get('restart_time'), 'pm_uptime': env.get('pm_uptime')}
    return {'name': PM2_APP, 'status': 'missing'}


def health(ssh) -> dict:
    raw = sh(ssh, 'curl -s -m 5 http://127.0.0.1:3001/api/health', check=False)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {'raw': raw}


def public_checks(ssh) -> dict:
    result = {}
    for path in ('/api/health', '/', '/stats', '/tasks'):
        code = sh(ssh, f"curl -sk -m 15 -o /dev/null -w '%{{http_code}} %{{size_download}}' {shlex.quote(PUBLIC_BASE + path)}", check=False)
        status, _, size = code.partition(' ')
        result[path] = {'status': int(status or 0), 'bytes': int(size or 0)}
    return result


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def local_release_files() -> dict[str, Path]:
    files: dict[str, Path] = {}
    for rel in RELEASE_PATHS:
        p = ROOT / rel
        if p.is_file():
            files[rel] = p
        else:
            for f in sorted(p.rglob('*')):
                if f.is_file():
                    files[f.relative_to(ROOT).as_posix()] = f
    return files


def git(*args: str) -> str:
    return subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()


# ----------------------------------------------------------------------------- backup
ROLLBACK_SH = r'''#!/bin/sh
# Code-only rollback generated by deploy/release.py. Database is NOT touched.
set -eu
ROOT=__ROOT__
BK="$(cd "$(dirname "$0")" && pwd)"
TS=$(date +%Y%m%d_%H%M%S)
if [ "${1:-}" = "--check" ]; then
  tar -tzf "$BK/application.tar.gz" >/dev/null
  sha256sum -c "$BK/SHA256SUMS" >/dev/null
  echo "ROLLBACK_READY: code only; database preserved"
  exit 0
fi
cd "$ROOT"
for p in backend/src frontend/dist backend/package.json backend/package-lock.json; do
  [ -e "$p" ] && mv "$p" "$p.__rolledback_$TS"
done
tar -xzf "$BK/application.tar.gz" -C "$ROOT" backend/src backend/package.json backend/package-lock.json frontend/dist
pm2 restart __PM2__ >/dev/null
sleep 3
curl -s -m 5 http://127.0.0.1:3001/api/health
echo
echo "ROLLBACK_DONE: code restored from $BK; database preserved"
'''


def phase_backup() -> None:
    ssh = connect()
    ts = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
    remote_dir = f'{REMOTE_ROOT}/.release-backups/{ts}'
    local_dir = LOCAL_BACKUPS / f'release_{ts}'
    local_dir.mkdir(parents=True, exist_ok=True)
    print(f'[backup] remote {remote_dir} -> local {local_dir}')

    before = db_snapshot(ssh)
    before['pm2'] = pm2_state(ssh)
    before['health'] = health(ssh)
    before['nginxHashes'] = nginx_hashes(ssh)
    write_json('production-before.json', before)

    sh(ssh, f'mkdir -p {remote_dir} && chmod 700 {remote_dir}')
    sh(ssh, env_prefix() + 'MYSQL_PWD="$DB_PASS" mysqldump -h "${DB_HOST:-localhost}" -P "${DB_PORT:-3306}" -u "$DB_USER" '
            '--single-transaction --skip-lock-tables --quick --routines --triggers --hex-blob --databases "$DB_NAME" '
            f'| gzip -9 > {remote_dir}/database.sql.gz', timeout=600)
    dump_info = sh(ssh, f'zcat {remote_dir}/database.sql.gz | wc -c; zcat {remote_dir}/database.sql.gz | grep -c "^CREATE TABLE"; '
                        f'zcat {remote_dir}/database.sql.gz | tail -c 2000 | grep -c "Dump completed"').split()
    dump = {'sqlBytes': int(dump_info[0]), 'createTableCount': int(dump_info[1]), 'completed': dump_info[2] == '1'}
    if not dump['completed'] or dump['createTableCount'] < len(before['tables']):
        raise RuntimeError(f'database dump incomplete: {dump}')

    sh(ssh, f'cd {REMOTE_ROOT} && tar -czf {remote_dir}/application.tar.gz '
            '--exclude=backend/node_modules/.cache backend frontend/dist ecosystem.config.js', timeout=900)
    members = int(sh(ssh, f'tar -tzf {remote_dir}/application.tar.gz | wc -l'))
    required = ['backend/src/app.js', 'backend/.env', 'backend/package.json', 'backend/package-lock.json',
                'frontend/dist/index.html', 'ecosystem.config.js']
    listing = set(sh(ssh, f'tar -tzf {remote_dir}/application.tar.gz', timeout=600).splitlines())
    missing = [r for r in required if r not in listing]
    if missing:
        raise RuntimeError(f'application archive missing {missing}')

    script = ROLLBACK_SH.replace('__ROOT__', REMOTE_ROOT).replace('__PM2__', PM2_APP)
    sftp = ssh.open_sftp()
    with sftp.file(f'{remote_dir}/rollback.sh', 'w') as fh:
        fh.write(script)
    sftp.chmod(f'{remote_dir}/rollback.sh', 0o700)
    sh(ssh, f'cd {remote_dir} && sha256sum database.sql.gz application.tar.gz > SHA256SUMS && sh -n rollback.sh && ./rollback.sh --check')

    remote_hashes = dict(line.split()[::-1] for line in sh(ssh, f'cat {remote_dir}/SHA256SUMS').splitlines())
    files = {}
    for name in ('database.sql.gz', 'application.tar.gz', 'rollback.sh', 'SHA256SUMS'):
        sftp.get(f'{remote_dir}/{name}', str(local_dir / name))
        local_hash = sha256_file(local_dir / name)
        if name in remote_hashes and remote_hashes[name] != local_hash:
            raise RuntimeError(f'hash mismatch after download: {name}')
        files[name] = {'sha256': local_hash, 'bytes': (local_dir / name).stat().st_size}
    sftp.close()

    manifest = {
        'capturedAt': now_iso(), 'remoteDirectory': remote_dir, 'localDirectory': str(local_dir),
        'dump': dump, 'files': files, 'archive': {'memberCount': members, 'requiredFiles': required, 'includesDependencies': True},
        'codeRollbackPreservesDatabase': True, 'rollbackCheck': 'ROLLBACK_READY: code only; database preserved',
        'nginxHashes': before['nginxHashes'],
    }
    write_json('backup-manifest.json', manifest)
    save_state(backupRemoteDir=remote_dir, backupLocalDir=str(local_dir), backupTs=ts)
    ssh.close()
    print('[backup] OK')


# ----------------------------------------------------------------------------- deploy
def build_frontend() -> str:
    print('[deploy] building frontend')
    proc = subprocess.run('npm run build', cwd=ROOT / 'frontend', shell=True, capture_output=True, text=True)
    (EVIDENCE / 'build.log').write_text(proc.stdout + proc.stderr, encoding='utf-8')
    if proc.returncode != 0 or not (ROOT / 'frontend' / 'dist' / 'index.html').exists():
        raise RuntimeError('frontend build failed, see build.log')
    return proc.stdout.strip().splitlines()[-1]


def sftp_mkdirs(sftp, path: str) -> None:
    parts = path.split('/')
    cur = ''
    for part in parts:
        if not part:
            cur += '/'
            continue
        cur = posixpath.join(cur, part) if cur else part
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)


def phase_deploy() -> None:
    dirty = [l for l in git('status', '--porcelain', '--', 'backend/src', 'backend/package.json', 'backend/package-lock.json', 'frontend/src', 'frontend/package.json').splitlines()]
    if dirty:
        raise RuntimeError('release files have uncommitted changes:\n' + '\n'.join(dirty))
    commit = git('rev-parse', 'HEAD')
    version = json.loads((ROOT / 'backend' / 'package.json').read_text(encoding='utf-8'))['version']
    state = load_state()
    if not state.get('backupRemoteDir'):
        raise RuntimeError('run `backup` first')
    build_line = build_frontend()

    ssh = connect()
    ts = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')
    stage = f'{REMOTE_ROOT}/.release-stage/{commit[:12]}'
    print(f'[deploy] staging {version} {commit[:12]} -> {stage}')
    sh(ssh, f'rm -rf {stage} && mkdir -p {stage}')
    sftp = ssh.open_sftp()
    files = local_release_files()
    local_hashes = {}
    for rel, path in files.items():
        remote_path = f'{stage}/{rel}'
        sftp_mkdirs(sftp, posixpath.dirname(remote_path))
        sftp.put(str(path), remote_path)
        local_hashes[rel] = sha256_file(path)
    sftp.close()
    remote_text = sh(ssh, f'cd {stage} && find . -type f -print0 | xargs -0 sha256sum', timeout=300)
    remote_hashes = {line.split('  ', 1)[1][2:]: line.split('  ', 1)[0] for line in remote_text.splitlines()}
    mismatch = sorted(k for k in set(local_hashes) | set(remote_hashes) if local_hashes.get(k) != remote_hashes.get(k))
    if mismatch:
        raise RuntimeError(f'stage hash mismatch: {mismatch[:10]}')
    write_json('candidate-manifest.json', {'version': version, 'commit': commit, 'stageDirectory': stage,
                                           'fileCount': len(local_hashes), 'build': build_line, 'files': local_hashes})

    syntax = sh(ssh, f'cd {stage} && for f in $(find backend/src -name "*.js"); do node --check "$f" || exit 1; done; echo SYNTAX_OK; node -v')
    if 'SYNTAX_OK' not in syntax:
        raise RuntimeError(f'node syntax check failed: {syntax}')
    dep_same = sh(ssh, f'cd {REMOTE_ROOT} && python3 -c "import json,sys; a=json.load(open(\'backend/package.json\')); b=json.load(open(\'{stage}/backend/package.json\')); print(a.get(\'dependencies\')==b.get(\'dependencies\'))"')
    if dep_same != 'True':
        raise RuntimeError('backend dependencies changed; refusing to release without an explicit dependency plan')

    immediate_before = db_snapshot(ssh)
    immediate_before['nginxHashes'] = nginx_hashes(ssh)
    immediate_before['pm2'] = pm2_state(ssh)
    write_json('production-immediate-before.json', immediate_before)

    switch = f'''set -e
cd {REMOTE_ROOT}
mv backend/src backend/src.__prev_{ts}
cp -a {stage}/backend/src backend/src
cp -a backend/package.json backend/package.json.__prev_{ts}
cp -a backend/package-lock.json backend/package-lock.json.__prev_{ts}
cp {stage}/backend/package.json backend/package.json
cp {stage}/backend/package-lock.json backend/package-lock.json
mv frontend/dist frontend/dist.__prev_{ts}
cp -a {stage}/frontend/dist frontend/dist
pm2 restart {PM2_APP} --update-env >/dev/null
echo SWITCHED'''
    released_at = now_iso()
    print('[deploy] switching code and restarting pm2')
    out = sh(ssh, switch, timeout=120)
    if 'SWITCHED' not in out:
        raise RuntimeError(f'switch failed: {out}')

    ok = False
    for _ in range(20):
        time.sleep(1.5)
        h = health(ssh)
        if h.get('version') == version:
            ok = True
            break
    if not ok:
        print('[deploy] health check failed, restoring previous code')
        sh(ssh, f'''set -e
cd {REMOTE_ROOT}
rm -rf backend/src frontend/dist
mv backend/src.__prev_{ts} backend/src
mv frontend/dist.__prev_{ts} frontend/dist
cp backend/package.json.__prev_{ts} backend/package.json
cp backend/package-lock.json.__prev_{ts} backend/package-lock.json
pm2 restart {PM2_APP} >/dev/null''')
        write_json('deployment-result.json', {'releasedAt': released_at, 'version': version, 'commit': commit,
                                              'status': 'ROLLED_BACK_AUTOMATICALLY', 'health': health(ssh)})
        raise RuntimeError('release rolled back: health did not report new version')

    save_state(releasedAt=released_at, version=version, commit=commit, stage=stage, prevSuffix=ts)
    ssh.close()
    phase_verify(immediate_before=immediate_before)


# ----------------------------------------------------------------------------- verify
def phase_verify(immediate_before: dict | None = None) -> None:
    state = load_state()
    ssh = connect()
    time.sleep(3)
    after = db_snapshot(ssh)
    after['nginxHashes'] = nginx_hashes(ssh)
    after['pm2'] = pm2_state(ssh)
    after['health'] = health(ssh)
    after['public'] = public_checks(ssh)
    started_ms = after['pm2'].get('pm_uptime') or 0
    after['errorLogModifiedSinceStart'] = sh(
        ssh, f'python3 -c "import os; m=os.path.getmtime(\'{REMOTE_ROOT}/logs/error.log\')*1000; print(m > {started_ms})"', check=False)
    after['errorLogTail'] = sh(ssh, f'tail -n 5 {REMOTE_ROOT}/logs/error.log', check=False)
    after['otherPm2Processes'] = sh(ssh, "pm2 jlist | python3 -c \"import sys,json; print([(p['name'],p['pm2_env']['status']) for p in json.load(sys.stdin)])\"", check=False)
    write_json('production-after.json', after)

    before = immediate_before or json.loads((EVIDENCE / 'production-immediate-before.json').read_text(encoding='utf-8'))
    changed = {t: (before['tables'].get(t), after['tables'].get(t)) for t in set(before['tables']) | set(after['tables'])
               if before['tables'].get(t) != after['tables'].get(t)}
    result = {
        'releasedAt': state.get('releasedAt'), 'version': state.get('version'), 'commit': state.get('commit'),
        'checkedAt': after['capturedAt'],
        'health': after['health'], 'pm2': after['pm2'], 'public': after['public'],
        'healthVersionMatches': after['health'].get('version') == state.get('version'),
        'tableCountsChanged': changed,
        'workRecordsBefore': before['workRecords'], 'workRecordsAfter': after['workRecords'],
        'workRecordsPreserved': before['workRecords'] == after['workRecords'],
        'nginxUnchanged': before.get('nginxHashes') == after['nginxHashes'],
        'errorLogModifiedSinceStart': after['errorLogModifiedSinceStart'],
        'rollbackScript': f"{state.get('backupRemoteDir')}/rollback.sh",
        'previousCodeKept': f"backend/src.__prev_{state.get('prevSuffix')}, frontend/dist.__prev_{state.get('prevSuffix')}",
    }
    write_json('deployment-result.json', result)
    ssh.close()
    status = 'PASS' if result['healthVersionMatches'] and result['workRecordsPreserved'] and result['nginxUnchanged'] and after['pm2'].get('status') == 'online' else 'CHECK'
    print(f'[verify] {status}: health={after["health"]} pm2={after["pm2"].get("status")} public={after["public"]} tablesChanged={changed}')


if __name__ == '__main__':
    phase = sys.argv[1] if len(sys.argv) > 1 else ''
    {'backup': phase_backup, 'deploy': phase_deploy, 'verify': phase_verify}.get(phase, lambda: print(__doc__))()
