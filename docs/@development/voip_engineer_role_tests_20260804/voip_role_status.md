# VOIP 独立角色回归状态

- 状态：已完成
- PASS：19
- ISSUE：0（均已关闭）
- FAIL：0
- BLOCKER：0
- 当前用例：无
- 恢复点：无需恢复

## 最近结果

- VOIP-003 PASS：旧列 0 条，VOIP 87 条/773h；幂等重跑 0 变更。
- VOIP-008 PASS：模板、导入、备份均包含 VOIP 字段，测试数据已删除。
- VOIP-011 PASS：离线报告 36 个周期页，VOIP 合计 773h。
- VOIP-014 PASS（第 2 次）：使用仓库已有 Playwright 回退，人员、需求报表、周期统计、产品经理专属页、任务详情和填写页共 6 页通过。
- TOOL ISSUE：内置浏览器返回 `No browser is available`；未影响 Playwright 回退结果。
- VOIP-015 PASS：本地工作区未暂存、未提交、未推送、未发布。
- VOIP-016 PASS：生产备份、`--skip-db` 发布和 113 条/1052h 事务迁移完成，8598.5h 守恒。
- VOIP-017 PASS（第 2 次）：生产 40 个周期报告全部重建，旧角色文件 0。
- VOIP-018 PASS：刷新签名增加人员角色清单和生成器哈希，生产自动刷新验证通过。
- VOIP-019 PASS：本地全路由、写入纠偏、导入和临时数据清理通过。

## 产物

- `voip_role_source_digest.md`
- `voip_role_plan.md`
- `voip_role_results.jsonl`
- `voip_role_summary.md`
