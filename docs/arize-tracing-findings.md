# Arize AX tracing — investigated 2026-09-04, not possible via the SDK

**Status: CLOSED. The Claude Agent SDK emits no trace spans, so there is nothing for Arize to
ingest. This is a property of the runtime, not a configuration mistake.**

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

**The subprocess emits no spans at all — confirmed, not inferred.** A minimal OTLP receiver was
run on `127.0.0.1:4318`, which is the OTLP default, so the allowlist could not interfere. One real
turn with `OTEL_TRACES_EXPORTER=otlp` produced:

```
3 x POST /v1/logs      claude_code.api_request, claude_code.hook_execution_start
5 x POST /v1/metrics   claude_code.cost.usage, claude_code.session.count
0 x POST /v1/traces    nothing, ever
```

That closes the question. The runtime exports **metrics and events, never spans.** Arize AX
builds a project from trace spans, so no configuration of endpoint, headers or project name could
ever have made this work — the missing endpoint variable was a genuine bug, but it was never the
reason nothing arrived.

That change was reverted rather than left in place. It replaces what the subprocess sees on every
turn, which is a real behavioural change to carry into a demo in exchange for a feature that does
not work.

## Cost of the investigation

Three live turns, about $0.75.

## The only remaining route

Emit OpenInference spans from `server/runtime/trace.ts`. It already holds everything a span needs
— hop path, agent id, tool name, input, result, `durationMs`, token counts, `costUsd`, and a
`turnId` to parent them by — so the work is translation, not instrumentation. It costs an
OpenTelemetry dependency in a repo that has taken none, and it is a deliberate decision rather
than an afternoon.

Do not retry the env-var route. It is not a configuration problem.

## One more thing worth knowing before exporting any of this

The telemetry that *does* flow carries identity: `user.email`, `user.id`, `organization.id` and
`session.id` were all present in the captured payloads. Sending it to a third party sends those
too. That is a `security.md` question (see SEC-03 on trace content), not just a plumbing one.

## What to use instead, today

`npm run observability` — run rate, error rate, latency, TTFT, cost by agent path, tool latency
and retries, read from the JSONL traces the runtime already writes. No vendor, no dependency, and
it works on the whole history rather than starting from today.
