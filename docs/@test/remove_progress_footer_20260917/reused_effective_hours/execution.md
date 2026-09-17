# REQ-064 复用回归（REQ-068 移除摘要脚注，周期口径保持）

最新批次：2026-09-17T06-07-16-477Z。复现：`node backend/scripts/verify_effective_hours_ui.js --out="docs/@test/remove_progress_footer_20260917/reused_effective_hours" --case=R4-E-002-UI`。

## 每个用例最近结果（完整历史保留）

| 用例 | 最近结果 | 证据批次 | 说明 |
| --- | --- | --- | --- |
| R4-E-002-UI | PASS | [2026-09-17T06-07-16-477Z](evidence/2026-09-17T06-07-16-477Z/) | 见 results.jsonl |

证据：evidence/；本目录完整历史追加保留在 results.jsonl，旧 REQ-064 归档不修改。浏览器请求中所有非 GET API 均被拦截，不写业务、不发通知。未执行用例不据此标记通过。
