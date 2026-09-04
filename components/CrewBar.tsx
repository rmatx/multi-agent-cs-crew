"use client";

/**
 * Crew strip (ENH-02) — every agent, with the one holding the turn lit.
 *
 * Exists because "Crew: handed off" told an audience what the TURN was doing but never who did
 * it, and a six-agent system that never shows six agents is indistinguishable from one model in
 * a trench coat.
 *
 * OPERATOR SURFACE, not a customer one. Agent identity reaches the browser only on trace frames
 * (`sdk.ts` gates `agent_hop` behind `input.trace`), and that gate is deliberate — AC-CHAT-03
 * keeps raw runtime detail out of customer text. So this renders only where the trace already
 * flows, and no contract changed to build it: it reads the `agent_hop` frames the FSM was
 * already collecting for the trace panel.
 *
 * The empty state is the important one. The deterministic engine emits no `agent_hop` at all, so
 * a row of dead LEDs would read as a broken crew when the truth is that no crew is running.
 */

import { agentName, CREW_ORDER } from "@/lib/status";
import styles from "./CrewBar.module.css";

type Props = {
  /** Agent currently holding the turn, or null between turns. */
  activeAgentId: string | null;
  /** Every agent that has held this turn, in order — so a two-hop turn shows its whole path. */
  visitedAgentIds: readonly string[];
  /** False on the keyless engine, where no crew exists to show. */
  crewAvailable: boolean;
};

export default function CrewBar({ activeAgentId, visitedAgentIds, crewAvailable }: Props) {
  return (
    <section className={styles.bar} aria-label="Crew">
      <span className={styles.label}>Crew</span>

      {CREW_ORDER.map((id) => {
        const isActive = crewAvailable && id === activeAgentId;
        const isVisited = crewAvailable && !isActive && visitedAgentIds.includes(id);
        return (
          <span
            key={id}
            className={`${styles.agent} ${isActive ? styles.active : ""} ${isVisited ? styles.visited : ""}`}
            /* State is announced, not just coloured: a screen reader gets "current" on the
               active agent rather than a list of six identical names. */
            aria-current={isActive ? "true" : undefined}
          >
            <span className={styles.led} aria-hidden="true" />
            {agentName(id)}
          </span>
        );
      })}

      {!crewAvailable && (
        <span className={styles.note}>keyless engine — no crew running</span>
      )}
    </section>
  );
}
