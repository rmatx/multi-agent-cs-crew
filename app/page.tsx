"use client";

/**
 * Single chat column: identity bar, message list, composer, results, CSAT, operator trace.
 *
 * Every fact rendered here arrived in the stream from a tool result — the client composes no
 * order facts of its own, and it decides nothing about the turn. The server says when a turn
 * ended, how it ended, whether to ask for a rating, and which trace frames this client is
 * allowed to see. This file renders those decisions.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ChatRequest } from "@shared/dto";
import CsatPrompt from "@/components/CsatPrompt";
import TracePanel, { type TurnMeta } from "@/components/TracePanel";
import { buildChatRequest, runTurn } from "@/lib/chatClient";
import {
  conversationIdOf,
  errorOf,
  escalationOf,
  initialTurnState,
  isRunning,
  trailOf,
  transition,
  type TurnAction,
} from "@/lib/fsm";
import { crewStatus, formatUpdated, reasonLabel, runLabel, type EngineId } from "@/lib/status";
import { plainText } from "@/lib/text";
import styles from "./page.module.css";

const NO_META: TurnMeta = {
  conversationId: null,
  engine: null,
  asOf: null,
  shiftDays: null,
  overlayHit: null,
};

type Turn = { id: number; role: "you" | "assistant"; text: string };

export default function ChatPage() {
  const [state, dispatch] = useReducer(transition, initialTurnState);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [citations, setCitations] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [orderId, setOrderId] = useState("");
  const [userId, setUserId] = useState("");
  const [trace, setTrace] = useState(false);
  const [tracePanelOpen, setTracePanelOpen] = useState(false);
  const [meta, setMeta] = useState<TurnMeta>(NO_META);
  // Set by the server's `csat_prompt` frame, cleared when answered or dismissed. The server
  // decides when to ask; this only remembers that it did.
  const [csatSignal, setCsatSignal] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  // The exact request last sent, so Retry replays the same inputs even though
  // the composer is cleared on submit.
  const [lastRequest, setLastRequest] = useState<ChatRequest | null>(null);
  // Which turn engine the server is running. Read once from /api/health so the banner cannot
  // call a keyless coded lookup a "crew" — see `enginePrefix` in lib/status.ts.
  const [engine, setEngine] = useState<EngineId>(null);
  const nextId = useRef(0);

  const running = isRunning(state);
  const error = errorOf(state);
  const status = crewStatus(state, engine);

  // SAD §3: "Trace: hidden by default; `?trace=1` or toggle". The query parameter turns the
  // switch on AND opens the panel, so an operator can hand someone a URL rather than a
  // sentence of instructions.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("trace");
    if (wanted === "1" || wanted === "true") {
      setTrace(true);
      setTracePanelOpen(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        const next = body?.engine;
        if (cancelled || (next !== "sdk" && next !== "deterministic")) return;
        setEngine(next);
      })
      .catch(() => {
        /* banner falls back to the neutral prefix */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // "Last updated" tracks every state change, which is what tells the user the
  // UI is live rather than wedged.
  useEffect(() => {
    setUpdatedAt(new Date());
  }, [state]);

  const append = useCallback((role: Turn["role"], text: string) => {
    nextId.current += 1;
    // Capture the id here: the updater below runs after this handler finishes, so
    // reading nextId.current inside it would hand every append of the same tick
    // the final value — duplicate keys, and React may drop or duplicate messages.
    const id = nextId.current;
    setTranscript((prev) => [...prev, { id, role, text }]);
  }, []);

  // Sends a request that has already been validated. Shared by Run and Retry so
  // the two cannot drift apart.
  const send = useCallback(
    async (request: ChatRequest) => {
      setCitations([]);
      setLastRequest(request);

      const observingDispatch = (action: TurnAction): void => {
        if (action.kind === "event") {
          if (action.event.type === "citation") setCitations(action.event.ids);
          // The server asks; the page renders the question. It never decides the moment
          // itself — a `needs_input` turn never carries this frame.
          if (action.event.type === "csat_prompt") setCsatSignal(true);
        }
        dispatch(action);
      };

      await runTurn(request, observingDispatch, undefined, setMeta);
    },
    [],
  );

  const handleRun = useCallback(async () => {
    if (running) return;

    const built = buildChatRequest({
      message,
      orderId,
      userId,
      conversationId: conversationIdOf(state),
      trace,
    });
    if (!built.ok) {
      setNotice(built.reason);
      return;
    }
    setNotice(null);
    setCsatSignal(false);

    // The rendered transcript is per-page; the SERVER keeps the durable one in
    // `sessions.sqlite` and feeds it back to the crew, so a reload loses the display and not
    // the conversation.
    if (state.phase === "done" && state.text.length > 0) {
      append("assistant", state.text);
    }
    append("you", built.request.message);
    setMessage("");

    await send(built.request);
  }, [append, message, orderId, running, send, state, trace, userId]);

  /**
   * F-CHAT-01's "Talk to a human" control. It sends a message like any other rather than
   * calling an escalation endpoint of its own: the crew already routes an explicit human
   * request to `escalation-handoff` with `customer_requested_human`, and a second path to the
   * same outcome is a second thing that can disagree with the first.
   */
  const handleHumanRequest = useCallback(async () => {
    if (running) return;
    const built = buildChatRequest({
      message: "I would like to speak to a human, please.",
      orderId,
      userId,
      conversationId: conversationIdOf(state),
      trace,
    });
    if (!built.ok) {
      setNotice(built.reason);
      return;
    }
    setNotice(null);
    setCsatSignal(false);
    if (state.phase === "done" && state.text.length > 0) append("assistant", state.text);
    append("you", built.request.message);
    await send(built.request);
  }, [append, orderId, running, send, state, trace, userId]);

  // Replays the last request verbatim — same order id, same question.
  const handleRetry = useCallback(async () => {
    if (running || lastRequest === null) return;
    setNotice(null);
    setCsatSignal(false);
    await send(lastRequest);
  }, [lastRequest, running, send]);

  const handleReset = useCallback(() => {
    if (running) return;
    dispatch({ kind: "reset" });
    setTranscript([]);
    setCitations([]);
    setNotice(null);
    setMessage("");
    setLastRequest(null);
    setCsatSignal(false);
    setMeta(NO_META);
    nextId.current = 0;
  }, [running]);

  const live = state.phase === "idle" ? "" : state.text;
  const doneStatus = state.phase === "done" ? state.status : null;
  const escalation = escalationOf(state);
  const conversationId = conversationIdOf(state);
  const showCsat = csatSignal && !running && conversationId !== null;

  return (
    <main className={styles.shell}>
      <div
        className={`${styles.banner} ${styles[status.tone]}`}
        role="status"
        aria-live="polite"
      >
        <span className={styles.pill} aria-hidden="true" />
        <strong className={styles.bannerLabel}>{status.prefix}: {status.label}</strong>
        {/* Who is working, when the turn asked for a trace. Replaces the generic hint rather
            than sitting beside it — "Looking that up." adds nothing once the banner can name
            the agent and the tool. */}
        <span className={styles.bannerHint}>
          {status.detail ?? status.hint}
        </span>
        {updatedAt !== null && (
          <span className={styles.updated}>
            Last updated <time dateTime={updatedAt.toISOString()}>{formatUpdated(updatedAt)}</time>
          </span>
        )}
      </div>

      <header>
        <h1 className={styles.title}>NovaMart Support</h1>
        <p className={styles.welcome}>
          I can check your order status. I can&apos;t process refunds, cancellations, or
          payments — those go to a human.
        </p>
      </header>

      <section className={styles.identityBar} aria-label="Your details">
        <div className={styles.field}>
          <label className={styles.label} htmlFor="orderId">
            Order number (required)
          </label>
          <input
            id="orderId"
            className={styles.input}
            inputMode="numeric"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            disabled={running}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="userId">
            Customer id (optional)
          </label>
          <input
            id="userId"
            className={styles.input}
            inputMode="numeric"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            disabled={running}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="trace">
            <input
              id="trace"
              type="checkbox"
              checked={trace}
              onChange={(e) => setTrace(e.target.checked)}
              disabled={running}
            />{" "}
            Trace
          </label>
        </div>
      </section>

      <section className={styles.messages} aria-live="polite" aria-label="Conversation">
        {transcript.map((turn) => (
          <article key={turn.id} className={styles.message}>
            <span className={styles.role}>{turn.role}</span>
            <p className={styles.body}>{plainText(turn.text)}</p>
          </article>
        ))}
        {live.length > 0 && (
          <article className={styles.message}>
            <span className={styles.role}>assistant</span>
            {/* Stripped at render, not stored stripped: the transcript keeps what the server
                actually sent, so a trace and the screen never disagree. */}
            <p className={styles.body}>{plainText(live)}</p>
          </article>
        )}
        {running && live.length === 0 && <p className={styles.status}>{status.hint}</p>}
      </section>

      <section className={styles.results} aria-label="Turn result">
        {error !== null && (
          <div className={styles.errorRow}>
            <p className={styles.notice}>{error.message}</p>
            {error.retryable && lastRequest !== null && (
              <button type="button" className={styles.secondary} onClick={() => void handleRetry()}>
                Retry
              </button>
            )}
          </div>
        )}
        {error === null && doneStatus === "needs_input" && (
          <p>I need a bit more information before I can answer.</p>
        )}
        {error === null && doneStatus === "escalated" && (
          escalation === null ? (
            <p>Handing this to a human.</p>
          ) : (
            /* The ticket id is the only thing a customer can quote back to a person, so it
               is shown verbatim rather than summarised away. */
            <p>
              Handed to a human. Ticket <strong>{escalation.ticketStubId}</strong> —{" "}
              {reasonLabel(escalation.reasonCode)}.
            </p>
          )
        )}
        {doneStatus === "resolved" && citations.length > 0 && (
          <p>Sources: {citations.join(", ")}</p>
        )}
      </section>

      {showCsat && conversationId !== null && (
        <CsatPrompt conversationId={conversationId} onDismiss={() => setCsatSignal(false)} />
      )}

      <section className={styles.composer}>
        {notice !== null && <p className={styles.notice}>{notice}</p>}
        <div className={styles.composerRow}>
          <label className={styles.label} htmlFor="message">
            <span className="sr-only">Message</span>
          </label>
          <textarea
            id="message"
            className={styles.textarea}
            value={message}
            placeholder="Where is my order?"
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleRun();
              }
            }}
            disabled={running}
          />
          <div className={styles.controls}>
            <button
              type="button"
              className={styles.send}
              onClick={() => void handleRun()}
              disabled={running}
            >
              {runLabel(state)}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={handleReset}
              disabled={running || state.phase === "idle"}
            >
              Reset
            </button>
          </div>
        </div>
        <div className={styles.escapeRow}>
          {/* F-CHAT-01. Always available, never buried: a customer who wants a person should
              not have to phrase the request well enough for a classifier. */}
          <button
            type="button"
            className={styles.human}
            onClick={() => void handleHumanRequest()}
            disabled={running}
          >
            Talk to a human
          </button>
          {/* Deferred, and visibly so (`*add-placeholders`). Disabled with a reason beats
              hidden: a stub that looks live is a promise the build cannot keep. */}
          <button type="button" className={styles.stub} disabled title="Not available in this build">
            Email support
          </button>
          <span className={styles.stubNote}>Email support is not part of this build.</span>
        </div>
      </section>

      <TracePanel
        open={tracePanelOpen}
        onToggle={() => setTracePanelOpen((wasOpen) => !wasOpen)}
        trail={trailOf(state)}
        meta={meta}
        traceRequested={trace}
      />
    </main>
  );
}
