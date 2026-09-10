/**
 * Generator for week5/NovaMart-Demo-Deck.pptx.
 *
 * Committed for the same reason the archify diagram JSON is: the .pptx is OUTPUT. Edit this and
 * regenerate — never edit the deck by hand, or the two disagree and the file wins by accident.
 *
 *   npm i pptxgenjs   (not a project dependency; the app does not need it)
 *   node week5/assets/demo-deck.js week5/NovaMart-Demo-Deck.pptx
 *
 * Speaker notes are the demo script (week5/demo-script.md). If you change one, change both.
 * NOTE: pptxgenjs LAYOUT_16x9 is 10 x 5.625in. This deck is authored for 13.333 x 7.5, which is
 * LAYOUT_WIDE — getting that wrong silently clips every slide at the right and bottom edges.
 */
const PptxGenJS = require("pptxgenjs");

/* Palette lifted from the app's own dark-mode tokens (app/globals.css), so the slides and the
   live browser on screen read as one system rather than two designs. */
const BG      = "0C0E14";  // --bg dark
const SURFACE = "161A24";  // slightly raised card
const FG      = "E9ECF3";  // --fg dark
const MUTED   = "AEB6C6";  // --muted dark, lifted a step for projector legibility
const LINE    = "262B37";  // --line dark
const ACCENT  = "818CF8";  // indigo, lifted for dark (the app lifts its accent the same way)
const OK      = "34D399";  // resolved
const HUMAN   = "A78BFA";  // handed to a person
const WARN    = "FBBF24";

const H = "Trebuchet MS";
const B = "Calibri";
const M = "Consolas";

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";      // 13.333 x 7.5 — NOT LAYOUT_16x9, which is 10 x 5.625
pptx.author = "Raj M";
pptx.title  = "NovaMart Support Crew";

const W = 13.333, HT = 7.5;
const L = 0.9;                     // left text margin (bar sits to its left)
const CW = W - L - 0.8;            // content width

/* The motif, repeated on every content slide: a full-height indigo bar at the extreme left edge
   plus a small monospace beat label. Deliberately NOT a rule under the title. */
function frame(s, num, label) {
  s.background = { color: BG };
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: HT, fill: { color: ACCENT } });
  s.addText(
    [{ text: num, options: { color: ACCENT, bold: true } },
     { text: "  ·  " + label, options: { color: MUTED } }],
    { x: L, y: 0.42, w: CW, h: 0.3, fontFace: M, fontSize: 12, charSpacing: 1 }
  );
}
function title(s, text, y = 0.85) {
  s.addText(text, { x: L, y, w: CW, h: 0.9, fontFace: H, fontSize: 40, bold: true, color: FG });
}
function land(s, text, y) {
  s.addText(text, {
    x: L, y, w: CW, h: 0.75, fontFace: H, fontSize: 19, italic: true, color: ACCENT,
    valign: "middle",
  });
}
function card(s, o) {
  s.addShape(pptx.ShapeType.roundRect, {
    x: o.x, y: o.y, w: o.w, h: o.h, rectRadius: 0.06,
    fill: { color: o.fill || SURFACE },
    line: { color: o.line || LINE, width: 1 },
  });
}

/* ─────────────────────────────── 1 · TITLE ─────────────────────────────── */
{
  const s = pptx.addSlide();
  s.background = { color: BG };
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.12, h: HT, fill: { color: ACCENT } });
  s.addText("NovaMart Support Crew", {
    x: L, y: 2.35, w: CW, h: 1.1, fontFace: H, fontSize: 54, bold: true, color: FG,
  });
  s.addText("A multi-agent support crew that knows when to stop", {
    x: L, y: 3.45, w: CW, h: 0.6, fontFace: H, fontSize: 24, color: ACCENT,
  });
  s.addText(
    [{ text: "live  ", options: { color: MUTED } },
     { text: "multi-agent-cs-crew-production.up.railway.app/final", options: { color: FG } }],
    { x: L, y: 4.45, w: CW, h: 0.35, fontFace: M, fontSize: 13 }
  );
  s.addText("Claude Agent SDK  ·  6 agents  ·  9 tools  ·  built with AAMAD", {
    x: L, y: 6.35, w: CW, h: 0.35, fontFace: B, fontSize: 13, color: MUTED,
  });
  s.addNotes(
    "~4:30 total. Don't read the slides.\n\n" +
    "BEFORE YOU START: open the URL 5 min early (cold start ~15s), authenticate once, run one " +
    "throwaway turn then press Reset. Do NOT push to main beforehand — a deploy swap kills " +
    "in-flight requests. Fallback tab: week5/assets/demo-capture.pdf."
  );
}

