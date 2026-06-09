"""
生产环境 PM 数据合并：
1. 昆仑 + 昆仑组 → 其他-昆仑
2. 运维安全组 + 运维 → 运维组  (注意：用户说"其他—运维"，但实际PM列表有"运维组"，需确认)
3. 架构组 → 其他-架构
"""
import paramiko
import sys
import json

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('jfzhu8023.cloud', 22, 'root', 'zhujunfeng391.')


def run(cmd, desc=''):
    if desc:
        print(f'\n>>> {desc}')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if out:
        print(f'  OUT: {out.strip()[:800]}')
    if err:
        print(f'  ERR: {err.strip()[:300]}')
    return exit_code, out, err


# Step 0: 查看当前 PM 列表和各自的记录数
print('='*60)
print('Step 0: 查看当前 PM 列表')
print('='*60)
run('mysql -u root -pzhujunfeng391. devtracker -e "SELECT name, id FROM product_managers ORDER BY name;"',
    '当前 PM 列表')

# 查看各 PM 被引用的记录数
for pm_name in ['昆仑', '昆仑组', '其他-昆仑', '运维安全组', '运维', '运维组', '架构组', '其他-架构']:
    run(f'''mysql -u root -pzhujunfeng391. devtracker -e "SELECT COUNT(*) AS cnt FROM work_records WHERE product_managers IS NOT NULL AND JSON_CONTAINS(product_managers, JSON_QUOTE('{pm_name}'));"''',
        f'{pm_name} 关联记录数')

print('\n' + '='*60)
print('Step 1: 执行数据合并（通过后端 API）')
print('='*60)

# 使用后端的 transfer API 进行数据合并
# 需要先获取各 PM 的 ID
_, out, _ = run('mysql -u root -pzhujunfeng391. devtracker -N -e "SELECT id, name FROM product_managers;"',
                '获取 PM ID 映射')

pm_map = {}
for line in out.strip().split('\n'):
    parts = line.strip().split('\t')
    if len(parts) >= 2:
        pm_map[parts[1]] = parts[0]

print(f'\nPM 映射: {json.dumps(pm_map, ensure_ascii=False, indent=2)}')

# 合并规则
MERGE_RULES = [
    # (源PM名, 目标PM名)
    ('昆仑', '其他-昆仑'),
    ('昆仑组', '其他-昆仑'),
    ('运维安全组', '运维组'),
    ('运维', '运维组'),
    ('架构组', '其他-架构'),
]

for from_name, to_name in MERGE_RULES:
    from_id = pm_map.get(from_name)
    to_id = pm_map.get(to_name)
    if not from_id:
        print(f'\n⚠ 源 PM「{from_name}」不存在，跳过')
        continue
    if not to_id:
        print(f'\n⚠ 目标 PM「{to_name}」不存在，跳过')
        continue

    print(f'\n>>> 合并: {from_name}({from_id}) → {to_name}({to_id})')
    cmd = f'''curl -s -X POST http://127.0.0.1:3001/api/pm/{from_id}/transfer -H "Content-Type: application/json" -d '{{"to_pm_id":"{to_id}"}}'  '''
    run(cmd, f'调用 transfer API: {from_name} → {to_name}')

# Step 2: 验证合并结果
print('\n' + '='*60)
print('Step 2: 验证合并结果')
print('='*60)

for pm_name in ['昆仑', '昆仑组', '其他-昆仑', '运维安全组', '运维', '运维组', '架构组', '其他-架构']:
    run(f'''mysql -u root -pzhujunfeng391. devtracker -e "SELECT COUNT(*) AS cnt FROM work_records WHERE product_managers IS NOT NULL AND JSON_CONTAINS(product_managers, JSON_QUOTE('{pm_name}'));"''',
        f'{pm_name} 关联记录数')

# Step 3: 删除已清空的源 PM（可选，先不删）
print('\n' + '='*60)
print('Step 3: 合并后的源PM记录数应为0，已合并PM可在界面上手动删除')
print('='*60)

ssh.close()
print('\n✅ 完成')
