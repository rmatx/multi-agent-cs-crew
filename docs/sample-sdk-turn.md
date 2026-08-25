# A live `CHAT_ENGINE=sdk` turn
Evidence that the multi-agent runtime actually runs, not just that it compiles. Both
Sprint 1 slices below were produced by `npm run eval:sdk` against a server started with
`CHAT_ENGINE=sdk`, model `claude-haiku-4-5`, on the committed CI fixture
(`data/fixtures/novamart_ci.duckdb`). Traces are copied from
`project-context/2.build/logs/` (gitignored) with the prompt bodies dropped and secrets
redacted; token usage is already redacted by `server/runtime/trace.ts`.

Reproduce:

```bash
export ANTHROPIC_API_KEY=...   # never committed
export MODEL_ID=claude-haiku-4-5
CHAT_ENGINE=sdk npm run dev
npm run eval:sdk               # 24/24 checks
```

## Slice A — WISMO (`order_status`, `orderId: 1`)

The coordinator delegates to `order-specialist`, which reads the order and its line
items through the read-only DuckDB tools, and the coordinator answers from those facts.
Terminal status `resolved`, one hop, zero money tools.

```jsonl
{"ts": "2026-08-25T02:20:44.086Z", "event": "prompt_trace", "model": "claude-haiku-4-5", "effort": "low", "thinking": "adaptive", "budgets": {"maxHops": 4, "maxModelTurns": 12, "turnTimeoutMs": 120000, "maxOutputTokens": "[REDACTED]", "toolReadRetries": 1}, "agents": [{"id": "order-specialist", "tools": ["mcp__novamart__get_order", "mcp__novamart__get_order_items"]}, {"id": "escalation-handoff", "tools": ["mcp__novamart__create_ticket_stub", "mcp__novamart__format_handoff_summary"]}], "allowedTools": ["Agent", "mcp__novamart__create_ticket_stub", "mcp__novamart__format_handoff_summary", "mcp__novamart__get_order", "mcp__novamart__get_order_items"], "systemPrompt": "[omitted \u2014 see server/runtime/agents.ts]", "userPrompt": "[omitted]"}
{"ts": "2026-08-25T02:20:52.951Z", "engine": "sdk", "event": "agent_hop", "agentId": "order-specialist", "agentRunId": "aec761f6410fd43ab", "hop": 1, "maxHops": 4}
{"ts": "2026-08-25T02:20:56.387Z", "engine": "sdk", "event": "tool_call", "agentId": "order-specialist", "tool": "mcp__novamart__get_order", "input": {"order_id": 1}}
{"ts": "2026-08-25T02:20:56.394Z", "engine": "sdk", "event": "tool_result", "agentId": "order-specialist", "tool": "mcp__novamart__get_order", "ok": true, "durationMs": 4, "response": [{"type": "text", "text": "{\"order_id\":1,\"user_id\":53,\"status\":\"completed\",\"order_date\":\"2025-08-25\",\"total_amount\":64.36,\"as_of\":\"2026-08-25\",\"citation\":\"duckdb:orders:1\"}"}]}
{"ts": "2026-08-25T02:20:56.562Z", "engine": "sdk", "event": "tool_call", "agentId": "order-specialist", "tool": "mcp__novamart__get_order_items", "input": {"order_id": 1}}
{"ts": "2026-08-25T02:20:56.568Z", "engine": "sdk", "event": "tool_result", "agentId": "order-specialist", "tool": "mcp__novamart__get_order_items", "ok": true, "durationMs": 3, "response": [{"type": "text", "text": "{\"order_id\":1,\"items\":[{\"product_name\":\"BalanceSet Yoga Max\",\"quantity\":1,\"line_total\":58.37}],\"citation\":\"duckdb:order_items:1\"}"}]}
{"ts": "2026-08-25T02:21:01.167Z", "engine": "sdk", "event": "agent_stop", "agentId": "order-specialist", "agentRunId": "aec761f6410fd43ab", "hops": 1, "lastMessage": "**Order 1 Summary**\n\n**Status:** Completed (citation: duckdb:orders:1)\n\n**Order Date:** 2025-08-25 (citation: duckdb:orders:1)\n\n**Total:** $64.36 (citation: duckdb:orders:1)\n\n**Item:**\n- BalanceSet Yoga Max (Qty: 1) \u2014 $58.37 (citation: duckdb:order_items:1)\n\n**Data Current As Of:** 2026-08-25\n\nNo tracking details available from order lookup tools. Order is closed and fulfilled."}
{"ts": "2026-08-25T02:21:01.182Z", "engine": "sdk", "event": "tool_result", "agentId": "triage-router", "tool": "Agent", "ok": true, "durationMs": 8238, "response": {"status": "completed", "prompt": "Retrieve the status and details for order ID 1. Provide any available information about order status, dates, items, totals, and tracking details if available.", "agentId": "aec761f6410fd43ab", "agentType": "order-specialist", "content": [{"type": "text", "text": "**Order 1 Summary**\n\n**Status:** Completed (citation: duckdb:orders:1)\n\n**Order Date:** 2025-08-25 (citation: duckdb:orders:1)\n\n**Total:** $64.36 (citation: duckdb:orders:1)\n\n**Item:**\n- BalanceSet Yoga Max (Qty: 1) \u2014 $58.37 (citation: duckdb:order_items:1)\n\n**Data Current As Of:** 2026-08-25\n\nNo tracking details available from order lookup tools. Order is closed and fulfilled."}], "resolvedModel": "claude-haiku-4-5", "totalDurationMs": 8238, "totalTokens": "[REDACTED]", "totalToolUseCount": 2, "usage": {"input_t
{"ts": "2026-08-25T02:21:05.557Z", "engine": "sdk", "event": "turn_result", "subtype": "success", "numTurns": 2, "costUsd": 0.05972345000000001, "usage": {"input_tokens": "[REDACTED]", "cache_creation_input_tokens": "[REDACTED]", "cache_read_input_tokens": "[REDACTED]", "output_tokens": "[REDACTED]", "output_tokens_details": "[REDACTED]", "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": "[REDACTED]", "ephemeral_5m_input_tokens": "[REDACTED]"}, "inference_geo": "not_available", "iterations": [{"input_tokens": "[REDACTED]", "output_tokens": "[REDACTED]", "cache_read_input_tokens": "[REDACTED]", "cache_creation_input_tokens": "[REDACTED]", "cache_creation": {"ephemeral_5m_input_tokens": "[REDACTED]", "ephemeral_1h_input_tokens": "[REDACTED]"}, "type": "message"}], "speed": "standard"}, "hops": 1, "path": ["order-specialist"]}
```