/* ─────────────────────────────── 2 · PROBLEM ───────────────────────────── */
{
  const s = pptx.addSlide();
  frame(s, "01", "PROBLEM");
  title(s, "Two ways to get support wrong");
  s.addText("Retail support: order status, returns, membership. High volume, low complexity — and a human reads every one.", {
    x: L, y: 1.78, w: CW, h: 0.5, fontFace: B, fontSize: 16, color: MUTED,
  });

  const cw = (CW - 0.5) / 2;
  card(s, { x: L, y: 2.55, w: cw, h: 2.0, line: "5B2530" });
  s.addText("INVENTS", { x: L + 0.35, y: 2.78, w: cw - 0.7, h: 0.4, fontFace: M, fontSize: 14, bold: true, color: "F87171" });
  s.addText("Answers confidently about someone’s refund. Fast, helpful, and occasionally wrong about money.",
    { x: L + 0.35, y: 3.25, w: cw - 0.7, h: 1.1, fontFace: B, fontSize: 15, color: FG });

  card(s, { x: L + cw + 0.5, y: 2.55, w: cw, h: 2.0, line: "3A3A4E" });
  s.addText("ESCALATES EVERYTHING", { x: L + cw + 0.85, y: 2.78, w: cw - 0.7, h: 0.4, fontFace: M, fontSize: 14, bold: true, color: MUTED });
  s.addText("Never wrong, never useful. The queue is exactly as long as it was before.",
    { x: L + cw + 0.85, y: 3.25, w: cw - 0.7, h: 1.1, fontFace: B, fontSize: 15, color: FG });

  land(s, "The bar isn’t “can an LLM answer this”. It’s “can it know when it’s not allowed to.”", 5.05);
  s.addNotes(
    "30s.\n\n" +
    "• Retail support inbox: order status, returns, membership. High volume, low complexity, a human reads every one.\n" +
    "• The tickets that hurt aren't hard — they're repetitive and time-sensitive.\n" +
    "• Two failure modes, and they're opposite: a bot that invents an answer about someone's money, " +
    "and a bot that escalates everything and saves nobody any time.\n" +
    "• So the bar isn't 'can an LLM answer this'. It's 'can it know when it's not allowed to.'"
  );
}

/* ─────────────────────────────── 3 · APPROACH ──────────────────────────── */
{
  const s = pptx.addSlide();
  frame(s, "02", "APPROACH");
  title(s, "Capability, not instruction");

  const lw = 4.75;
  s.addText("Claude Agent SDK", { x: L, y: 1.78, w: lw, h: 0.35, fontFace: H, fontSize: 17, bold: true, color: ACCENT });
  const rows = [
    ["triage-router", "coordinator — the only voice the customer hears"],
    ["5 specialists", "order · returns · policy · membership · escalation"],
    ["1 per turn", "max 4 hops, counted by the runtime not the model"],
    ["9 tools", "in-process MCP over DuckDB + policy corpus"],
  ];
  rows.forEach(([k, v], i) => {
    const y = 2.35 + i * 0.78;
    s.addText(k, { x: L, y, w: lw, h: 0.28, fontFace: M, fontSize: 14, bold: true, color: FG });
    s.addText(v, { x: L, y: y + 0.28, w: lw, h: 0.42, fontFace: B, fontSize: 13, color: MUTED });
  });

  const rx = L + lw + 0.55, rw = CW - lw - 0.55;
  card(s, { x: rx, y: 1.78, w: rw, h: 4.05, fill: "1A1530", line: ACCENT });
  s.addText("There is no refund tool.", { x: rx + 0.4, y: 2.05, w: rw - 0.8, h: 0.45, fontFace: H, fontSize: 25, bold: true, color: FG });
  s.addText("No cancel tool. No payment tool. Not anywhere in the process.", {
    x: rx + 0.4, y: 2.52, w: rw - 0.8, h: 0.5, fontFace: B, fontSize: 15, color: MUTED });
  s.addText("Not “the prompt says don’t”.\nThe capability does not exist.", {
    x: rx + 0.4, y: 3.08, w: rw - 0.8, h: 0.7, fontFace: H, fontSize: 16, bold: true, color: ACCENT, lineSpacingMultiple: 1.15 });
  ["nothing bound in the process",
   "startup assertion that throws",
   "CI test that fails when a tool is added",
   "runtime hook that denies"].forEach((t, i) => {
    const y = 3.95 + i * 0.44;
    s.addText(`L${i + 1}`, { x: rx + 0.4, y, w: 0.45, h: 0.3, fontFace: M, fontSize: 12, bold: true, color: ACCENT });
    s.addText(t, { x: rx + 0.92, y, w: rw - 1.35, h: 0.3, fontFace: B, fontSize: 13.5, color: FG });
  });

  land(s, "Specialists can’t delegate either — the Agent tool is absent from their list, not forbidden.", 6.0);
  s.addNotes(
    "45s.\n\n" +
    "• Claude Agent SDK. triage-router classifies and delegates; only agent the customer hears — one voice by construction.\n" +
    "• Five specialists, one per turn, max 4 hops.\n" +
    "• Nine tools behind an in-process MCP server — real reads against DuckDB and a policy corpus. " +
    "Every customer-facing fact traces to a tool result.\n" +
    "• THE CALLOUT: no refund/cancel/payment tool exists in the process. Not prompt-level — capability-level.\n" +
    "• Four independent layers: nothing bound / startup assertion / CI test that fails when a tool is ADDED / runtime hook denies.\n" +
    "• Same idea for delegation: a prompt injection can't talk its way into a tool that was never bound."
  );
}

