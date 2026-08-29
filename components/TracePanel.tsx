"use client";

/**
 * Operator trace panel (F-TRACE-01, SAD §3 "Trace: hidden by default; `?trace=1` or toggle").
 *
 * IT RENDERS ONLY WHAT THE SERVER SENT. `agent_hop` and `tool_call` are gated server-side
 * behind `clientFlags.trace`, so with the trace switch off this panel is empty rather than
 * filtered — the customer/operator split is enforced on the wire and the UI does not work
 * around it. That is also why the empty state says the trace was not requested instead of
 * "nothing happened": something certainly happened, and the client was not shown it.
 *
 * The deterministic engine emits one synthetic hop and one tool call, which is honest — it
 * really does run an order read — and is why the panel does not claim "crew" anywhere.
 */

import type { TraceEntry } from "@/lib/fsm";
import { agentName, reasonLabel, toolName } from "@/lib/status";
import styles from "./TracePanel.module.css";

export type TurnMeta = {
  conversationId: string | null;
  engine: string | null;
  asOf: string | null;
  shiftDays: string | null;
  overlayHit: string | null;
};

type Props = {
  open: boolean;
  onToggle: () => void;
  trail: readonly TraceEntry[];
  meta: TurnMeta;
  traceRequested: boolean;
};

function entryLabel(entry: TraceEntry): { role: string; detail: string } {
  switch (entry.kind) {
    case "hop":
      return { role: `hop ${entry.hop}`, detail: `handed to ${agentName(entry.agentId)}` };
    case "tool":
      return { role: agentName(entry.agentId), detail: `called ${toolName(entry.tool)}` };
    case "citation":
      return { role: "sources", detail: entry.ids.join(", ") };
    case "escalation":
      return {
        role: "escalated",
        detail: `${entry.ticketStubId} — ${reasonLabel(entry.reasonCode)}`,
      };
    case "error":
      return { role: "error", detail: `${entry.code}: ${entry.message}` };
    case "done":
      return { role: "done", detail: entry.status };
  }
}

export default function TracePanel({ open, onToggle, trail, meta, traceRequested }: Props) {
  const hops = trail.filter((entry) => entry.kind === "hop").length;
  const tools = trail.filter((entry) => entry.kind === "tool").length;

  return (
    <section className={styles.panel} aria-label="Operator trace">
      <button
        type="button"
        className={styles.header}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="trace-body"
      >
        <span className={styles.chevron} aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className={styles.headerLabel}>Operator trace</span>
        <span className={styles.counts}>
          {/* Hops count agent transfers, never tool calls — the same rule the runtime
              enforces, stated where an operator can check it against the list below. */}
          {hops} {hops === 1 ? "hop" : "hops"} · {tools} {tools === 1 ? "tool call" : "tool calls"}
        </span>
      </button>

      {open && (
        <div className={styles.body} id="trace-body">
          <dl className={styles.meta}>
            <div>
              <dt>Conversation</dt>
              <dd className={styles.mono}>{meta.conversationId ?? "—"}</dd>
            </div>
            <div>
              <dt>Engine</dt>
              <dd>{meta.engine ?? "—"}</dd>
            </div>
            <div>
              <dt>As of</dt>
              <dd className={styles.mono}>{meta.asOf ?? "—"}</dd>
            </div>
            <div>
              <dt>Date shift</dt>
              <dd className={styles.mono}>
                {meta.shiftDays === null ? "—" : `${meta.shiftDays} days`}
              </dd>
            </div>
            <div>
              <dt>Demo overlay</dt>
              <dd>{meta.overlayHit === null ? "—" : meta.overlayHit === "true" ? "hit" : "no"}</dd>
            </div>
          </dl>

          {trail.length === 0 ? (
            <p className={styles.empty}>
              {traceRequested
                ? "No steps yet — run a turn."
                : "Trace is off for this turn, so the server withheld the agent and tool steps. Switch Trace on and run again."}
            </p>
          ) : (
            <ol className={styles.steps}>
              {trail.map((entry, index) => {
                const { role, detail } = entryLabel(entry);
                return (
                  <li key={`${entry.kind}-${index}`} className={styles[entry.kind] ?? ""}>
                    <span className={styles.stepRole}>{role}</span>
                    <span className={styles.stepDetail}>{detail}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
