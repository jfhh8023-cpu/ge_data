#!/usr/bin/env python3
"""Run read-only diagnostic commands on production and print output.
Usage: python deploy/prod_shell.py "cmd1" "cmd2" ...
"""
from __future__ import annotations

import sys
from pathlib import Path

import paramiko

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deploy import SERVER_HOST, SERVER_PASSWORD, SERVER_PORT, SERVER_USER  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', errors='replace')


def main() -> None:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SERVER_HOST, SERVER_PORT, SERVER_USER, SERVER_PASSWORD, timeout=30)
    args = sys.argv[1:]
    if len(args) == 2 and args[0] == '-f':
        args = [Path(args[1]).read_text(encoding='utf-8')]
    for cmd in args:
        _, out, err = ssh.exec_command(cmd, timeout=120)
        print(f'>>> {cmd}')
        print(out.read().decode('utf-8', 'replace'))
        e = err.read().decode('utf-8', 'replace').strip()
        if e:
            print('[stderr]', e[:500])
    ssh.close()


if __name__ == '__main__':
    main()