/* ─────────────────────────────── 4 · LIVE DEMO ─────────────────────────── */
{
  const s = pptx.addSlide();
  frame(s, "03", "LIVE DEMO");
  s.addText("Live demo", { x: L, y: 2.5, w: CW, h: 1.2, fontFace: H, fontSize: 60, bold: true, color: FG });
  s.addText(
    [{ text: "Turn 1", options: { fontFace: M, bold: true, color: OK } },
     { text: "   order 43004  ·  12 days ago  →  resolved, with citations", options: { fontFace: B, color: FG } }],
    { x: L, y: 3.95, w: CW, h: 0.42, fontSize: 18 }
  );
  s.addText(
    [{ text: "Turn 2", options: { fontFace: M, bold: true, color: HUMAN } },
     { text: "   order 42319  ·  15 days ago  →  escalated to a human", options: { fontFace: B, color: FG } }],
    { x: L, y: 4.45, w: CW, h: 0.42, fontSize: 18 }
  );
  s.addText("Same question. Same specialist. Three days of difference.", {
    x: L, y: 5.25, w: CW, h: 0.4, fontFace: B, fontSize: 15, color: MUTED, italic: true });
  s.addNotes(
    "2:30. SWITCH TO THE BROWSER. Leave this slide up behind it.\n\n" +
    "Pick both from the scenario picker — say out loud it only fills the form, you still press Run.\n\n" +
    "TURN 1 (~14s) — narrate the wait, the UI does the work:\n" +
    "  chat column: 'Returns advisor · checking NovaMart policy'\n" +
    "  crew strip lights Returns advisor; trace counts 1 hop · 3 tool calls\n" +
    "  Result: resolved, inside the 14-day window.\n" +
    "  Point at Sources: duckdb:orders:43004, duckdb:order_items:43004, policy:returns#return-window.\n" +
    "  'It didn't recall the return policy. It read it, and it'll tell you which section.'\n\n" +
    "TURN 2 (~25s) — THE MOMENT:\n" +
    "  'Returns advisor · checking policy' → 'Escalation · writing the handoff'\n" +
    "  crew strip hands Returns advisor → Escalation; trace 2 hops · 5 tool calls\n" +
    "  now includes create_ticket_stub and format_handoff_summary\n" +
    "  Result: escalated, real ticket STUB-…, reason restricted_action.\n" +
    "  Open the handoff packet — what the human receives.\n\n" +
    "SPARE 20s: click 'Refund request' — escalates because no refund tool exists to call."
  );
}

