"use client";

/**
 * The handoff packet a human receives, collapsed under an escalation (ENH-01).
 *
 * Fetches the STORED artifact rather than composing anything: what the audience reads here is
 * byte-for-byte what `data/tickets/<id>.md` holds, so the screen and the artifact cannot drift.
 * That also means it inherits the PII scrubbing the file already went through (SEC-03).
 *
 * Loaded on expand, not on escalation. Most turns are never opened, and a fetch per escalation
 * would be work done for nobody — the request is also the thing that fails when the endpoint is
 * gated off, and a failure nobody asked for is just noise in the console.
 */

import { useState } from "react";
import styles from "./HandoffEmail.module.css";

type Props = { ticketStubId: string };

export default function HandoffEmail({ ticketStubId }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const toggle = async (): Promise<void> => {
    const next = !open;
    setOpen(next);
    if (!next || text !== null) return;

    try {
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketStubId)}/email`);
      if (!res.ok) {
        // 404 is the normal answer outside demo mode, and the honest thing to say is where the
        // packet lives — not that something went wrong.
        setProblem("The handoff packet is written to data/tickets/ and is not served here.");
        return;
      }
      const body = (await res.json()) as { text?: string };
      setText(body.text ?? "");
    } catch {
      setProblem("Could not read the handoff packet.");
    }
  };

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.toggle} onClick={() => void toggle()} aria-expanded={open}>
        <span className={styles.caret} aria-hidden="true">{open ? "▾" : "▸"}</span>
        What the human receives
        <span className={styles.tag}>simulated</span>
      </button>

      {open && (
        text !== null
          ? <pre className={styles.body}>{text}</pre>
          : <p className={styles.note}>{problem ?? "Loading…"}</p>
      )}
    </div>
  );
}
