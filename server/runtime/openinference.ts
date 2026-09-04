/**
 * OpenInference span export to Arize AX.
 *
 * WHY THIS EXISTS AT ALL — the two routes that look easier do not work.
 *
 * 1. There is no Arize integration for TypeScript + Claude Agent SDK. The `claude-agent-sdk`
 *    integration is Python-only.
 * 2. A provider instrumentor captures nothing: this app never calls the Messages API in
 *    process. The SDK spawns the Claude Code runtime as a subprocess, and that subprocess
 *    emits METRICS AND LOGS BUT NO TRACE SPANS — proved by pointing it at a local OTLP
 *    receiver on the default port and receiving 3 `/v1/logs`, 5 `/v1/metrics`, 0 `/v1/traces`.
 *    See `docs/arize-tracing-findings.md`.
 *
 * So the spans have to come from us. That turns out to be a translation job rather than an
 * instrumentation one, because `trace.ts` already records everything a span tree needs: a
 * `turnId` to parent by, an `agentRunId` per hop, tool names, inputs, results, `durationMs`,
 * token counts and cost.
 *
 * DESIGN: REPLAY, NOT LIVE INSTRUMENTATION.
 *
 * Spans are built AFTER the turn from the records it produced, using OpenTelemetry's explicit
 * start/end timestamps. That keeps the promise the Arize guidance makes — "tracing is purely
 * additive, never alters business logic" — literally true: nothing on the turn's hot path
 * changes, no context has to be propagated through the SDK's async boundaries, and a failure
 * in here cannot affect a customer's answer because the answer has already been sent.
 *
 * The cost of replay is that a span cannot be seen in Arize until its turn finishes. For a
 * 10-16s support turn that is not a real loss.
 */

import { context, SpanStatusCode, trace as otelTrace, type Span, type Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SemanticConventions, OpenInferenceSpanKind } from "@arizeai/openinference-semantic-conventions";

const SC = SemanticConventions;

/** Arize's collector. `otlp-eu` for an EU space; overridable for a dedicated instance. */
const DEFAULT_ENDPOINT = "https://otlp.arize.com/v1/traces";

export type ArizeConfig = {
  apiKey: string;
  spaceId: string;
  endpoint: string;
  project: string;
};

export function resolveArizeConfig(): ArizeConfig | null {
  const apiKey = process.env["ARIZE_API_KEY"]?.trim();
  const spaceId = process.env["ARIZE_SPACE_ID"]?.trim();
  if (!apiKey || !spaceId) return null;
  return {
    apiKey,
    spaceId,
    endpoint: process.env["ARIZE_OTLP_ENDPOINT"]?.trim() || DEFAULT_ENDPOINT,
    project: process.env["ARIZE_PROJECT_NAME"]?.trim() || "novamart-support-crew",
  };
}

let provider: NodeTracerProvider | null = null;
let tracer: Tracer | null = null;

/**
 * One provider per process, built on first use.
 *
 * `model_id` is the attribute Arize keys a project on, and it is REQUIRED — without it the
 * collector answers 500 and nothing lands. It is set alongside the OpenInference project name
 * so the same resource works if the backend is ever swapped.
 */
function getTracer(cfg: ArizeConfig): Tracer {
  if (tracer !== null) return tracer;

  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "model_id": cfg.project,
      "openinference.project.name": cfg.project,
      "service.name": cfg.project,
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: cfg.endpoint,
          // Arize authenticates on these two headers; verified against the live collector
          // (200 with them, 403 without).
          headers: { space_id: cfg.spaceId, api_key: cfg.apiKey },
        }),
        // A support turn is 10-16s and a demo watcher wants the trace while the room is still
        // looking at it, so this flushes far more eagerly than the 5s default.
        { scheduledDelayMillis: 1000, maxExportBatchSize: 128 },
      ),
    ],
  });

  tracer = provider.getTracer("novamart-support-crew");
  return tracer;
}

/** One JSONL record, as `trace.ts` writes it. */
export type TraceRecordLike = {
  ts: string;
  event: string;
  turnId?: string;
  conversationId?: string;
  [key: string]: unknown;
};

const ms = (iso: string): number => new Date(iso).getTime();
const str = (v: unknown): string =>
  typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v);

function num(usage: unknown, key: string): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const v = (usage as Record<string, unknown>)[key];
  return typeof v === "number" ? v : undefined;
}

/**
 * Turn one turn's records into a span tree and export it.
 *
 * Shape: an AGENT root for the turn, a CHAIN per specialist hop, and a TOOL under the hop that
 * called it — which is the structure the trace log already describes, not one invented here.
 */