/* ─────────────────────────────── 5 · THE MOMENT ────────────────────────── */
{
  const s = pptx.addSlide();
  frame(s, "04", "THE MOMENT");
  title(s, "Three days apart, opposite answers");

  const cw = (CW - 0.5) / 2;
  const col = (x, accent, days, verdict, rows) => {
    card(s, { x, y: 2.0, w: cw, h: 3.3, line: accent });
    s.addShape(pptx.ShapeType.rect, { x, y: 2.0, w: cw, h: 0.06, fill: { color: accent } });
    s.addText(days, { x: x + 0.4, y: 2.28, w: cw - 0.8, h: 0.5, fontFace: H, fontSize: 27, bold: true, color: FG });
    s.addText(verdict, { x: x + 0.4, y: 2.82, w: cw - 0.8, h: 0.38, fontFace: M, fontSize: 16, bold: true, color: accent });
    rows.forEach((t, i) => s.addText(t, {
      x: x + 0.4, y: 3.42 + i * 0.5, w: cw - 0.8, h: 0.45,
      fontFace: i === 2 ? M : B, fontSize: i === 2 ? 11.5 : 14, color: i === 0 ? FG : MUTED,
    }));
  };
  col(L, OK, "12 days ago", "resolved", [
    "returns-advisor", "1 hop  ·  3 tool calls",
    "duckdb:orders  ·  policy:returns#return-window",
  ]);
  col(L + cw + 0.5, HUMAN, "15 days ago", "escalated", [
    "returns-advisor → escalation", "2 hops  ·  5 tool calls",
    "STUB-AA033434  ·  restricted_action",
  ]);

  land(s, "It didn’t get more confident as it got closer to the boundary. It stopped.", 5.6);
  s.addNotes(
    "Back to slides after the demo, or leave the browser up and say this over it.\n\n" +
    "The line to land: 'Three days apart, opposite answers. It didn't get more confident as it got " +
    "closer to the boundary — it stopped. That's the behaviour I was actually building for.'"
  );
}

/* ─────────────────────────────── 6 · LEARNED ───────────────────────────── */
{
  const s = pptx.addSlide();
  frame(s, "05", "WHAT I LEARNED");
  title(s, "I shipped a flag the container couldn’t read");

  card(s, { x: L, y: 1.9, w: CW, h: 1.15, fill: "1A1530", line: LINE });
  s.addText("NEXT_PUBLIC_DEMO_MODE=1", { x: L + 0.4, y: 2.08, w: CW - 0.8, h: 0.4, fontFace: M, fontSize: 21, bold: true, color: WARN });
  s.addText("inlined by the compiler at build time — a deployed image never looks at it again", {
    x: L + 0.4, y: 2.52, w: CW - 0.8, h: 0.38, fontFace: B, fontSize: 14.5, color: MUTED });

  [["The symptom", "Crew strip and scenario picker “missing in production” — while present in every build."],
   ["The hours lost", "Debugging the deployment. The bug was in what I thought “runtime config” meant."],
   ["The fix", "A server-read variable, reported through /api/health. The app now tells you which surface it serves."],
  ].forEach(([k, v], i) => {
    const y = 3.35 + i * 0.72;
    s.addText(k, { x: L, y: y + 0.045, w: 2.1, h: 0.35, fontFace: M, fontSize: 13, bold: true, color: ACCENT });
    s.addText(v, { x: L + 2.25, y, w: CW - 2.25, h: 0.55, fontFace: B, fontSize: 14.5, color: FG });
  });

  land(s, "An agent system’s config has to be inspectable at runtime — or you’re debugging by redeploy.", 5.72);
  s.addNotes(
    "30s. The honest one.\n\n" +
    "• I shipped a demo-mode feature flag the deployed container could never read.\n" +
    "• NEXT_PUBLIC_* is inlined by the compiler at BUILD time. Setting it in the platform's " +
    "variable table changes nothing — the built bundle never looks.\n" +
    "• So the crew strip and picker were 'missing in production' while present in every build. " +
    "I was debugging the deployment; the bug was in what 'runtime config' means.\n" +
    "• Fix: server-read var reported through /api/health — the app tells you which surface it's serving.\n\n" +
    "ALTERNATE (if the room is more agent-design than infra): prompts can't remove capabilities. " +
    "I wrote careful instructions telling specialists not to delegate, then realised the only " +
    "version that survives an injection is not giving them the tool."
  );
}

