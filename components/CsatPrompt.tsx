"use client";

/**
 * CSAT prompt (F-CSAT-01), shown when the server sends a `csat_prompt` frame.
 *
 * The SERVER decides when to ask. It emits the frame immediately before `done` on any turn
 * that actually finished, and never on `needs_input` — so this component does not reason
 * about whether the moment is right, it renders the question it was asked to render. Same
 * division as everywhere else in this client: the server owns turn semantics.
 *
 * Dismissible without answering, and it disappears once answered. A survey that cannot be
 * closed is a survey people learn to resent.
 */

import { useState } from "react";
import { submitCsat } from "@/lib/services/csatClient";
import styles from "./CsatPrompt.module.css";

type Props = {
  conversationId: string;
  onDismiss: () => void;
};

const SCORES = [1, 2, 3, 4, 5];

/** Plain words rather than stars: the endpoint stores 1–5, and this says what 1–5 means. */
const SCORE_LABELS: Record<number, string> = {
  1: "Not at all",
  2: "Not really",
  3: "Partly",
  4: "Mostly",
  5: "Completely",
};

export default function CsatPrompt({ conversationId, onDismiss }: Props) {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (chosen: number, withComment: string): Promise<void> => {
    setSending(true);
    setProblem(null);
    const result = await submitCsat(conversationId, chosen, withComment);
    setSending(false);
    if (result.ok) {
      setSent(true);
      return;
    }
    setProblem(result.message);
  };

  if (sent) {
    return (
      <section className={styles.card} role="status">
        <p className={styles.thanks}>Thanks — that is recorded.</p>
      </section>
    );
  }

  return (
    <section className={styles.card} aria-label="How did that go?">
      <div className={styles.row}>
        <p className={styles.question}>Did that answer your question?</p>

        <div className={styles.scores} role="group" aria-label="Rating">
          {SCORES.map((value) => (
            <button
              key={value}
              type="button"
              className={`${styles.score} ${score === value ? styles.chosen : ""}`}
              /*
               * The number is shown; the word moves to hover and to the accessible name.
               *
               * `title` gives the pointer tooltip, and `aria-label` carries the same words to a
               * screen reader — a tooltip alone would put the meaning of the scale out of reach
               * of anyone not using a mouse. `.tip` under it covers touch, where hover does not
               * exist at all.
               */
              aria-label={`${value} — ${SCORE_LABELS[value]}`}
              title={SCORE_LABELS[value]}
              aria-pressed={score === value}
              disabled={sending}
              onClick={() => {
                setScore(value);
                // A rating with no comment is the common case, so one click completes it. The
                // comment box appears after, and re-submits if they add something.
                void submit(value, comment);
              }}
            >
              {value}
              <span className={styles.tip} aria-hidden="true">
                {SCORE_LABELS[value]}
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className={styles.dismiss}
          onClick={onDismiss}
          aria-label="Dismiss the rating question"
        >
          ✕
        </button>
      </div>

      {/* Only after a score. Before one there is nothing to attach a comment TO — the Send
          button was permanently disabled — so it was reserving height to be unusable. */}
      {score !== null && (
        <div className={styles.commentRow}>
          <input
            id="csat-comment"
            className={styles.comment}
            value={comment}
            disabled={sending}
            placeholder="Anything to add? (optional)"
            aria-label="Anything to add? (optional)"
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit(score, comment);
            }}
          />
          <button
            type="button"
            className={styles.commentSend}
            disabled={sending || comment.trim().length === 0}
            onClick={() => void submit(score, comment)}
          >
            Send
          </button>
        </div>
      )}

      {problem !== null && <p className={styles.problem}>{problem}</p>}
    </section>
  );
}
