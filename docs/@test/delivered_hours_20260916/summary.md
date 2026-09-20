# 已交付工时验证结果

最新批次：2026-09-16T13-45-05-263Z

**9组最近结果全部PASS。** 基础7组通过后，仅补查容量范围过滤、真实Q3产品5人图/弹窗，以及研发聚焦简化头部。真实产品卡/弹窗132h÷1400h=9.43%；真实研发个人184h/65.71%；均与API一致。桌面900px首屏可见图表与弹窗表行，390px页面无横溢。最终截图已人工复核，范围/尺寸/失败归类详见review.md。

| 用例 | 结果 | 批次 |
| --- | --- | --- |
| DELIVERY-PURE | PASS | 2026-09-16T13-42-49-696Z |
| DELIVERY-CARDS | PASS | 2026-09-16T13-34-53-486Z |
| DELIVERY-DIALOG | PASS | 2026-09-16T13-35-22-009Z |
| DELIVERY-API | PASS | 2026-09-16T13-34-53-486Z |
| DELIVERY-EDGE | PASS | 2026-09-16T13-34-53-486Z |
| DELIVERY-EXPORT | PASS | 2026-09-16T13-34-53-486Z |
| DELIVERY-MOBILE | PASS | 2026-09-16T13-34-53-486Z |
| DELIVERY-LIVE | PASS | 2026-09-16T13-43-50-899Z |
| DELIVERY-FOCUS | PASS | 2026-09-16T13-45-05-263Z |

执行：`node backend/scripts/verify_delivered_hours_ui.js --case=DELIVERY-FOCUS`。所有非GET请求拦截，未写业务数据、未发通知。
