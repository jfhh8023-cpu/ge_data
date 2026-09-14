"""First installation on the explicitly selected local VM; no business-data import."""

import getpass
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import shlex
import subprocess
import tarfile
import time
from datetime import datetime

import paramiko


ROOT = Path(__file__).resolve().parents[1]
HOST = "192.168.17.133"
TARGET = "/opt/devtracker"
STAMP = datetime.now().strftime("%Y%m%d_%H%M%S")
EVIDENCE = ROOT / ".codex-local" / "vm-deployment" / STAMP
BACKUP = f"/opt/devtracker-deployment-backups/{STAMP}"
NGINX_PATH = "/etc/nginx/conf.d/devtracker-vm.conf"


def build_archive():
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    tracked_changes = subprocess.check_output(
        ["git", "status", "--porcelain", "--", "backend/src", "frontend/src", "frontend/vite.config.js"],
        cwd=ROOT, text=True,
    ).strip()
    if tracked_changes:
        raise RuntimeError("Application sources must match the verified commit before packaging")
    archive = EVIDENCE / "release.tar"
    subprocess.run([
        "git", "archive", "--format=tar", f"--output={archive}", "HEAD",
        "backend/src", "backend/package.json", "backend/package-lock.json", "deploy/ecosystem.config.js",
    ], cwd=ROOT, check=True)
    dist = ROOT / "frontend" / "dist"
    if not (dist / "index.html").is_file():
        raise RuntimeError("Build frontend before running this installer")
    with tarfile.open(archive, "a") as bundle:
        bundle.add(dist, arcname="frontend/dist")
    manifest = {}
    with tarfile.open(archive, "r") as bundle:
        for member in bundle.getmembers():
            if member.isfile():
                manifest[member.name] = hashlib.sha256(bundle.extractfile(member).read()).hexdigest()
    (EVIDENCE / "manifest.json").write_text(json.dumps({"commit": commit, "files": manifest}, indent=2), encoding="utf-8")
    return commit, archive, manifest


