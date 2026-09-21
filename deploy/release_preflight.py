#!/usr/bin/env python3
"""Read-only production preflight: compare the running code with a local git ref.

Never mutates the server. Prints pm2/health state, table counts, and the set of
files under backend/src + frontend/dist whose sha256 differs from `git show <ref>`.
Usage: python deploy/release_preflight.py [git-ref=v3.4.0]
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import paramiko

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deploy import SERVER_HOST, SERVER_PASSWORD, SERVER_PORT, SERVER_USER, REMOTE_ROOT, REMOTE_BACKEND, PM2_APP  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
sys.stdout.reconfigure(encoding='utf-8', errors='replace')


def sh(ssh, cmd, timeout=120):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    text = out.read().decode('utf-8', 'replace')
    code = out.channel.recv_exit_status()
    if code != 0:
        raise RuntimeError(f'{cmd[:80]} -> exit {code}: {err.read().decode("utf-8", "replace").strip()}')
    return text.strip()


def remote_hashes(ssh, subdir):
    # Line endings are normalised (CR stripped) on both sides: production files were uploaded from Windows.
    text = sh(ssh, f"cd {REMOTE_ROOT} && find {subdir} -type f | sort | while read f; do printf '%s  %s\\n' \"$(tr -d '\\r' < \"$f\" | sha256sum | cut -d' ' -f1)\" \"$f\"; done")
    return {line.split('  ', 1)[1]: line.split('  ', 1)[0] for line in text.splitlines() if '  ' in line}


def git_tree_hashes(ref, prefix):
    files = subprocess.run(['git', 'ls-tree', '-r', '--name-only', ref, prefix], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    result = {}
    for f in files:
        blob = subprocess.run(['git', 'show', f'{ref}:{f}'], cwd=ROOT, capture_output=True, check=True).stdout
        import hashlib
        result[f] = hashlib.sha256(blob.replace(b'\r', b'')).hexdigest()
    return result


def main():
    ref = sys.argv[1] if len(sys.argv) > 1 else 'v3.4.0'
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SERVER_HOST, SERVER_PORT, SERVER_USER, SERVER_PASSWORD, timeout=30)

    report = {'ref': ref}
    report['health'] = sh(ssh, 'curl -s http://127.0.0.1:3001/api/health')
    report['pm2'] = sh(ssh, f'pm2 jlist | python3 -c "import sys,json; a=[p for p in json.load(sys.stdin) if p[\'name\']==\'{PM2_APP}\']; print(json.dumps([{{\'pid\':p[\'pid\'],\'status\':p[\'pm2_env\'][\'status\'],\'restarts\':p[\'pm2_env\'][\'restart_time\'],\'uptime\':p[\'pm2_env\'].get(\'pm_uptime\')}} for p in a]))"')
    report['layout'] = sh(ssh, f'ls -la {REMOTE_ROOT} {REMOTE_ROOT}/frontend {REMOTE_ROOT}/.release-backups 2>&1')
    report['node'] = sh(ssh, 'node -v')
    report['disk'] = sh(ssh, f'df -h {REMOTE_ROOT} | tail -1')
    env = f'set -a; . {REMOTE_BACKEND}/.env; set +a; '
    mysql = env + 'MYSQL_PWD="$DB_PASS" mysql -h "${DB_HOST:-localhost}" -P "${DB_PORT:-3306}" -u "$DB_USER" --batch --skip-column-names "$DB_NAME" -e '
    tables = sh(ssh, mysql + "'SHOW TABLES'").split()
    counts = {}
    for t in tables:
        counts[t] = int(sh(ssh, mysql + f"'SELECT COUNT(*) FROM `{t}`'"))
    report['tables'] = counts
    report['work_hours'] = sh(ssh, mysql + "'SELECT COUNT(*), COALESCE(SUM(hours),0) FROM work_records'")

    diffs = {}
    for prefix in ('backend/src', 'backend/package.json', 'backend/scripts'):
        remote = remote_hashes(ssh, prefix)
        local = git_tree_hashes(ref, prefix)
        changed = sorted(f for f in set(remote) | set(local) if remote.get(f) != local.get(f))
        diffs[prefix] = {'remote_files': len(remote), 'ref_files': len(local), 'mismatch': changed}
    report['code_vs_ref'] = diffs
    ssh.close()

    out = ROOT / 'docs' / '@test' / 'production_release_20260921' / 'preflight.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