## Slice B — refund → escalation

A money request never reaches a money tool, because none exists. The coordinator routes
to `escalation-handoff`, which builds the package, writes an idempotent ticket stub and
returns a customer-safe summary. Terminal status `escalated`.

```jsonl
{"ts": "2026-08-25T02:21:05.972Z", "event": "prompt_trace", "model": "claude-haiku-4-5", "effort": "low", "thinking": "adaptive", "budgets": {"maxHops": 4, "maxModelTurns": 12, "turnTimeoutMs": 120000, "maxOutputTokens": "[REDACTED]", "toolReadRetries": 1}, "agents": [{"id": "order-specialist", "tools": ["mcp__novamart__get_order", "mcp__novamart__get_order_items"]}, {"id": "escalation-handoff", "tools": ["mcp__novamart__create_ticket_stub", "mcp__novamart__format_handoff_summary"]}], "allowedTools": ["Agent", "mcp__novamart__create_ticket_stub", "mcp__novamart__format_handoff_summary", "mcp__novamart__get_order", "mcp__novamart__get_order_items"], "systemPrompt": "[omitted \u2014 see server/runtime/agents.ts]", "userPrompt": "[omitted]"}
{"ts": "2026-08-25T02:21:13.993Z", "engine": "sdk", "event": "agent_hop", "agentId": "escalation-handoff", "agentRunId": "a5464eb25c5ce5ddd", "hop": 1, "maxHops": 4}
{"ts": "2026-08-25T02:21:20.914Z", "engine": "sdk", "event": "tool_call", "agentId": "escalation-handoff", "tool": "mcp__novamart__create_ticket_stub", "input": {"conversationId": "conv-refund-order-1", "intent": "Customer requesting refund for order", "entities": {"order_id": 1}, "urgency": "medium", "transcript_summary": "Customer with order ID 1 has requested a refund. The request requires human review and processing.", "tools_tried": [], "citations": [], "reason_code": "payment_or_refund", "suggested_category": "refund"}}
{"ts": "2026-08-25T02:21:20.918Z", "engine": "sdk", "event": "ticket_stub_created", "ticket_stub_id": "STUB-16D79E0D", "reason_code": "payment_or_refund"}
{"ts": "2026-08-25T02:21:20.921Z", "engine": "sdk", "event": "tool_result", "agentId": "escalation-handoff", "tool": "mcp__novamart__create_ticket_stub", "ok": true, "durationMs": 4, "response": [{"type": "text", "text": "{\"ticket_stub_id\":\"STUB-16D79E0D\"}"}]}
{"ts": "2026-08-25T02:21:22.990Z", "engine": "sdk", "event": "tool_call", "agentId": "escalation-handoff", "tool": "mcp__novamart__format_handoff_summary", "input": {"ticket_stub_id": "STUB-16D79E0D"}}
{"ts": "2026-08-25T02:21:22.995Z", "engine": "sdk", "event": "tool_result", "agentId": "escalation-handoff", "tool": "mcp__novamart__format_handoff_summary", "ok": true, "durationMs": 2, "response": [{"type": "text", "text": "{\"summary\":\"Ticket STUB-16D79E0D is open with our support team. It references order 1. Reason: payment or refund. A human will pick this up \u2014 I can't process refunds, cancellations, or payments myself.\"}"}]}
{"ts": "2026-08-25T02:21:26.171Z", "engine": "sdk", "event": "agent_stop", "agentId": "escalation-handoff", "agentRunId": "a5464eb25c5ce5ddd", "hops": 1, "lastMessage": "**Escalation Complete**\n\nTicket ID: **STUB-16D79E0D**\n\nCustomer Summary:\n> Ticket STUB-16D79E0D is open with our support team. It references order 1. Reason: payment or refund. A human will pick this up \u2014 I can't process refunds, cancellations, or payments myself.\n\nThe refund request for order 1 has been handed off to human support. A support agent will review and process the request."}
{"ts": "2026-08-25T02:21:26.182Z", "engine": "sdk", "event": "tool_result", "agentId": "triage-router", "tool": "Agent", "ok": true, "durationMs": 12198, "response": {"status": "completed", "prompt": "Customer with order_id=1 is requesting a refund. Hand off to human support for processing.", "agentId": "a5464eb25c5ce5ddd", "agentType": "escalation-handoff", "content": [{"type": "text", "text": "**Escalation Complete**\n\nTicket ID: **STUB-16D79E0D**\n\nCustomer Summary:\n> Ticket STUB-16D79E0D is open with our support team. It references order 1. Reason: payment or refund. A human will pick this up \u2014 I can't process refunds, cancellations, or payments myself.\n\nThe refund request for order 1 has been handed off to human support. A support agent will review and process the request."}], "resolvedModel": "claude-haiku-4-5", "totalDurationMs": 12197, "totalTokens": "[REDACTED]", "totalToolUseCount": 2, "usage": {"input_tokens": "[REDACTED]", "cache_creation_input_tokens": "[REDACTED
{"ts": "2026-08-25T02:21:28.692Z", "engine": "sdk", "event": "turn_result", "subtype": "success", "numTurns": 2, "costUsd": 0.06225230000000001, "usage": {"input_tokens": "[REDACTED]", "cache_creation_input_tokens": "[REDACTED]", "cache_read_input_tokens": "[REDACTED]", "output_tokens": "[REDACTED]", "output_tokens_details": "[REDACTED]", "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0}, "service_tier": "standard", "cache_creation": {"ephemeral_1h_input_tokens": "[REDACTED]", "ephemeral_5m_input_tokens": "[REDACTED]"}, "inference_geo": "not_available", "iterations": [{"input_tokens": "[REDACTED]", "output_tokens": "[REDACTED]", "cache_read_input_tokens": "[REDACTED]", "cache_creation_input_tokens": "[REDACTED]", "cache_creation": {"ephemeral_5m_input_tokens": "[REDACTED]", "ephemeral_1h_input_tokens": "[REDACTED]"}, "type": "message"}], "speed": "standard"}, "hops": 1, "path": ["escalation-handoff"]}
```

## What these traces are checked for

`scripts/eval-sdk.mjs` asserts on both the SSE wire and the JSONL above:

- terminal status per slice (`resolved` / `escalated`) and exactly one `done` frame
- the expected hop (`order-specialist` / `escalation-handoff`) and the expected tools
- an escalation frame carrying a ticket stub id and a reason code
- **no `turn_error`** and **exactly one `turn_result`** — the two symptoms of the
  stream-lifecycle defect fixed in `app/api/chat/route.ts`
- zero money tools *invoked at runtime*, which is a different claim from the zero money
  tools *registered* proven by `npm run test:invariants`
