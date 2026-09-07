/**
 * The strip above the chat on `/final`: what this build is, and the run sheet to test it with.
 *
 * A server component with no interactivity, so it costs the reviewer surface nothing in
 * JavaScript and renders in the first paint, ahead of the chat column's demo-mode effect.
 *
 * The scenario list is NOT restated here. It lives in the workbook, which
 * `npm run demo:build` regenerates from the same `data/demo-scenarios.json` the picker reads,
 * so the file a reviewer downloads and the scenarios in the dropdown cannot disagree. A prose
 * summary in this file would be a third copy, and the one nobody would remember to update.
 */

import styles from "./ReviewerHeader.module.css";

/**
 * Served out of `public/`, and covered by the same middleware password as this page — see
 * `middleware.ts`. Kept as a constant because the middleware matcher has to name the same
 * path, and a gate that guards a slightly different URL than the link points at is a gate
 * with a hole in it.
 */
export const RUNSHEET_PATH = "/novamart-demo-runsheet.xlsx";

export default function ReviewerHeader() {
  return (
    <aside className={styles.strip} aria-label="Reviewer information">
      <div className={styles.row}>
        <span className={styles.badge}>Reviewer build</span>
        <p className={styles.lede}>
          The full surface: the crew strip, the scenario picker, the escalation handoff packet
          and the operator trace are all on. The customer-facing build at{" "}
          <a className={styles.inlineLink} href="/">
            /
          </a>{" "}
          is the same application with those switched off.
        </p>
      </div>

      <a className={styles.download} href={RUNSHEET_PATH} download>
        <span className={styles.downloadIcon} aria-hidden="true">
          ⤓
        </span>
        <span className={styles.downloadText}>
          <strong>Test cases — NovaMart run sheet (.xlsx)</strong>
          <span className={styles.downloadNote}>
            23 scenarios with the order and customer ids to type, the status and specialist each
            one should reach, and what it proves. Three sheets: Run sheet, Coverage, Setup.
          </span>
        </span>
      </a>

      <p className={styles.note}>
        Ids in the run sheet are rows in the demo fixture, not real customers. Pick a scenario
        from the dropdown below to fill the form, then press Run — nothing sends itself.
      </p>
    </aside>
  );
}
