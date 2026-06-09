"""用原生 SQL 修复 work_records 和 match_groups 中的双重 JSON 转义"""
import paramiko
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('jfzhu8023.cloud', 22, 'root', 'zhujunfeng391.')

def run(cmd, desc=''):
    if desc: print(f'\n>>> {desc}')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if out: print(f'  {out[:800]}')
    if err and 'Warning' not in err: print(f'  ERR: {err[:200]}')
    return exit_code, out

# Step 1: 诊断双重转义数量 — 特征是值被引号包裹 如 "[\\"xx\\"]"
# JSON_TYPE 应为 ARRAY，如果是 STRING 说明被二次序列化了
print('='*60)
print('Step 1: 诊断双重转义')
print('='*60)

run('''mysql -u root -pzhujunfeng391. devtracker -e "SELECT COUNT(*) AS double_escaped_wr FROM work_records WHERE product_managers IS NOT NULL AND JSON_TYPE(product_managers) = 'STRING';"''',
    'work_records 中 JSON_TYPE=STRING 的记录数')

run('''mysql -u root -pzhujunfeng391. devtracker -e "SELECT COUNT(*) AS double_escaped_mg FROM match_groups WHERE product_managers IS NOT NULL AND JSON_TYPE(product_managers) = 'STRING';"''',
    'match_groups 中 JSON_TYPE=STRING 的记录数')

# Step 2: 修复 — 将 STRING 类型的值解析为 ARRAY
# 对于双重转义的值，CAST(JSON_UNQUOTE(product_managers) AS JSON) 可以得到正确的数组
print('\n' + '='*60)
print('Step 2: 修复双重转义')
print('='*60)

run('''mysql -u root -pzhujunfeng391. devtracker -e "UPDATE work_records SET product_managers = CAST(JSON_UNQUOTE(product_managers) AS JSON) WHERE product_managers IS NOT NULL AND JSON_TYPE(product_managers) = 'STRING';"''',
    '修复 work_records')

run('''mysql -u root -pzhujunfeng391. devtracker -e "UPDATE match_groups SET product_managers = CAST(JSON_UNQUOTE(product_managers) AS JSON) WHERE product_managers IS NOT NULL AND JSON_TYPE(product_managers) = 'STRING';"''',
    '修复 match_groups')

# Step 3: 验证修复
print('\n' + '='*60)
print('Step 3: 验证修复后 — 双重转义应为 0')
print('='*60)

run('''mysql -u root -pzhujunfeng391. devtracker -e "SELECT COUNT(*) AS remaining FROM work_records WHERE product_managers IS NOT NULL AND JSON_TYPE(product_managers) = 'STRING';"''',
    'work_records 残留')

run('''mysql -u root -pzhujunfeng391. devtracker -e "SELECT COUNT(*) AS remaining FROM match_groups WHERE product_managers IS NOT NULL AND JSON_TYPE(product_managers) = 'STRING';"''',
    'match_groups 残留')

# Step 4: 重新检查源 PM 数据（修复后可能发现之前被隐藏的记录）
print('\n' + '='*60)
print('Step 4: 修复后检查源 PM 残留')
print('='*60)

for pm in ['昆仑', '昆仑组', '运维安全组', '运维', '架构组', '运维组']:
    run(f'''mysql -u root -pzhujunfeng391. devtracker -e "SELECT 'wr' AS t, COUNT(*) AS c FROM work_records WHERE JSON_CONTAINS(product_managers, JSON_QUOTE('{pm}')) UNION ALL SELECT 'mg', COUNT(*) FROM match_groups WHERE JSON_CONTAINS(product_managers, JSON_QUOTE('{pm}'));"''',
        f'{pm}')

# Step 5: 如果有残留，再次执行交接
print('\n' + '='*60)
print('Step 5: 重新交接残留数据')
print('='*60)

MERGE_RULES = [
    ('昆仑', '4936cda4-5c28-4017-981a-256e4f0e10d4', '55c20032-1893-42e0-b83a-2053c0387077', '其他-昆仑'),
    ('昆仑组', '7af7a52c-fbbc-49d5-844b-c53a9d2e1ecf', '55c20032-1893-42e0-b83a-2053c0387077', '其他-昆仑'),
    ('运维安全组', 'a60231ed-7c9f-4f28-9d4d-cdeacdb7ab7a', 'eebb3643-cf89-4db8-bbf4-fa2d3e34db30', '其他-运维'),
    ('运维', 'faf9a108-a2ec-4beb-97b7-9cf0d69a5cb3', 'eebb3643-cf89-4db8-bbf4-fa2d3e34db30', '其他-运维'),
    ('运维组', 'eebb3643-cf89-4db8-bbf4-fa2d3e34db30', 'eebb3643-cf89-4db8-bbf4-fa2d3e34db30', '其他-运维'),  # 运维组 = 其他-运维 同一个人，跳过
    ('架构组', '0804ddb6-e89b-4cba-aaf8-48633a056fd2', '79e6eea7-734c-4e66-afbb-6ab00f3561bb', '其他-架构'),
]

for from_name, from_id, to_id, to_name in MERGE_RULES:
    if from_id == to_id:
        print(f'\n  [SKIP] {from_name} 就是 {to_name}，无需交接')
        continue
    cmd = f'curl -s -X POST http://127.0.0.1:3001/api/pm/{from_id}/transfer -H "Content-Type: application/json" -d \'{{"to_pm_id":"{to_id}"}}\''
    run(cmd, f'{from_name} → {to_name}')

# Step 6: 最终验证
print('\n' + '='*60)
print('Step 6: 最终验证（应全为 0）')
print('='*60)

for pm in ['昆仑', '昆仑组', '运维安全组', '运维', '架构组']:
    run(f'''mysql -u root -pzhujunfeng391. devtracker -e "SELECT 'wr' AS t, COUNT(*) AS c FROM work_records WHERE JSON_CONTAINS(product_managers, JSON_QUOTE('{pm}')) UNION ALL SELECT 'mg', COUNT(*) FROM match_groups WHERE JSON_CONTAINS(product_managers, JSON_QUOTE('{pm}'));"''',
        f'{pm}')

ssh.close()
print('\n✅ 完成')
