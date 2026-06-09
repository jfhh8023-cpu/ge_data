"""查看生产服务器 devtracker 错误日志"""
import paramiko
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('jfzhu8023.cloud', 22, 'root', 'zhujunfeng391.')

# 查看 pm2 错误日志最后50行
print('>>> pm2 error logs:')
stdin, stdout, stderr = ssh.exec_command('pm2 logs devtracker --err --lines 50 --nostream', timeout=15)
out = stdout.read().decode('utf-8', errors='replace')
print(out)

ssh.close()
