# v3.4.0 生产发布实际验收

2026-09-17。状态：`RELEASED_AND_VERIFIED`。版本3.4.0，源提交 `c1b19af4adee04aae711d28c4167861002c06495`，09:56:30 UTC上线。仅汇总已生成证据；独立审查未重跑生产测试。

| 编号 | 实际检查 | 结果与证据 |
| --- | --- | --- |
| PR-001 | 数据库/旧应用备份、双端hash与隔离解包 | PASS。SQL24表完成标记完整，应用5171成员含依赖/config；[备份清单](backup-manifest.json)。 |
| PR-002 | 备份库恢复、旧备份应用启动 | PASS。独立克隆库、13001隔离进程health3.0.2，调度禁用；[恢复结果](restore-check.json)。 |
| PR-003 | 候选克隆启动、新schema旧代码回退 | PASS。新版本health3.4.0及核心GET成功，旧代码在新增schema上health3.0.2；[演练结果](candidate-rehearsal.json)。 |
| PR-004 | 提交/构建/生产语法/依赖/实际产物 | PASS。1719模块构建、117文件匹配，复用现有依赖不安装升级；[构建](build.log)、[候选清单](candidate-manifest.json)、[发布结果](deployment-result.json)。 |
| PR-005 | 原数据与允许结构差异 | PASS（明确差异）。24旧表22表原列hash/count一致；staff_roles配置初始化，holiday仅2027检查/重试/更新时间，2026无变化。新增2表和可空进度列；880工时原字段hash及11273.5h不变、进度880NULL/0个0。[即时基线](production-immediate-before.json)、[发布后](production-after.json)、[差异说明](final-verification.json)。 |
| PR-006 | 服务/公网/隔离/回退就绪 | PASS。PID31937稳定观察289秒，自进程实际启动起无新增错误；health/stats/export200；env/Nginx/其他进程不变；rollback --check通过且不恢复DB。[最终核验](final-verification.json)、[回退就绪](rollback-ready.json)。 |
| PR-007 | 公网导出 | PASS。4个sheet，进度明细314数据行、人员周期容量121数据行；[导出摘要](export-check.json)。真实xlsx位于忽略的本地私有目录，不归档入Git。 |
| PROD-UI-1920 | 桌面真实页面 | PASS。v3.4.0、6卡四指标同行、6弹窗四数/总工时与卡片一致、当前周期、总览首位、原双页签；[结果](browser/2026-09-17T09-56-45-439Z/results.json)、[截图](browser/2026-09-17T09-56-45-439Z/stats-1920.png)。 |
| PROD-UI-390 | 手机真实页面 | PASS。同上，人员及下方表格保留；[部门弹窗截图](browser/2026-09-17T09-56-45-439Z/dialog-department-390.png)。 |

## 边界及独立复核

- 浏览器批次 `2026-09-17T09-56-45-439Z`：2组PASS，pageErrors/failedApis/interceptedWrites均空。先安装全请求写拦截，实际未出现写请求；JSON不记录query/token/记录正文。
- 生产没有真实低进度有效记录，`incompleteChecked=false`，查看分支本次未执行；该分支以[REQ-069本地范围及手机四列验收](../delivery_status_notice_20260917/execution.md)为证据。填写页未取token/新建链接/提交记录，明确SKIP，不能列为生产通过。
- 独立重算本地即时前后快照：24旧表中22表count、所用原列及hash相同，差异仅staff_roles/holiday；工时原字段hash未变。独立已查看1920主页面及390部门弹窗，没有以本地演示产品记录作为生产期望。
- 克隆恢复及新schema旧代码启动/健康演练成功；rollback.sh仅执行sh -n与--check，生产未真正执行回退，未宣称整套切换脚本已实退。备份/克隆库保留、演练进程停止；常规回退只恢复代码，避免覆盖上线后业务新增。Nginx仅核对两份共享配置前后hash，没有备份/恢复共享配置内容。
- 最初隔离演练因后台shell保留SSH输出流而调整启动方式，随后通过，没有重导生产库。保留Node16/既有依赖及构建大chunk风险，不作全系统安全或长期稳定性保证。

[发布记录与回退路径](../../@development/production_release_20260917.md)
