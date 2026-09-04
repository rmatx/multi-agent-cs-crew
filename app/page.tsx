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
import CrewBar from "@/components/CrewBar";
import HandoffEmail from "@/components/HandoffEmail";
import DemoBar, { type DemoScenario } from "@/components/DemoBar";
import demoData from "@/data/demo-scenarios.json";
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
import { agentName, crewStatus, formatUpdated, reasonLabel, runLabel, type EngineId } from "@/lib/status";
import { plainText } from "@/lib/text";
import styles from "./page.module.css";

const NO_META: TurnMeta = {
  conversationId: null,
  engine: null,
  asOf: null,
  shiftDays: null,
  overlayHit: null,
};

/** `agentId` is set only when the trace was on — see CrewBar for why identity is gated. */
type Turn = { id: number; role: "you" | "assistant"; text: string; agentId?: string };

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

  /*
   * Demo mode. OFF unless asked for: `NEXT_PUBLIC_DEMO_MODE=1` at build time, or `?demo=1` on
   * the URL for a session that was not built with it.
   *
   * Read in an effect rather than during render because `window` does not exist on the server —
   * reading it inline would make the server and client markup disagree and React would discard
   * the tree. It also means the picker appears a frame late, which is invisible and correct:
   * the customer surface renders first and the operator tool arrives after.
   */
  const [demoMode, setDemoMode] = useState(false);
  /*
   * Agents that have held the CURRENT turn, in order. Reset per turn rather than accumulated,
   * so the strip answers "who handled this question" and not "who has ever run".
   */
  const [turnAgents, setTurnAgents] = useState<string[]>([]);

  useEffect(() => {
    const fromEnv = process.env["NEXT_PUBLIC_DEMO_MODE"] === "1";
    const fromUrl = new URLSearchParams(window.location.search).get("demo") === "1";
    const on = fromEnv || fromUrl;
    setDemoMode(on);
    /*
     * Demo mode turns the trace on. Agent identity only reaches the browser on trace frames, so
     * without this the crew strip and the per-answer agent label would sit empty in exactly the
     * mode built to show them. Demo mode is already an operator surface — it lists real order
     * ids — so it is not granting a customer anything new.
     */
    if (on) setTrace(true);
  }, []);

  /*
   * Fills the form and stops. It deliberately does NOT send: the presenter presses Run, so the
   * room watches a real turn begin from a real click, and the question can still be edited on
   * the way. Auto-running would make a live demo indistinguishable from a recording.
   */
  const applyScenario = useCallback((scenario: DemoScenario) => {
    setOrderId(scenario.identity.orderId?.toString() ?? "");
    setUserId(scenario.identity.userId?.toString() ?? "");
    setMessage(scenario.message);
    setNotice(null);
  }, []);
  const nextId = useRef(0);
  /*
   * Scroll anchor. A streaming answer grows downward past the fold, and a customer who has to
   * chase it is reading a support reply while fighting the page. `block: "nearest"` scrolls
   * only when the anchor is actually out of view, so someone who has deliberately scrolled up
   * to re-read an earlier turn is not yanked back down on every delta.
   */
  const endRef = useRef<HTMLDivElement>(null);

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

  const append = useCallback((role: Turn["role"], text: string, agentId?: string) => {
    nextId.current += 1;
    // Capture the id here: the updater below runs after this handler finishes, so
    // reading nextId.current inside it would hand every append of the same tick
    // the final value — duplicate keys, and React may drop or duplicate messages.
    const id = nextId.current;
    setTranscript((prev) => [...prev, agentId === undefined ? { id, role, text } : { id, role, text, agentId }]);
  }, []);

  // Sends a request that has already been validated. Shared by Run and Retry so
  // the two cannot drift apart.
  const send = useCallback(
    async (request: ChatRequest) => {
      setCitations([]);
      setTurnAgents([]);
      setLastRequest(request);

      const observingDispatch = (action: TurnAction): void => {
        if (action.kind === "event") {
          if (action.event.type === "agent_hop") {
            const hopped = action.event.agentId;
            setTurnAgents((prev) => (prev.includes(hopped) ? prev : [...prev, hopped]));
          }
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
      // The LAST agent to hold the turn is the one whose words these are.
      append("assistant", state.text, turnAgents.at(-1));
    }
    append("you", built.request.message);
    setMessage("");

    await send(built.request);
  }, [append, message, orderId, running, send, state, trace, turnAgents, userId]);

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
    if (state.phase === "done" && state.text.length > 0) append("assistant", state.text, turnAgents.at(-1));
    append("you", built.request.message);
    await send(built.request);
  }, [append, orderId, running, send, state, trace, turnAgents, userId]);

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

  useEffect(() => {
    endRef.current?.scrollIntoView({
      // `auto` rather than `smooth`: a smooth scroll re-triggered on every streaming delta
      // never settles, and the text ends up permanently in motion under the reader.
      behavior: "auto",
      block: "nearest",
    });
  }, [live, transcript.length, running]);
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

      {demoMode && (
        <CrewBar
          activeAgentId={running ? (turnAgents.at(-1) ?? null) : null}
          visitedAgentIds={turnAgents}
          crewAvailable={engine === "sdk"}
        />
      )}

      {demoMode && (
        <DemoBar
          scenarios={demoData.scenarios as DemoScenario[]}
          onPick={applyScenario}
          disabled={running}
        />
      )}

      <section className={styles.identityBar} aria-label="Your details">
        <div className={styles.field}>
          <label className={styles.label} htmlFor="orderId">
            Order number
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
            Customer id
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
          <article
            key={turn.id}
            className={`${styles.message} ${turn.role === "you" ? styles.you : ""}`}
          >
            <span className={styles.role}>
              {turn.role}
              {/* ENH-03: which specialist produced this answer, so a scrolled-back transcript
                  still says who spoke. Present only when the trace was on — see CrewBar. */}
              {turn.agentId !== undefined && (
                <span className={styles.agentTag}>{agentName(turn.agentId)}</span>
              )}
            </span>
            <p className={styles.body}>{plainText(turn.text)}</p>
          </article>
        ))}
        {live.length > 0 && (
          <article className={styles.message}>
            <span className={styles.role}>
              assistant
              {/* ENH-03 on the LIVE message too. The first cut only labelled transcript entries,
                  which are written on the NEXT turn — so the answer actually on screen, the one
                  a demo audience is looking at, was the only one with no agent name. */}
              {turnAgents.at(-1) !== undefined && (
                <span className={styles.agentTag}>{agentName(turnAgents.at(-1) as string)}</span>
              )}
            </span>
            {/* Stripped at render, not stored stripped: the transcript keeps what the server
                actually sent, so a trace and the screen never disagree. */}
            <p className={`${styles.body} ${running ? styles.streaming : ""}`}>{plainText(live)}</p>
          </article>
        )}
        {running && live.length === 0 && (
          /*
           * Measured time to first token is 10-16s on the sdk engine, so this is the state a
           * customer spends the most time looking at. It deliberately occupies the shape the
           * answer will occupy — same role label, same column — so the wait reads as the reply
           * being written rather than as nothing happening.
           *
           * `aria-live="polite"` and not `assertive`: a screen-reader user should hear that it
           * is working without having the announcement interrupt them, and the same hint text
           * carries the state for anyone who has motion switched off.
           */
          <article className={styles.working} aria-live="polite">
            <span className={styles.role}>assistant</span>
            <div className={styles.workingCard}>
              <div className={styles.workingRow}>
                <span className={styles.dots} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span>{status.hint}</span>
              </div>
              <div className={styles.skeleton} aria-hidden="true">
                <span />
                <span />
              </div>
            </div>
          </article>
        )}
        <div ref={endRef} />
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
            <>
              <p>
                Handed to a human. Ticket <strong>{escalation.ticketStubId}</strong> —{" "}
                {reasonLabel(escalation.reasonCode)}.
              </p>
              {/* ENH-01. Demo surface: the endpoint behind it is gated on a server-side
                  DEMO_MODE and 404s otherwise, so this collapses to an honest note in a normal
                  deployment rather than leaking a customer's packet. */}
              {demoMode && <HandoffEmail ticketStubId={escalation.ticketStubId} />}
            </>
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