def main():
    commit, archive, manifest = build_archive()
    ssh = paramiko.SSHClient()
    ssh.load_host_keys(str(Path.home() / ".ssh" / "known_hosts"))
    ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
    ssh.connect(HOST, username="root", password=getpass.getpass("VM SSH password: "),
                look_for_keys=False, allow_agent=False, timeout=15)
    sftp = ssh.open_sftp()

    def run(label, command, input_text=None, timeout=180, show=True):
        print(label, flush=True)
        started = time.monotonic()
        stdin, stdout, stderr = ssh.exec_command(command, timeout=timeout)
        if input_text is not None:
            stdin.write(input_text)
            stdin.flush()
        stdin.channel.shutdown_write()
        output = stdout.read().decode("utf-8", "replace")
        error = stderr.read().decode("utf-8", "replace")
        code = stdout.channel.recv_exit_status()
        result = {"step": label, "exit_code": code, "seconds": round(time.monotonic()-started, 2), "stdout": output, "stderr": error}
        with (EVIDENCE / "steps.jsonl").open("a", encoding="utf-8") as log:
            log.write(json.dumps(result, ensure_ascii=False) + "\n")
        if show and output.strip():
            print(output[-4000:], flush=True)
        if code:
            raise RuntimeError(f"{label} failed ({code}): {error[-1800:]} {output[-1800:]}")
        return output

    def write_remote(filename, content, mode=0o644):
        with sftp.open(filename, "w") as handle:
            handle.write(content)
        sftp.chmod(filename, mode)

    try:
        run("Preflight: refuse existing application, database, user or occupied ports", f"""
set -eu
test ! -e {TARGET}
test ! -e {NGINX_PATH}
test "$(mysql -uroot -N -B -e "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='devtracker'")" = 0
test "$(mysql -uroot -N -B -e "SELECT COUNT(*) FROM mysql.user WHERE User='devtracker_vm'")" = 0
test -z "$(ss -ltnH 'sport = :3001 or sport = :8088')"
nginx -t
node -v
""")
        before = run("Read existing service baseline", "curl -s -o /dev/null -w 'port80=%{http_code}\\n' http://127.0.0.1:80/; curl -s -o /dev/null -w 'port8020=%{http_code}\\n' http://127.0.0.1:8020/; docker ps --format '{{.Names}} {{.Image}}'; systemctl is-active mysqld nginx docker")
        run("Create application and private deployment record directories", f"mkdir -p {TARGET}/logs {BACKUP}; chmod 700 {BACKUP}")
        write_remote(f"{BACKUP}/baseline.txt", "No prior DevTracker directory or database.\n" + before, 0o600)
        sftp.put(str(archive), f"{TARGET}/release-{commit[:7]}.tar")
        run("Extract verified release", f"tar -xf {TARGET}/release-{commit[:7]}.tar -C {TARGET} --no-same-owner")
        write_remote(f"{TARGET}/release.sha256", "".join(f"{digest}  {filename}\n" for filename, digest in manifest.items()))
        run("Verify uploaded files", f"cd {TARGET} && sha256sum -c release.sha256", show=False)
        password = secrets.token_hex(24)
        sql = f"""CREATE DATABASE devtracker CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'devtracker_vm'@'127.0.0.1' IDENTIFIED BY '{password}';
CREATE USER 'devtracker_vm'@'localhost' IDENTIFIED BY '{password}';
GRANT ALL PRIVILEGES ON devtracker.* TO 'devtracker_vm'@'127.0.0.1';
GRANT ALL PRIVILEGES ON devtracker.* TO 'devtracker_vm'@'localhost';
"""
        run("Create isolated DevTracker database and application user", "mysql -uroot", input_text=sql)
        write_remote(f"{TARGET}/backend/.env", f"NODE_ENV=production\nPORT=3001\nDB_HOST=127.0.0.1\nDB_PORT=3306\nDB_NAME=devtracker\nDB_USER=devtracker_vm\nDB_PASS={password}\n", 0o600)
        run("Install locked backend dependencies", f"cd {TARGET}/backend && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev --no-audit --no-fund", timeout=300)
        init_js = "const {sequelize}=require('./src/models'); (async()=>{await sequelize.sync(); await sequelize.close(); console.log('Empty schema initialized');})().catch(e=>{console.error(e.message);process.exit(1);});"
        run("Initialize schema only in the new empty database", f"cd {TARGET}/backend && node -e {shlex.quote(init_js)}")
        run("Save initial schema backup", f"mysqldump -uroot --single-transaction --set-gtid-purged=OFF devtracker > {BACKUP}/devtracker-initial.sql && chmod 600 {BACKUP}/devtracker-initial.sql && test -s {BACKUP}/devtracker-initial.sql")
        write_remote(f"{TARGET}/RELEASE.json", json.dumps({"commit": commit, "deployed_at": STAMP, "host": HOST, "database": "fresh-empty", "frontend_package": "3.2.0", "backend_package": "3.3.0"}, indent=2))
        run("Start only the DevTracker process", f"pm2 start {TARGET}/deploy/ecosystem.config.js --only devtracker && pm2 save && pm2 startup systemd -u root --hp /root", timeout=90)
        for attempt in range(20):
            try:
                run("Wait for DevTracker API", "curl --fail --silent http://127.0.0.1:3001/api/health", timeout=10)
                break
            except RuntimeError:
                if attempt == 19:
                    run("Read startup errors", "pm2 logs devtracker --nostream --lines 35")
                    raise
                time.sleep(1)
        sftp.put(str(ROOT / "deploy" / "nginx-devtracker-vm.conf"), NGINX_PATH)
        run("Validate Nginx and reload its configuration", "nginx -t && systemctl reload nginx")
        run("Verify published API and UI", "curl --fail --silent http://127.0.0.1:8088/devtracker/api/health; curl --fail --silent -o /dev/null -w '\\nui=%{http_code}\\n' http://127.0.0.1:8088/devtracker/stats?admin=1")
        run("Verify database and process status", "mysql -uroot -N -B devtracker -e 'SELECT (SELECT COUNT(*) FROM staff), (SELECT COUNT(*) FROM work_records), (SELECT COUNT(*) FROM product_manager_work_records), (SELECT COUNT(*) FROM auto_task_rules), (SELECT COUNT(*) FROM staff_roles), (SELECT COUNT(*) FROM demand_sources);'; pm2 describe devtracker", show=True)
        after = run("Verify existing services remain available", "curl -s -o /dev/null -w 'port80=%{http_code}\\n' http://127.0.0.1:80/; curl -s -o /dev/null -w 'port8020=%{http_code}\\n' http://127.0.0.1:8020/; docker ps --format '{{.Names}} {{.Image}}'; systemctl is-active mysqld nginx docker")
        if before != after:
            raise RuntimeError("Existing service baseline changed; inspect deployment evidence")
        write_remote(f"{BACKUP}/result.json", json.dumps({"commit": commit, "status": "verified", "url": f"http://{HOST}:8088/devtracker/"}), 0o600)
        print(json.dumps({"status": "verified", "commit": commit, "evidence": str(EVIDENCE), "backup": BACKUP, "url": f"http://{HOST}:8088/devtracker/"}), flush=True)
    finally:
        sftp.close()
        ssh.close()


if __name__ == "__main__":
    main()