/* ─────────────────────────────── 7 · NEXT ──────────────────────────────── */
{
  const s = pptx.addSlide();
  frame(s, "06", "WHAT COMES NEXT");
  title(s, "Harden the thing I already wrote down");

  const items = [
    ["1", "F87171", "No authentication", "Any caller can read any order — and order ids are sequential integers. Accepted risk (SEC-01/02); the gate before real data."],
    ["2", ACCENT, "F-WRITE-01  ·  PRD Phase 2", "Refund and cancel write APIs. The first feature that needs a human in the loop by design rather than as a fallback."],
    ["3", ACCENT, "DEF-14  ·  open, accepted", "A correct policy retrieval scored under the grounding gate and escalated. It fails cautiously — the right direction to fail."],
  ];
  items.forEach(([n, c, k, v], i) => {
    const y = 1.95 + i * 1.45;
    s.addShape(pptx.ShapeType.ellipse, { x: L, y, w: 0.46, h: 0.46, fill: { color: SURFACE }, line: { color: c, width: 1.5 } });
    s.addText(n, { x: L, y, w: 0.46, h: 0.46, fontFace: M, fontSize: 15, bold: true, color: c, align: "center", valign: "middle" });
    s.addText(k, { x: L + 0.72, y: y - 0.03, w: CW - 0.72, h: 0.36, fontFace: H, fontSize: 19, bold: true, color: FG });
    s.addText(v, { x: L + 0.72, y: y + 0.36, w: CW - 0.9, h: 0.78, fontFace: B, fontSize: 14, color: MUTED });
  });
  s.addNotes(
    "15s. Don't oversell — the honest version lands better.\n\n" +
    "• Harden first, already written down as accepted risk: no authentication. Any caller can read " +
    "any customer's order, order ids are sequential integers (SEC-01/02). That’s the gate before real data.\n" +
    "• Then PRD Phase 2 F-WRITE-01 — refund/cancel write APIs. First feature needing HITL by design.\n" +
    "• One open accepted defect, DEF-14 — grounding gate too eager. Fails cautiously."
  );
}

/* ─────────────────────────────── 8 · CLOSING ───────────────────────────── */
{
  const s = pptx.addSlide();
  frame(s, "07", "TRY IT");
  s.addText("Test it yourself", { x: L, y: 1.5, w: CW, h: 0.9, fontFace: H, fontSize: 42, bold: true, color: FG });

  card(s, { x: L, y: 2.65, w: CW, h: 1.35, fill: "1A1530", line: ACCENT });
  s.addText("multi-agent-cs-crew-production.up.railway.app/final", {
    x: L + 0.4, y: 2.88, w: CW - 0.8, h: 0.45, fontFace: M, fontSize: 19, bold: true, color: FG });
  /* The password is deliberately NOT on the slide. This deck lives in a public repository, and
     a credential printed into a committed artifact is published the moment it is pushed — the
     exact mistake the repo's pre-commit guard now exists to stop. Say it out loud instead. */
  s.addText(
    [{ text: "password  ", options: { color: MUTED } },
     { text: "shared verbally", options: { color: ACCENT, bold: true } },
     { text: "   ·   any username works", options: { color: MUTED } }],
    { x: L + 0.4, y: 3.4, w: CW - 0.8, h: 0.35, fontFace: M, fontSize: 14 }
  );

  s.addText("The 23-scenario test workbook downloads from that page — expected agent, status and ids for every case.", {
    x: L, y: 4.3, w: CW, h: 0.4, fontFace: B, fontSize: 15, color: FG });
  s.addText("github.com/rmatx/multi-agent-cs-crew", {
    x: L, y: 4.9, w: CW, h: 0.35, fontFace: M, fontSize: 14, color: MUTED });

  s.addText("179 tests  ·  55 acceptance criteria: 46 pass / 5 partial / 1 not covered / 3 by-absence  ·  19 ADRs  ·  1 open defect, accepted", {
    x: L, y: 6.3, w: CW, h: 0.35, fontFace: B, fontSize: 12.5, color: MUTED });
  s.addNotes(
    "Leave this up for Q&A.\n\n" +
    "LIKELY QUESTIONS:\n" +
    "• Hallucination? Grounding guard + citations; every fact traces to a tool result. DEF-14 is that gate firing too eagerly — I kept it.\n" +
    "• Why not one big agent? Tool permissions. Least-privilege per specialist only means something if roles are separate.\n" +
    "• Latency? 13-15s resolved, ~25s escalated. p95 30.4s single-user. Concurrency untested — honest, not hidden.\n" +
    "• Real data? Real schema, synthetic fixture. Dates shift onto today's calendar so '12 days ago' stays true.\n" +
    "• Cost? Public URL runs the keyless engine — a stranger can't spend my key. Crew runs only behind the password.\n\n" +
    "IF THE DEMO BREAKS: don't debug on camera. 'Deployed demo, live model call — let me show the capture.' " +
    "Open week5/assets/demo-capture.pdf and keep narrating."
  );
}

pptx.writeFile({ fileName: process.argv[2] })
  .then((f) => console.log("wrote", f))
  .catch((e) => { console.error(e); process.exit(1); });
