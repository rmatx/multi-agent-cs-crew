# Arize AX tracing — investigated 2026-09-04, not working

**Status: blocked on the app side. Do not plan a demo around it.**

Nothing in the repo is wired to Arize. This file records what was tried, what was proved, and
exactly where it stops, so the next attempt starts from the blocker instead of the beginning.

## Why the obvious routes do not apply

| Route | Why not |
| --- | --- |
| `claude-agent-sdk` integration | **Python only.** The TypeScript list is LangChain-JS, Mastra, OpenAI Agents JS, Vercel AI SDK, BeeAI — no Claude Agent SDK. |
| Anthropic SDK instrumentor | **Captures nothing.** This app never calls the Messages API in-process; there is no `@anthropic-ai/sdk` import anywhere. The Agent SDK spawns the Claude Code runtime as a subprocess. |
| Arize Claude Code plugin | Aimed at Claude Code as a *coding harness* — tracing a developer's own sessions, not an app that embeds the SDK. |
| OpenInference spans from `trace.ts` | Possible, and the highest-fidelity option, but it means adding OpenTelemetry dependencies to a repo that has taken none, and hand-writing spans for six agents and eight tools. |

## What was proved

**The Arize side is fine.** Authenticated, space `rmanitx Space`
(`U3BhY2U6MzYxOTM6STExTw==`), API key created. A direct POST to the collector:

```
https://otlp.arize.com/v1/traces   with space_id + api_key  ->  HTTP 200
https://otlp.arize.com/v1/traces   with no auth             ->  HTTP 403
```

Credentials, endpoint and header format are all correct. Whatever is wrong is not Arize.

**The SDK drops every endpoint variable.** It forwards the parent environment to its subprocess
through a fixed allowlist of ~193 names. That allowlist contains `OTEL_TRACES_EXPORTER`,
`OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `OTEL_RESOURCE_ATTRIBUTES` and the
`OTEL_LOG_*` content flags — and **no endpoint variable at all**: neither
`OTEL_EXPORTER_OTLP_ENDPOINT` nor `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`.

The failure that produces is silent. Export switches on, the process starts cleanly, nothing is
logged, and every span goes to the OTLP default `localhost:4318` where nothing is listening.

```bash
# reproduce the allowlist finding
node -e '
const s = require("fs").readFileSync("node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs","utf8");
const i = s.indexOf("CLAUDE_CODE_ENABLE_TELEMETRY");
const arr = s.slice(s.lastIndexOf("[",i), s.indexOf("]",i)+1);
console.log([...arr.matchAll(/"(OTEL[A-Z0-9_]*)"/g)].map(m=>m[1]).join("\n"));
'   # note: no *_ENDPOINT entry
```

**Passing the endpoint explicitly still did not produce a trace.** `ClaudeAgentOptions.env`
replaces the allowlist wholesale, so the endpoint can be forced through it. That was implemented,
typechecked, and run against a real turn: still no spans, still no project created in the space.
So the missing endpoint is *a* bug but not *the* blocker — the subprocess appears not to emit
trace spans in SDK (non-interactive) mode at all, whatever it is pointed at.

That change was reverted rather than left in place. It replaces what the subprocess sees on every
turn, which is a real behavioural change to carry into a demo in exchange for a feature that does
not work.

## Cost of the investigation

Three live turns, about $0.75.

## If picking this up again

1. Confirm whether the SDK subprocess emits trace spans at all in non-interactive mode — stand up
   a local OTLP collector on `localhost:4318` and watch for anything. That is the one question
   this investigation could not close, and it decides everything after it.
2. If it does emit: the fix is `ClaudeAgentOptions.env` carrying the endpoint (see above), plus a
   check on whether the spans use OpenInference semantic conventions. Claude Code's own schema
   will land but will not render as rich LLM traces — no `openinference.span.kind`, no
   `input.value`/`output.value`.
3. If it does not: the only real route is emitting OpenInference spans from `server/runtime/trace.ts`,
   which already holds every hop, tool call, duration, token count and cost the traces would need.
   That is a dependency decision, not an afternoon.

## What to use instead, today

`npm run observability` — run rate, error rate, latency, TTFT, cost by agent path, tool latency
and retries, read from the JSONL traces the runtime already writes. No vendor, no dependency, and
it works on the whole history rather than starting from today.
