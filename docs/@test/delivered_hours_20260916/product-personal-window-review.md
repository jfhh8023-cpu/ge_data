# 产品图姓名打开本人新页：验收

日期：2026-09-17。批次：`2026-09-17T02-45-27-943Z`。

结论：3 组只读验收通过；人工截图审查发现的桌面工时列截断已修复并定向复核。未改业务数据、未发送通知，证据未保存访问 token。

| 用例 | 结果 | 证据 |
| --- | --- | --- |
| PERSONAL-WINDOW | PASS | 点击右图张三打开 `/stats/product-manager/:staffId` 新窗口，携带 2026/Q3、当前周期及 admin 上下文；只读取该人员本人记录。Q3 为 2 条/225h，与图总计及个人 API 相同；原页页签、人员/岗位筛选和记录集合不变。图下说明已移除。左图钟冠原查看入口可打开。 |
| PERSONAL-PERIOD | PASS | 页面选 W33 后，新窗口收到相同 taskId，显示本人 2 条/225h；Q3 可选 7 个周期、只显示 1 个有记录周期。隔离 route fixture 增加第二个周期，实际验证最新/最早及恢复顺序。2027 Q1 筛选为 0 条/0h 并出现空状态。 |
| PERSONAL-LAYOUT | PASS | 保留查看页头部、周期卡、筛选及排序控件；1600 桌面与 390 手机截图已人工审阅，手机页面无横向溢出。 |

## 人工审查与修后补查

- 初版新增需求方列后，桌面单卡约 500px，工时列初始位置被截断。主代理隐藏本人模式重复的角色列后重新截图，表头为序号、版本、需求标题、需求方、人员、工时。
- 修后卡片右边界为 539.66px；25.0 和 200.0 工时数字右边界分别为 511.31、515.02px，完整可见。手机仍使用表格自身横向滚动。
- 实际操作周期下拉：Q3 → W32 无记录（0h）→ 范围内全部周期（225h），恢复正确。
- 点击“任务收集”离开本人页，未请求 `/pm/view/undefined`，未产生运行错误或业务写请求。
- 附加临时检查曾沿用“桌面需要横滚”断言，恰逢列宽修复后失败；已归类为过时的测试假设，停止临时进程并改为数字边界断言。正式 3 组结果没有失败。

## 复现与证据

- 命令：`node backend/scripts/verify_product_personal_window_ui.js`；支持 `--case=PERSONAL-WINDOW,PERSONAL-PERIOD,PERSONAL-LAYOUT`。
- [计划](product-personal-window-plan.md) · [状态](product-personal-window-status.md) · [结果 JSONL](product-personal-window-results.jsonl)
- [运行详情与个人接口参数](evidence/2026-09-17T02-45-27-943Z/product-personal-window-runtime.json)
- [修后桌面截图](evidence/2026-09-17T02-45-27-943Z/product-personal-window-quarter-desktop-fixed.png)
- [单周截图](evidence/2026-09-17T02-45-27-943Z/product-personal-window-week-desktop.png)
- [手机截图](evidence/2026-09-17T02-45-27-943Z/product-personal-window-mobile.png)
- [空范围截图](evidence/2026-09-17T02-45-27-943Z/product-personal-window-empty.png)
- [列宽、实际周期选择和离页验证](evidence/2026-09-17T02-45-27-943Z/product-personal-window-navigation.json)

本轮不重复旧主列表联动回归；此前“右图姓名筛选底部列表”的旧预期已由本轮新窗口行为替代。
