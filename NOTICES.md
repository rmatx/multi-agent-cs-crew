# NOTICES

Third-party content and attribution for this repository.

## Design influence — react-bits (no code included)

The frontend's waiting state, streaming caret and message-entrance transitions were informed by
patterns catalogued in [react-bits](https://github.com/DavidHDev/react-bits) by David Haz.

**No react-bits source is vendored, copied or depended on here.** That library is distributed
under **MIT + Commons Clause**, and the Commons Clause restricts selling software whose value
derives substantially from it — a term worth knowing about before copying components into a
product, even though this project would not trip it. The patterns implemented here are written
from scratch in plain CSS: most react-bits components require `framer-motion` or `gsap`, and
none of that was taken on.

Recorded because AAMAD core requires third-party content to be attributed, and because "we took
the idea, not the code, and here is why that distinction mattered" is the honest description.

## Runtime dependencies — OpenTelemetry and OpenInference

Added 2026-09-04 for Arize AX trace export (`server/runtime/openinference.ts`):

| Package | Licence | Why |
| --- | --- | --- |
| `@opentelemetry/api` | Apache-2.0 | Span and status types |
| `@opentelemetry/sdk-trace-node` | Apache-2.0 | `NodeTracerProvider`, batch processor |
| `@opentelemetry/exporter-trace-otlp-proto` | Apache-2.0 | OTLP/HTTP protobuf exporter |
| `@opentelemetry/resources` | Apache-2.0 | Resource attributes (`model_id`, project name) |
| `@arizeai/openinference-semantic-conventions` | Apache-2.0 | OpenInference attribute names and span kinds |

**This ended the project's zero-added-dependency position, deliberately.** Until this point the
repo had taken no runtime dependency it did not need — not even a test framework — and that is
worth stating plainly rather than letting the claim quietly rot in older docs. The trade was
made because the two cheaper routes to Arize are closed: there is no Claude Agent SDK
integration for TypeScript, and the subprocess that makes the model call emits metrics and logs
but no trace spans (`docs/arize-tracing-findings.md`). Emitting OpenInference spans ourselves
was the only remaining route, and hand-rolling OTLP instead would have been worse.

The dependency is confined to one module and one call site. `resolveArizeConfig()` returns null
without `ARIZE_API_KEY`/`ARIZE_SPACE_ID`, so nothing is exported and no provider is constructed
unless tracing is explicitly configured.
