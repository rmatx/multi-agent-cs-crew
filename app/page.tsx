"use client";

/**
 * Single chat column for the Sprint 1 slice: identity bar, message list, composer, results.
 * Every fact rendered here arrived in the stream from a tool result — the client composes
 * no order facts of its own.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ChatRequest } from "@shared/dto";
import { buildChatRequest, runTurn } from "@/lib/chatClient";
import {
  conversationIdOf,
  errorOf,
  initialTurnState,
  isRunning,
  transition,
  type TurnAction,
} from "@/lib/fsm";
import { crewStatus, formatUpdated, runLabel, type EngineId } from "@/lib/status";
import styles from "./page.module.css";

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
        if (action.kind === "event" && action.event.type === "citation") {
          setCitations(action.event.ids);
        }
        dispatch(action);
      };

      await runTurn(request, observingDispatch);
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

    // In-memory transcript only for this slice (SQLite session durability is deferred).
    if (state.phase === "done" && state.text.length > 0) {
      append("assistant", state.text);
    }
    append("you", built.request.message);
    setMessage("");

    await send(built.request);
  }, [append, message, orderId, running, send, state, trace, userId]);

  // Replays the last request verbatim — same order id, same question.
  const handleRetry = useCallback(async () => {
    if (running || lastRequest === null) return;
    setNotice(null);
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
    nextId.current = 0;
  }, [running]);

  const live = state.phase === "idle" ? "" : state.text;
  const doneStatus = state.phase === "done" ? state.status : null;

  return (
    <main className={styles.shell}>
      <div
        className={`${styles.banner} ${styles[status.tone]}`}
        role="status"
        aria-live="polite"
      >
        <span className={styles.pill} aria-hidden="true" />
        <strong className={styles.bannerLabel}>{status.prefix}: {status.label}</strong>
        <span className={styles.bannerHint}>{status.hint}</span>
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
            <p className={styles.body}>{turn.text}</p>
          </article>
        ))}
        {live.length > 0 && (
          <article className={styles.message}>
            <span className={styles.role}>assistant</span>
            <p className={styles.body}>{live}</p>
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
        {error === null && doneStatus === "escalated" && <p>Handing this to a human.</p>}
        {doneStatus === "resolved" && citations.length > 0 && (
          <p>Sources: {citations.join(", ")}</p>
        )}
      </section>

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
      </section>
    </main>
  );
}
