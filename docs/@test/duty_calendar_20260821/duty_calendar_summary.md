# 节假日跳过与排班例外本地测试总结

## 结论

- 日期：2026-08-22。
- 状态：`PASS_LOCAL_ONLY`。
- 自动化用例：16 个通过，0 个问题，0 个失败，0 个阻塞。
- 边界：仅验证本地开发环境；未提交、未推送、未打包、未发布生产。

## 覆盖范围

1. 官方节假日、周末、手动停排与恢复默认。
2. 固定、轮换、月度排班单元跨停排日顺延。
3. 人员跳过、顺位补位、无可用人员冲突。
4. 指定两日换班、逻辑取消、自然键复用和已执行保护。
5. 特殊通知独立调度、一次性发送、失败隔离和幂等。
6. 原子保存、乐观锁、超量请求、跨年预览和缓存失效。
7. 既有子通知、值班模式切换和值班开始/结束通知回归。
8. 设置页桌面与窄屏布局、未保存保护和浏览器错误检查。
9. 普通自动任务、主通知和子通知在停排日顺延，并在下一有效日幂等执行一次。
10. 日历保存后主任务、子通知倒计时和设置 API 无需重启即时刷新。

## 关键证据

- `backend/scripts/verify_duty_calendar_and_exceptions.js`：9/9 PASS，隔离接收器请求 1 次。
- `backend/scripts/verify_child_notifications_and_duty_switch.js`：PASS，重复发送 0 次。
- `backend/scripts/verify_duty_calendar_system_integration.js`：5/5 PASS，本机隔离接收器收到特殊通知、主通知、子通知各 1 次。
- `npm --prefix frontend run build`：PASS，Vite 8.0.8，1686 个模块。
- 桌面截图：`evidence/holiday-calendar-desktop.png`，147234 字节，SHA-256 `DFDF872D143015CB3712F1375DE6D1667C2C1304724E2FD42DFCBACE06E9F19C`。
- 窄屏截图：`evidence/holiday-calendar-mobile.png`，53745 字节，SHA-256 `8D23FEE4591FEDB7A899EFD560465C75EA7CC00C888B601ACD2AB90F22BBC824`。
- 2026 官方快照 SHA-256：`2171F38488692F00607271F0AB2121B4FF9A666AE7246D4B85D0FEF1EF2B7DDA`。
- 系统联动浏览器截图：`evidence/h016_settings_calendar_dialog_20260822.png`，SHA-256 `E7FF916E7542D12CAB4F0B545D7BD84BECF3147FDD1D64B0D20F25CFF48C43CA`。

## 数据清理

测试结束后：

| 对象 | 行数 |
| --- | ---: |
| 用户原有年度修订 | 1 |
| 用户原有日期例外 | 1 |
| 临时换班 | 0 |
| 特殊通知日志 | 0 |
| 临时自动任务规则 | 0 |
| 临时子通知 | 0 |
| 运行日志（与测试前一致） | 113 |
| 消息记录（与测试前一致） | 242 |

## 残余风险

- 继承风险：设置接口尚无统一服务端鉴权中间件，生产发布前必须独立补齐或明确接受该风险。
- 构建保留既有大 chunk 警告，不影响本次功能验收。
- 2027 年及以后需要先补充并核验对应年度官方节假日快照。

## 上线判定

本地功能和回归验证通过，但本轮没有上线授权，判定为 `LOCAL_READY`，不是 `PRODUCTION_READY`。
