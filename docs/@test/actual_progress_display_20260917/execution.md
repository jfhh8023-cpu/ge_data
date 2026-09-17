# REQ-067 实际进度脚注验收

2026-09-17。状态：本地定向验收完成，未部署生产。此次为既有真实字段显示修正；计算、API、数据不变。

## 用例与结果

| 计划用例 | 证据与结果 |
| --- | --- |
| AP-F-001 真实值与Tips | PASS。复用UI断言主卡/弹窗62.5%进度、100%覆盖，两项各自公式title；真实部门85.64%/1.49%、产品85.64%/100%。 |
| AP-F-002 null显示未填写 | PASS。全null显示未填写/0%；研发四岗位真实页面均未填写/0%。历史兼容仍只作用于加权值，不替代实际脚注。 |
| AP-F-003 明确0与混合 | PASS。8h null+32h@0显示0%进度/80%覆盖；8h@50+32h null显示50%/20%；全部0显示0%/100%。覆盖null→不适用的表达式经独立代码审查，不声称该兜底输入做了真实API测试。 |
| AP-F-004 空与无普通版本 | PASS。普通无版、纯五类不显示脚注；空metric通过显示条件代码审查，纯五类人员进度显示不适用。 |
| AP-F-005 上下人员列 | PASS。混合null/0时上表分别未填写/0%，下方人员页签同样显示未填写；纯五类上表为不适用。列prop/排序数值没有修改。 |
| AP-U-001 四尺寸 | PASS。1920/1600/1280/390卡片及弹窗四指标同行、无重叠溢出；脚注紧凑，1600卡片约130px，原人员与下表保持。 |
| AP-R-001 数据不变 | PASS。真实GET/API/导出仍按REQ-066公式；15组数学回归通过；8表前后hash/计数/工时/null/0一致。 |

## 执行索引

- [主UI日志](ui.log)及[results.jsonl](results.jsonl)：`2026-09-17T05-55-06-944Z`三组全部PASS：WR4-E-003-API、WR4-E-003-GROUP、WR4-E-003-LAYOUT。沿用旧脚本稳定ID，按上表映射REQ-067用例。
- [复用UI日志](reused-ui.log)与[结果](reused_effective_hours/results.jsonl)：`2026-09-17T05-55-30-993Z`两组R4-E-002-UI、R4-I-001-UI-EXPORT通过，含主卡/弹窗真实值和原Excel保持。
- [统计数学](stats-math.log)：15组PASS，0失败。[构建](build.log)：1714模块完成，保留既有大chunk提示。
- [只读before](db-before.json)/[after](db-after.json)：8表非敏感行hash、条数、工时、null/0完全相同；研发880条null保持原值。

已实际打开[1600真实卡片](evidence/2026-09-17T05-55-06-944Z/live-cards-1600.png)复核；主代理另查看[1920弹窗](evidence/2026-09-17T05-55-06-944Z/live-dialog-1920.png)、[390卡片](evidence/2026-09-17T05-55-06-944Z/live-cards-390.png)。[null与0人员](evidence/2026-09-17T05-55-06-944Z/actual-progress-personal-dialog.png)、[全null](evidence/2026-09-17T05-55-06-944Z/all-historical-progress-unfilled.png)为对应边界证据。

## 独立审查与边界

四业务文件diff经独立审查：新增纯显示formatter采用null判断，明确0不误判；真实进度与覆盖分别读取原字段/绑定自己的title；脚注条件限定普通版本工时；上下人员列原排序prop不变。无计算/后端/API/导出变化，未发现本轮新增阻塞。独立后端只读逐行核对报告及真实岗位数据详见[开发记录](../../@development/actual_progress_footer_20260917.md)。

浏览器1次非读请求被拦截，实际数据只读；没有业务库试写或生产部署。未重跑无关全套流程，不将本次显示审查扩大称为全系统安全认证；原records入口鉴权存量风险保持原验收边界。旧REQ-066归档未覆盖。
