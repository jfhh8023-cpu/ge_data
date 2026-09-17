# REQ-064 运行验证

最新批次：2026-09-17T04-51-30-966Z。复现：`node backend/scripts/verify_effective_hours_ui.js --case=R4-P-001-API-EMPTY`。

## 每个用例最近结果（完整历史保留）

| 用例 | 最近结果 | 证据批次 | 说明 |
| --- | --- | --- | --- |
| R4-E-001-FILL | PASS | [2026-09-17T04-48-40-485Z](evidence/2026-09-17T04-48-40-485Z/) | 见 results.jsonl |
| R4-E-001-FILL-SAVE | PASS | [2026-09-17T04-48-40-485Z](evidence/2026-09-17T04-48-40-485Z/) | 见 results.jsonl |
| R4-E-002-API | PASS | [2026-09-17T04-49-51-802Z](evidence/2026-09-17T04-49-51-802Z/) | 见 results.jsonl |
| R4-E-002-MATH | PASS | [2026-09-17T04-48-40-485Z](evidence/2026-09-17T04-48-40-485Z/) | 见 results.jsonl |
| R4-E-002-UI | PASS | [2026-09-17T04-48-40-485Z](evidence/2026-09-17T04-48-40-485Z/) | 见 results.jsonl |
| R4-E-003-UI | PASS | [2026-09-17T04-48-40-485Z](evidence/2026-09-17T04-48-40-485Z/) | 见 results.jsonl |
| R4-E-003-UI-1280 | PASS | [2026-09-17T04-48-40-485Z](evidence/2026-09-17T04-48-40-485Z/) | 见 results.jsonl |
| R4-E-003-UI-LIVE | PASS | [2026-09-17T04-49-51-802Z](evidence/2026-09-17T04-49-51-802Z/) | 见 results.jsonl |
| R4-I-001-UI-EXPORT | PASS | [2026-09-17T04-48-40-485Z](evidence/2026-09-17T04-48-40-485Z/) | 见 results.jsonl |
| R4-P-001-API-EMPTY | PASS | [2026-09-17T04-51-30-966Z](evidence/2026-09-17T04-51-30-966Z/) | 见 results.jsonl |
| R4-P-001-MATH | PASS | [2026-09-17T04-48-40-485Z](evidence/2026-09-17T04-48-40-485Z/) | 见 results.jsonl |

证据：evidence/；完整历史追加保留在 results.jsonl。浏览器请求中所有非 GET API 均被拦截，不写业务、不发通知。四轮冻结设计中未执行的用例不能据此标记通过。初期定位器超时和开发未集成失败保留；1280图表可见及手机人员区实际截图反馈后已收紧断言，最新结果以此矩阵为准。