export function exportTurnSpans(records: readonly TraceRecordLike[], cfg: ArizeConfig): void {
  const prompt = records.find((r) => r.event === "prompt_trace");
  const result = records.find((r) => r.event === "turn_result" || r.event === "turn_error");
  if (prompt === undefined || result === undefined) return;

  const t = getTracer(cfg);
  const conversationId = str(prompt.conversationId);
  const startTime = ms(prompt.ts);
  const endTime = ms(result.ts);
  const failed = result.event === "turn_error" || result["subtype"] !== "success";

  const usage = result["usage"];
  const root = t.startSpan(
    "novamart.turn",
    {
      startTime,
      attributes: {
        [SC.OPENINFERENCE_SPAN_KIND]: OpenInferenceSpanKind.AGENT,
        [SC.SESSION_ID]: conversationId,
        [SC.INPUT_VALUE]: str(prompt["userPrompt"]),
        [SC.LLM_MODEL_NAME]: str(prompt["model"]),
        // `usage` counts survive redaction since the SEC-03 fix; before it they were
        // `[REDACTED]` strings, which is why these are guarded rather than cast.
        ...(num(usage, "input_tokens") !== undefined
          ? { [SC.LLM_TOKEN_COUNT_PROMPT]: num(usage, "input_tokens") as number }
          : {}),
        ...(num(usage, "output_tokens") !== undefined
          ? { [SC.LLM_TOKEN_COUNT_COMPLETION]: num(usage, "output_tokens") as number }
          : {}),
        "turn.id": str(result.turnId ?? prompt.turnId),
        "turn.hops": typeof result["hops"] === "number" ? (result["hops"] as number) : 0,
        "turn.cost_usd": typeof result["costUsd"] === "number" ? (result["costUsd"] as number) : 0,
      },
    },
    context.active(),
  );

  const rootCtx = otelTrace.setSpan(context.active(), root);

  // agentRunId groups a hop with its stop; tool calls in between belong to the open hop.
  const openHops = new Map<string, { span: Span; agentId: string }>();
  let lastHopKey: string | null = null;

  for (const rec of records) {
    if (rec.event === "agent_hop") {
      const key = str(rec["agentRunId"]) || str(rec["agentId"]);
      const span = t.startSpan(
        str(rec["agentId"]) || "specialist",
        {
          startTime: ms(rec.ts),
          attributes: {
            [SC.OPENINFERENCE_SPAN_KIND]: OpenInferenceSpanKind.CHAIN,
            [SC.SESSION_ID]: conversationId,
            "agent.id": str(rec["agentId"]),
            "agent.hop": typeof rec["hop"] === "number" ? (rec["hop"] as number) : 0,
          },
        },
        rootCtx,
      );
      openHops.set(key, { span, agentId: str(rec["agentId"]) });
      lastHopKey = key;
      continue;
    }

    if (rec.event === "agent_stop") {
      const key = str(rec["agentRunId"]) || str(rec["agentId"]);
      const hop = openHops.get(key);
      if (hop !== undefined) {
        hop.span.setAttribute(SC.OUTPUT_VALUE, str(rec["lastMessage"]));
        // Explicit OK. `startSpan` never sets it, and a span exported UNSET fails Arize scoring
        // — the single most-missed line in manual instrumentation.
        hop.span.setStatus({ code: SpanStatusCode.OK });
        hop.span.end(ms(rec.ts));
        openHops.delete(key);
      }
      continue;
    }

    if (rec.event === "tool_result") {
      const parentKey = str(rec["agentId"]) ? lastHopKey : lastHopKey;
      const parent = parentKey === null ? undefined : openHops.get(parentKey);
      const duration = typeof rec["durationMs"] === "number" ? (rec["durationMs"] as number) : 0;
      const end = ms(rec.ts);
      const toolSpan = t.startSpan(
        str(rec["tool"]) || "tool",
        {
          startTime: end - duration,
          attributes: {
            [SC.OPENINFERENCE_SPAN_KIND]: OpenInferenceSpanKind.TOOL,
            [SC.TOOL_NAME]: str(rec["tool"]),
            [SC.SESSION_ID]: conversationId,
            [SC.OUTPUT_VALUE]: str(rec["response"]).slice(0, 2000),
            "tool.ok": rec["ok"] === true,
            "agent.id": str(rec["agentId"]),
          },
        },
        parent === undefined ? rootCtx : otelTrace.setSpan(rootCtx, parent.span),
      );
      // A tool that returned an error is a real ERROR span — that is the case an operator opens
      // the trace to find, and marking it OK would hide exactly the turn worth looking at.
      toolSpan.setStatus(
        rec["ok"] === true
          ? { code: SpanStatusCode.OK }
          : { code: SpanStatusCode.ERROR, message: str(rec["error"]) || "tool failed" },
      );
      toolSpan.end(end);
      continue;
    }
  }

  // A hop with no stop record (aborted turn, hop budget exhausted) still has to be closed, or
  // it never exports at all and the trace silently loses a branch.
  for (const [, hop] of openHops) {
    hop.span.setStatus({ code: SpanStatusCode.ERROR, message: "hop did not complete" });
    hop.span.end(endTime);
  }

  root.setAttribute(SC.OUTPUT_VALUE, str(result["lastMessage"] ?? result["subtype"]));
  root.setStatus(
    failed
      ? { code: SpanStatusCode.ERROR, message: str(result["error"]) || str(result["subtype"]) }
      : { code: SpanStatusCode.OK },
  );
  root.end(endTime);
}

/** Flush before a short-lived process exits, or the batch is dropped. */
export async function shutdownTelemetry(): Promise<void> {
  if (provider === null) return;
  try {
    await provider.forceFlush();
    await provider.shutdown();
  } catch {
    /* export failures must never propagate */
  } finally {
    provider = null;
    tracer = null;
  }
}
