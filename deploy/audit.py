"""深入检查 FillPage.js 内容 + 全系统 PM 彻查"""
import paramiko
import sys
import json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('jfzhu8023.cloud', 22, 'root', 'zhujunfeng391.')

def run(cmd, desc=''):
    if desc: print(f'\n>>> {desc}')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace').strip()
    if out: print(f'  {out[:1500]}')
    return out

# 1. FillPage JS 中搜索硬编码的 PM 名字
print('='*60)
print('1. FillPage.js 中搜索硬编码 PM 名字')
print('='*60)
for name in ['钟冠', '吴浩鑫', '杨瑞', '罗晓璇', '其他-昆仑', '不在上述']:
    out = run(f'grep -c "{name}" /opt/devtracker/frontend/dist/assets/FillPage-DX0QsLxx.js',
              f'FillPage.js 中 "{name}"')

# 2. 检查 FillPage.js 中是否有 /api/pm 请求
print('\n' + '='*60)
print('2. FillPage.js 中搜索 /pm 请求')
print('='*60)
run('grep -o "/pm[^\"]*" /opt/devtracker/frontend/dist/assets/FillPage-DX0QsLxx.js || echo "未找到"',
    'FillPage.js 中 /pm 路径')

# 3. 搜索 "api/pm" 在所有 JS 中
run('grep -l "api/pm" /opt/devtracker/frontend/dist/assets/*.js 2>/dev/null || echo "无"',
    '所有 JS 中含 api/pm 的文件')
run('grep -l "\"/pm\"" /opt/devtracker/frontend/dist/assets/*.js 2>/dev/null || echo "无"',
    '所有 JS 中含 /pm 的文件')

# 4. 在 FillPage.js 中搜索 Promise.all（新代码特征）
run('grep -c "Promise.all" /opt/devtracker/frontend/dist/assets/FillPage-DX0QsLxx.js',
    'FillPage.js 中 Promise.all')

# 5. 检查 FillPage.js 修改时间
run('ls -la /opt/devtracker/frontend/dist/assets/FillPage-DX0QsLxx.js',
    'FillPage.js 文件时间')

# 6. 直接从浏览器角度测试 PM API
run('curl -s "http://127.0.0.1:3001/api/pm" | python3 -m json.tool | head -30',
    '/api/pm JSON 格式化')

ssh.close()
print('\n✅ 完成')
