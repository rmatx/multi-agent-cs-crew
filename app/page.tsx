"use client";

/**
 * Single chat column for the Sprint 1 slice: identity bar, message list, composer, results.
 * Every fact rendered here arrived in the stream from a tool result — the client composes
 * no order facts of its own.
 */

import { useCallback, useReducer, useRef, useState } from "react";
import { buildChatRequest, runTurn } from "@/lib/chatClient";
import {
  conversationIdOf,
  errorOf,
  initialTurnState,
  isRunning,
  transition,
  type TurnAction,
} from "@/lib/fsm";
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
  const nextId = useRef(0);

  const running = isRunning(state);
  const error = errorOf(state);

  const append = useCallback((role: Turn["role"], text: string) => {
    nextId.current += 1;
    // Capture the id here: the updater below runs after this handler finishes, so
    // reading nextId.current inside it would hand every append of the same tick
    // the final value — duplicate keys, and React may drop or duplicate messages.
    const id = nextId.current;
    setTranscript((prev) => [...prev, { id, role, text }]);
  }, []);

  const handleSend = useCallback(async () => {
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
    setCitations([]);

    const observingDispatch = (action: TurnAction): void => {
      if (action.kind === "event" && action.event.type === "citation") {
        setCitations(action.event.ids);
      }
      dispatch(action);
    };

    await runTurn(built.request, observingDispatch);
  }, [append, message, orderId, running, state, trace, userId]);

  const live = state.phase === "idle" ? "" : state.text;
  const doneStatus = state.phase === "done" ? state.status : null;

  return (
    <main className={styles.shell}>
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
        {running && live.length === 0 && <p className={styles.status}>Looking that up…</p>}
      </section>

      <section className={styles.results} aria-label="Turn result">
        {error !== null && <p className={styles.notice}>{error.message}</p>}
        {doneStatus === "needs_input" && (
          <p>I need a bit more information before I can answer.</p>
        )}
        {doneStatus === "escalated" && <p>Handing this to a human.</p>}
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
                void handleSend();
              }
            }}
            disabled={running}
          />
          <button
            type="button"
            className={styles.send}
            onClick={() => void handleSend()}
            disabled={running}
          >
            {running ? "Sending…" : "Send"}
          </button>
        </div>
      </section>
    </main>
  );
}
