"""全系统数据一致性审计"""
import paramiko
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('jfzhu8023.cloud', 22, 'root', 'zhujunfeng391.')

def run(cmd, desc=''):
    if desc: print(f'\n>>> {desc}')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace').strip()
    if out: print(f'  {out[:800]}')

# 1. 检查 work_records 中 product_managers 是否有重复值
print('='*60)
print('审计 1: work_records.product_managers 重复值检查')
print('='*60)
run('''mysql -u root -pzhujunfeng391. devtracker -e "SELECT id, product_managers FROM work_records WHERE product_managers LIKE '%其他-昆仑%' OR product_managers LIKE '%其他-运维%' OR product_managers LIKE '%其他-架构%' ORDER BY product_managers;"''',
    '含目标PM的记录详情')

# 2. 检查是否有同一条记录中 PM 重复
run('''mysql -u root -pzhujunfeng391. devtracker -e "SELECT id, product_managers FROM work_records WHERE product_managers IS NOT NULL AND product_managers != '[]' LIMIT 30;"''',
    '前30条 work_records PM 数据')

# 3. product_managers 表当前列表
run('''mysql -u root -pzhujunfeng391. devtracker -e "SELECT id, name, is_active, sort_order FROM product_managers ORDER BY sort_order;"''',
    'product_managers 表全量')

# 4. match_groups.product_managers 中出现的所有 PM 名
run('''mysql -u root -pzhujunfeng391. devtracker -e "SELECT DISTINCT product_managers FROM match_groups WHERE product_managers IS NOT NULL LIMIT 40;"''',
    'match_groups 中出现的所有 PM 名')

# 5. 检查 product_managers 表中是否有新增的两个 PM
run('''mysql -u root -pzhujunfeng391. devtracker -e "SELECT COUNT(*) AS total FROM product_managers;"''',
    'PM 总数')

ssh.close()
print('\n✅ 审计完成')
