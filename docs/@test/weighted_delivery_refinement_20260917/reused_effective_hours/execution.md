# REQ-064 复用回归（REQ-065 计算口径）

最新批次：2026-09-17T05-14-07-478Z。复现：`node backend/scripts/verify_effective_hours_ui.js --out="docs/@test/weighted_delivery_refinement_20260917/reused_effective_hours" --case=R4-E-003-UI-LIVE`。

## 每个用例最近结果（完整历史保留）

| 用例 | 最近结果 | 证据批次 | 说明 |
| --- | --- | --- | --- |
| R4-E-001-FILL | PASS | [2026-09-17T05-13-39-772Z](evidence/2026-09-17T05-13-39-772Z/) | 见 results.jsonl |
| R4-E-001-FILL-SAVE | PASS | [2026-09-17T05-13-39-772Z](evidence/2026-09-17T05-13-39-772Z/) | 见 results.jsonl |
| R4-E-002-MATH | PASS | [2026-09-17T05-13-39-772Z](evidence/2026-09-17T05-13-39-772Z/) | 见 results.jsonl |
| R4-E-002-UI | PASS | [2026-09-17T05-13-39-772Z](evidence/2026-09-17T05-13-39-772Z/) | 见 results.jsonl |
| R4-E-003-UI-LIVE | PASS | [2026-09-17T05-14-07-478Z](evidence/2026-09-17T05-14-07-478Z/) | 见 results.jsonl |
| R4-P-001-MATH | PASS | [2026-09-17T05-13-39-772Z](evidence/2026-09-17T05-13-39-772Z/) | 见 results.jsonl |

证据：evidence/；本目录完整历史追加保留在 results.jsonl，旧 REQ-064 归档不修改。浏览器请求中所有非 GET API 均被拦截，不写业务、不发通知。未执行用例不据此标记通过。
