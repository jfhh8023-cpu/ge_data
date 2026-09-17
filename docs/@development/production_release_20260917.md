# v3.4.0 生产发布与可撤回记录

状态：`RELEASED_AND_VERIFIED`。用户明确授权先确认备份可撤回，再发布当前版本；备份与隔离恢复门控通过后，已于 **2026-09-17 17:56:30 北京时间（09:56:30 UTC）** 上线。

## 发布标识与范围

- 发布版本 **v3.4.0**；候选与实际提交均为 `c1b19af4adee04aae711d28c4167861002c06495`。前后端包/锁文件根版本、UI统一，health读取后端包版本；v3.4.0标签已推送gitee并指向实际产物源提交，验收归档提交另行推送。
- 构建1719模块通过，117个发布文件与候选清单hash匹配。候选归档SHA-256：`e3a92535758bccf77d38bc137885b597097254dd1df5fd152ce7a42c6075015f`。
- 内容为当前已完成并验证的有效工时、周期统计、进度填写与状态展示等版本；[REQ-069执行](../@test/delivery_status_notice_20260917/execution.md)链接前序REQ-064至068证据。
- 仅切换本项目代码和dist。保留线上.env、Nginx与其他项目进程；复用线上node_modules，未重装升级依赖；未向生产库导入本地数据/dump，未调用旧链接迁移脚本。

## 发布前备份与恢复门控

| 项目 | 实际结果 |
| --- | --- |
| 备份位置 | 服务器 `/opt/devtracker/.release-backups/20260917_094527`；本机 `deploy/backups/release_20260917_094527`。真实备份含敏感配置，处于忽略目录，不入Git。 |
| 数据库 | 压缩342683字节、解压SQL1975108字节、24表、完成标记完整；SHA-256 `56252e7effd5e11cf84355fe800d3f81327783b7b9ccca9288afa49511829416`。 |
| 应用 | 14030522字节、5171成员，含后端代码/依赖、前端dist、线上.env及PM2配置；SHA-256 `a949aeae8c86e6c17da788793b7f24e91f56b930435245480e0a7dccbdb9b519`。双端hash一致、隔离解包逐文件校验通过。 |
| 旧版恢复 | 独立库 `devtracker_verify_20260917_094527` 恢复成功，旧备份应用在13001隔离端口启动，health3.0.2。调度禁用，生产库未恢复或切换。 |
| 候选及回退演练 | 新版本在克隆库启动、核心GET成功；旧代码再次在新增schema上启动并health3.0.2，代码回退兼容演练PASS。 |
| 回退入口 | `/opt/devtracker/.release-backups/20260917_094527/rollback.sh`，`sh -n`与`--check`通过，后者返回 `ROLLBACK_READY: code only; database preserved`。脚本未在已上线生产版本上执行真实回退。 |

备份、克隆库与恢复文件保留，演练进程停止。首次隔离启动因后台shell保留SSH输出流而停止本地等待，改完整nohup子shell后复用已恢复克隆库验证成功；没有重导生产库。证据：[备份](../@test/production_release_20260917/backup-manifest.json)、[旧版恢复](../@test/production_release_20260917/restore-check.json)、[候选及回退演练](../@test/production_release_20260917/candidate-rehearsal.json)、[回退就绪](../@test/production_release_20260917/rollback-ready.json)。

## 发布执行与数据核验

候选暂存并校验后按受限路径切换；没有直接执行存在默认导库、失败不阻断及覆盖.env风险的旧deploy.py。生产Node16.20.2语法检查通过。应用兼容启动后差异已核对：

- **24张旧表中22张表的原列hash及数量完全相同**。独立文档审查重新比较了发布前即时快照与发布后快照。
- `staff_roles`从4行到5行：初始化AI产品岗位及默认岗位名称调整，属于配置初始化。
- `duty_holiday_snapshots`仍2行；与隔离克隆对照，2026年无差异，2027年仅检查/重试/更新时间变动，无假日日历内容变化。
- 新增 `demand_sources`、`product_manager_work_records` 两表及 `work_records.delivery_progress` 可空列。**880条工时全部原字段hash相同，总工时11273.5h不变，新进度列880条全NULL、0条为0，未回填进度。**
- .env、Nginx与其他进程不变。Nginx仅核对两份共享配置前后SHA-256，没有备份/恢复共享配置内容。生产Q3实际为314条、4085h总工时、2578h有效、4840h应交付，有效/加权率均53.26%；没有将本地演示产品记录带上线。

证据：[即时基线](../@test/production_release_20260917/production-immediate-before.json)、[发布后快照](../@test/production_release_20260917/production-after.json)、[发布结果](../@test/production_release_20260917/deployment-result.json)。

## 发布后验收

- PM2 `devtracker` PID31937最终稳定观察289秒；从本次进程实际启动时点检查日志，error.log最后修改2026-09-15 11:59:15 UTC，没有本次新增错误。这是短期实际观察，不代表长期稳定性保证。
- 公网health、stats页面、Excel导出HTTP200；health3.4.0。导出4个sheet，进度明细314数据行、人员周期容量121数据行；真实xlsx移至忽略的本地私有目录，不入Git。
- 1920/390px浏览器均PASS：6卡四指标同行，全部6个部门/岗位弹窗与卡片四数及总工时一致，默认当前周期、总览首位、原底部双页签与人员区域保留。独立已查看桌面页与手机部门弹窗。
- pageerror/失败API/实际写请求均0。生产无真实低进度记录，查看分支未触发；沿用本地fixture证据，不冒称生产实测。填写页本次SKIP，未读取或创建token链接；输入和提交规则沿用发布前隔离验证。

证据：[最终核验](../@test/production_release_20260917/final-verification.json)、[导出摘要](../@test/production_release_20260917/export-check.json)、[浏览器结果](../@test/production_release_20260917/browser/2026-09-17T09-56-45-439Z/results.json)、[执行矩阵](../@test/production_release_20260917/execution.md)。

## 回退及保留风险

回退脚本仅恢复旧代码/前端产物并重启本项目，**不回灌数据库**。本次“回退演练”是备份旧代码在隔离克隆库及新兼容schema上的启动/健康验证；不是整套生产切换脚本的实际回退，脚本仅语法及就绪检查。此回退设计保留上线后新填写数据。若另遇数据库受损，应先保全当前状态及增量，再评估恢复影响，不能自动覆盖旧dump。

生产仍为Node16.20.2，保留旧运行时与部分依赖要求较新Node版本的存量兼容风险。本次语法、克隆启动及实际验收通过，未顺带重装依赖；构建仍有既有大chunk提示，原records鉴权风险未扩展为全系统安全审计。

独立审查仅使用本地脱敏证据与截图，未新增生产操作，未读取敏感交接目录或披露凭据。依据[规约11、14—16](../@architecture/conventions.md)完成备份门控、发布与实际验收归档。
