const pptxgen = require('pptxgenjs');
const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';           // 13.33 x 7.5
pptx.author = 'NovaMart Capstone';
pptx.title = 'NovaMart Support Crew — PRD Scope';

// ---- palette -------------------------------------------------------------
const INK   = '141B34';   // dark ground
const NAVY  = '1E2761';
const ICE   = 'CADCFC';
const MINT  = '02C39A';   // IN MVP
const AMBER = 'E8A33D';   // P1 — if time
const SLATE = '7C8AA5';   // P2 — future
const CORAL = 'E4572E';   // OUT — hard exclusion
const PAPER = 'F7F9FC';
const MUTED = '5A6884';
const LINEC = 'E3E8F0';
const WHITE = 'FFFFFF';

const HF = 'Georgia';     // header font (prose only — oldstyle figures make "P0" read as "Po")
const BF = 'Calibri';     // body font AND all numerals
const NF = 'Calibri';     // numeral font: lining figures

const W = 13.33, M = 0.7;
const CW = W - M * 2;                   // 11.93

// ---- helpers -------------------------------------------------------------
function darkSlide() {
  const s = pptx.addSlide();
  s.background = { color: INK };
  return s;
}
function lightSlide(title, kicker) {
  const s = pptx.addSlide();
  s.background = { color: PAPER };
  if (kicker) {
    s.addText(kicker.toUpperCase(), {
      x: M, y: 0.42, w: CW - 1.5, h: 0.25, fontFace: BF, fontSize: 11,
      color: MINT, bold: true, charSpacing: 2, margin: 0,
    });
  }
  s.addText(title, {
    x: M, y: 0.68, w: CW - 1.5, h: 0.7, fontFace: HF, fontSize: 33, bold: true,
    color: INK, margin: 0,
  });
  return s;
}
function chip(s, x, y, label, color, textColor) {
  s.addShape(pptx.ShapeType.roundRect, {
    x, y, w: 1.02, h: 0.3, fill: { color }, rectRadius: 0.14,
  });
  s.addText(label, {
    x, y, w: 1.02, h: 0.3, fontFace: BF, fontSize: 10, bold: true,
    color: textColor || WHITE, align: 'center', valign: 'middle', margin: 0,
  });
}
function footer(s, txt) {
  s.addText(txt, {
    x: M, y: 7.02, w: CW, h: 0.25, fontFace: BF, fontSize: 9,
    color: MUTED, margin: 0,
  });
}
// full-width emphasis strip, used to close a content slide
function strip(s, y, headline, sub) {
  s.addShape(pptx.ShapeType.roundRect, { x: M, y, w: CW, h: 0.92, fill: { color: NAVY }, rectRadius: 0.08 });
  s.addText(headline, {
    x: M + 0.42, y: y + 0.16, w: CW - 0.9, h: 0.32, fontFace: HF, fontSize: 16, bold: true, color: WHITE, margin: 0 });
  s.addText(sub, {
    x: M + 0.42, y: y + 0.5, w: CW - 0.9, h: 0.3, fontFace: BF, fontSize: 12, color: ICE, margin: 0 });
}

// =========================================================== 1. TITLE
{
  const s = darkSlide();
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.16, h: 7.5, fill: { color: MINT } });
  s.addText('NOVAMART · CAPSTONE · DEFINE PHASE COMPLETE', {
    x: 1.0, y: 1.55, w: 11, h: 0.3, fontFace: BF, fontSize: 12, bold: true,
    color: MINT, charSpacing: 2.5, margin: 0,
  });
  s.addText('Multi-Agent\nCustomer Support Crew', {
    x: 1.0, y: 2.05, w: 11, h: 1.9, fontFace: HF, fontSize: 50, bold: true,
    color: WHITE, lineSpacing: 56, margin: 0,
  });
  s.addText('Product scope review — what we are building first, and what we are deliberately not building.', {
    x: 1.0, y: 4.05, w: 9.6, h: 0.5, fontFace: BF, fontSize: 16, color: ICE, margin: 0,
  });
  s.addShape(pptx.ShapeType.line, {
    x: 1.0, y: 4.85, w: 3.2, h: 0, line: { color: MINT, width: 2 },
  });
  s.addText('13 MVP features locked   ·   6 agents   ·   0 money-moving actions', {
    x: 1.0, y: 5.1, w: 11, h: 0.35, fontFace: BF, fontSize: 14, color: WHITE, margin: 0,
  });
  s.addText('Source: project-context/1.define/prd.md — status FINAL-FOR-BUILD', {
    x: 1.0, y: 6.6, w: 11, h: 0.3, fontFace: BF, fontSize: 10, color: SLATE, margin: 0,
  });
}

// =========================================================== 2. THE PROBLEM
{
  const s = lightSlide('Support breaks on multi-step journeys', 'Why this exists');
  s.addText(
    'Today’s patterns — ticket queues, FAQ loops, one generic bot — handle single questions. They fail the actual journey: look up the order, apply the policy, give advice, then escalate with context.',
    { x: M, y: 1.55, w: 7.5, h: 0.9, fontFace: BF, fontSize: 15, color: MUTED, lineSpacing: 22, margin: 0 }
  );

  const pains = [
    ['Slow, repetitive L1', 'WISMO and policy questions dominate volume', 'Shopper'],
    ['Plus plan confusion', 'Trial-to-paid conversion slipped 28% → 22%', 'Plus trialist'],
    ['App issue spikes', 'Android v3.2.0 ticket cluster', 'Shopper + Ops'],
    ['Escalations lack context', 'Humans re-ask what the bot already knew', 'L1 agent'],
  ];
  let y = 2.7;
  pains.forEach(([t, d, who]) => {
    s.addShape(pptx.ShapeType.rect, { x: M, y, w: 0.055, h: 0.78, fill: { color: CORAL } });
    s.addText(t, { x: M + 0.22, y: y - 0.02, w: 4.3, h: 0.3, fontFace: BF, fontSize: 14, bold: true, color: INK, margin: 0 });
    s.addText(d, { x: M + 0.22, y: y + 0.28, w: 5.4, h: 0.45, fontFace: BF, fontSize: 12, color: MUTED, margin: 0 });
    s.addText(who, { x: 6.2, y: y + 0.02, w: 1.75, h: 0.3, fontFace: BF, fontSize: 10, bold: true, color: SLATE, align: 'right', margin: 0 });
    y += 1.0;
  });

  // right rail — the data we build against
  s.addShape(pptx.ShapeType.roundRect, { x: 8.55, y: 1.5, w: 4.08, h: 5.2, fill: { color: NAVY }, rectRadius: 0.1 });
  s.addText('GROUNDED IN REAL DATA', {
    x: 8.95, y: 1.8, w: 3.3, h: 0.3, fontFace: BF, fontSize: 10, bold: true, color: MINT, charSpacing: 1.5, margin: 0 });
  const stats = [['47,199', 'orders'], ['50,000', 'customers'], ['5,513', 'memberships'], ['500', 'products']];
  let sy = 2.28;                       // tightened so the closing note cannot collide
  stats.forEach(([n, l]) => {
    s.addText(n, { x: 8.95, y: sy, w: 3.3, h: 0.5, fontFace: NF, fontSize: 28, bold: true, color: WHITE, margin: 0 });
    s.addText(l, { x: 8.95, y: sy + 0.47, w: 3.3, h: 0.26, fontFace: BF, fontSize: 11, color: ICE, margin: 0 });
    sy += 0.92;
  });
  s.addShape(pptx.ShapeType.line, { x: 8.95, y: 5.95, w: 3.3, h: 0, line: { color: MINT, width: 1 } });
  s.addText('Answers come from these tables — never from model recall.', {
    x: 8.95, y: 6.08, w: 3.3, h: 0.5, fontFace: BF, fontSize: 11, italic: true, color: ICE, margin: 0 });

  footer(s, 'Source: PRD §1 Problem Statement; NovaMart practice DuckDB (inspected 2026-08-08)');
}

// =========================================================== 3. SCOPE LADDER  ***the spine***
{
  const s = lightSlide('Four tiers. Only the first one is the MVP.', 'The scope decision');
  s.addText('Everything below is already decided and frozen in the PRD. The MVP is tier one — nothing else is scheduled.', {
    x: M, y: 1.52, w: CW, h: 0.35, fontFace: BF, fontSize: 14, color: MUTED, margin: 0 });

  const tiers = [
    ['MVP', MINT,  'BUILD NOW',      '13 P0 features. Chat, 6 agents, grounded reads, escalation, trace, evals.', 'This is the whole build.'],
    ['P1',  AMBER, 'ONLY IF TIME',   '4 features. Soft-login, promo-aware answers, similar tickets, Spanish.',    'Not required for the demo.'],
    ['P2',  SLATE, 'FUTURE WORK',    '6 features. Analytics dashboard, L1 copilot, write APIs, omnichannel.',     'Needs a new PRD revision.'],
    ['OUT', CORAL, 'HARD EXCLUSION', 'Payments, refund execution, card data, real PII, replacing legal review.',  'Never, at any tier.'],
  ];
  let y = 2.15;
  tiers.forEach(([tag, color, head, body, note]) => {
    s.addShape(pptx.ShapeType.roundRect, { x: M, y, w: CW, h: 1.02, fill: { color: WHITE }, line: { color: LINEC, width: 1 }, rectRadius: 0.06 });
    s.addShape(pptx.ShapeType.rect, { x: M + 0.02, y: y + 0.06, w: 0.075, h: 0.9, fill: { color } });
    chip(s, M + 0.32, y + 0.36, tag, color, tag === 'P1' ? INK : WHITE);
    s.addText(head, { x: M + 1.55, y: y + 0.17, w: 2.3, h: 0.3, fontFace: BF, fontSize: 12, bold: true, color, charSpacing: 1, margin: 0 });
    s.addText(body, { x: M + 1.55, y: y + 0.5, w: 7.0, h: 0.4, fontFace: BF, fontSize: 12.5, color: INK, margin: 0 });
    s.addText(note, { x: 9.55, y: y + 0.35, w: 2.95, h: 0.35, fontFace: BF, fontSize: 11.5, italic: true, color: MUTED, align: 'right', margin: 0 });
    y += 1.15;
  });
  footer(s, 'Source: PRD §4 — P0 / P1 / P2 / OUT-01. Capstone freeze: build P0 only.');
}

// =========================================================== 4. THE MVP ITSELF
{
  const s = lightSlide('The MVP: 13 features, three jobs', 'Tier 1 — build now');
  chip(s, 11.6, 0.72, 'MVP', MINT);

  const groups = [
    ['Hold a conversation', MINT, [
      ['F-CHAT-01', 'Streaming chat UI'],
      ['F-TRIAGE-01', 'Intent + entity routing'],
      ['F-ORCH-01', 'Hop limits, loop guards'],
      ['F-CSAT-01', 'Post-resolution survey'],
    ]],
    ['Answer from facts', NAVY, [
      ['F-FAQ-01', 'Policy answers with citations'],
      ['F-ORDER-01', 'Order status and items'],
      ['F-PLUS-01', 'Membership status and rules'],
      ['F-RET-01', 'Returns advice — advice only'],
      ['F-TIME-01', 'Keeps 2024 data demo-current'],
    ]],
    ['Prove it worked', SLATE, [
      ['F-ESC-01', 'Escalation package + ticket'],
      ['F-TICKET-01', 'App-issue intake'],
      ['F-TRACE-01', 'Operator agent-trace panel'],
      ['F-EVAL-01', '8 scripted eval scenarios'],
    ]],
  ];

  let x = M;
  const colW = 3.79, gap = 0.28;   // 3*3.79 + 2*0.28 = 11.93
  groups.forEach(([title, color, items]) => {
    s.addShape(pptx.ShapeType.roundRect, { x, y: 1.62, w: colW, h: 4.0, fill: { color: WHITE }, line: { color: LINEC, width: 1 }, rectRadius: 0.08 });
    s.addShape(pptx.ShapeType.rect, { x, y: 1.62, w: colW, h: 0.075, fill: { color } });
    s.addText(title, { x: x + 0.28, y: 1.85, w: colW - 0.5, h: 0.35, fontFace: HF, fontSize: 17, bold: true, color: INK, margin: 0 });
    let iy = 2.42;
    items.forEach(([id, desc]) => {
      s.addShape(pptx.ShapeType.ellipse, { x: x + 0.28, y: iy + 0.08, w: 0.13, h: 0.13, fill: { color } });
      s.addText(id, { x: x + 0.52, y: iy, w: colW - 0.75, h: 0.26, fontFace: BF, fontSize: 11.5, bold: true, color, margin: 0 });
      s.addText(desc, { x: x + 0.52, y: iy + 0.25, w: colW - 0.75, h: 0.3, fontFace: BF, fontSize: 11.5, color: MUTED, margin: 0 });
      iy += 0.62;
    });
    x += colW + gap;
  });

  // NB: keep "P0" out of Georgia headlines — its oldstyle figures render it as "Po".
  strip(s, 5.85, 'Every one of the thirteen is required for the MVP demo.',
    'All 13 are P0. Nothing in P1, P2 or OUT is scheduled — adding any of them requires a new PRD revision.');
  footer(s, 'Source: PRD §4 P0 — Core Features');
}

// =========================================================== 5. HOW IT WORKS
{
  const s = lightSlide('One coordinator, four specialists, one exit', 'How the MVP works');
  chip(s, 11.6, 0.72, 'MVP', MINT);
  s.addText('The customer sees one assistant. Behind it, Triage picks exactly one specialist per turn — and every specialist can escalate.', {
    x: M, y: 1.5, w: CW, h: 0.35, fontFace: BF, fontSize: 14, color: MUTED, margin: 0 });

  // geometry
  const specY = [2.15, 3.02, 3.89, 4.76];      // tops
  const specH = 0.7;
  const centers = specY.map((v) => v + specH / 2);   // 2.50, 3.37, 4.24, 5.11
  const midY = (centers[0] + centers[3]) / 2;        // 3.805
  const busL = 3.66, busR = 7.30;

  // Triage
  s.addShape(pptx.ShapeType.roundRect, { x: M, y: midY - 0.75, w: 2.3, h: 1.5, fill: { color: NAVY }, rectRadius: 0.08 });
  s.addText('TRIAGE', { x: M, y: midY - 0.5, w: 2.3, h: 0.3, fontFace: BF, fontSize: 11, bold: true, color: MINT, align: 'center', charSpacing: 1.5, margin: 0 });
  s.addText('Intent +\nentities', { x: M, y: midY - 0.2, w: 2.3, h: 0.7, fontFace: HF, fontSize: 17, bold: true, color: WHITE, align: 'center', margin: 0 });

  // Triage -> distributor bus
  s.addShape(pptx.ShapeType.line, { x: 3.0, y: midY, w: 0.66, h: 0, line: { color: SLATE, width: 2 } });
  s.addShape(pptx.ShapeType.line, { x: busL, y: centers[0], w: 0, h: centers[3] - centers[0], line: { color: SLATE, width: 2 } });

  // specialists
  const specs = [['FAQ / Policy', 'grounded answers'], ['Order', 'status + items'], ['Plus', 'plan + benefits'], ['Returns', 'advice only']];
  specs.forEach(([n, d], i) => {
    s.addShape(pptx.ShapeType.line, { x: busL, y: centers[i], w: 0.34, h: 0, line: { color: SLATE, width: 1.5, endArrowType: 'triangle' } });
    s.addShape(pptx.ShapeType.roundRect, { x: 4.0, y: specY[i], w: 2.9, h: specH, fill: { color: WHITE }, line: { color: MINT, width: 1.5 }, rectRadius: 0.06 });
    s.addText(n, { x: 4.2, y: specY[i] + 0.07, w: 2.6, h: 0.28, fontFace: BF, fontSize: 13, bold: true, color: INK, margin: 0 });
    s.addText(d, { x: 4.2, y: specY[i] + 0.35, w: 2.6, h: 0.26, fontFace: BF, fontSize: 11, color: MUTED, margin: 0 });
    // specialist -> collector bus
    s.addShape(pptx.ShapeType.line, { x: 6.9, y: centers[i], w: busR - 6.9, h: 0, line: { color: SLATE, width: 1.5 } });
  });
  // collector bus
  s.addShape(pptx.ShapeType.line, { x: busR, y: centers[0], w: 0, h: centers[3] - centers[0], line: { color: SLATE, width: 2 } });

  // outcomes — both fed from the collector bus, so no arrow points at empty space
  const ansY = 2.42, escY = 4.28, outH = 1.15;
  s.addShape(pptx.ShapeType.line, { x: busR, y: ansY + outH / 2, w: 0.32, h: 0, line: { color: MINT, width: 2, endArrowType: 'triangle' } });
  s.addShape(pptx.ShapeType.line, { x: busR, y: escY + outH / 2, w: 0.32, h: 0, line: { color: CORAL, width: 2, endArrowType: 'triangle' } });

  s.addShape(pptx.ShapeType.roundRect, { x: 7.65, y: ansY, w: 2.5, h: outH, fill: { color: MINT }, rectRadius: 0.08 });
  s.addText('Answer', { x: 7.65, y: ansY + 0.22, w: 2.5, h: 0.35, fontFace: HF, fontSize: 17, bold: true, color: WHITE, align: 'center', margin: 0 });
  s.addText('with citations', { x: 7.65, y: ansY + 0.6, w: 2.5, h: 0.3, fontFace: BF, fontSize: 11, color: WHITE, align: 'center', margin: 0 });

  s.addShape(pptx.ShapeType.roundRect, { x: 7.65, y: escY, w: 2.5, h: outH, fill: { color: CORAL }, rectRadius: 0.08 });
  s.addText('Escalate', { x: 7.65, y: escY + 0.22, w: 2.5, h: 0.35, fontFace: HF, fontSize: 17, bold: true, color: WHITE, align: 'center', margin: 0 });
  s.addText('ticket + summary', { x: 7.65, y: escY + 0.6, w: 2.5, h: 0.3, fontFace: BF, fontSize: 11, color: WHITE, align: 'center', margin: 0 });

  // guardrail rail
  s.addShape(pptx.ShapeType.roundRect, { x: 10.45, y: 2.15, w: 2.18, h: 3.28, fill: { color: INK }, rectRadius: 0.08 });
  s.addText('THE GUARDRAIL', { x: 10.7, y: 2.42, w: 1.75, h: 0.3, fontFace: BF, fontSize: 9.5, bold: true, color: MINT, charSpacing: 1, margin: 0 });
  s.addText('If it cannot be\ngrounded, or it\nmoves money,\nit escalates.', {
    x: 10.7, y: 2.85, w: 1.8, h: 1.5, fontFace: BF, fontSize: 13, color: WHITE, lineSpacing: 19, margin: 0 });
  s.addText('No exceptions.', { x: 10.7, y: 4.55, w: 1.8, h: 0.3, fontFace: BF, fontSize: 12, bold: true, italic: true, color: MINT, margin: 0 });

  strip(s, 5.85, 'Returns may follow Order in the same turn. No other specialist-to-specialist handoff exists.',
    'Escalation is terminal for the thread until the customer sends a new message.');
  footer(s, 'Source: PRD §3.1–3.3 — orchestration and permitted handoff edges');
}

// =========================================================== 6. NOT IN THE MVP
{
  const s = lightSlide('What we are deliberately not building', 'Scope discipline');
  s.addText('Each of these was considered and cut. Naming them now is what keeps the MVP deliverable.', {
    x: M, y: 1.5, w: CW, h: 0.35, fontFace: BF, fontSize: 14, color: MUTED, margin: 0 });

  const cols = [
    ['P1', AMBER, 'Scheduled only if time remains', [
      'Email + order correlation soft-login',
      'Promo-aware answers',
      '“Similar open tickets” lookup',
      'Spanish responses',
    ], 'A stretch goal, not a commitment.'],
    ['P2', SLATE, 'Requires a new PRD revision', [
      'Scenario D causal dashboard',
      'L1 agent copilot UI',
      'Refund / cancel write APIs',
      'Email, voice, social channels',
      'Zendesk / Gorgias export',
      'Production database',
    ], null],
    ['OUT', CORAL, 'Excluded at every tier', [
      'Payment capture, refund execution',
      'Card data handling',
      'Causal analysis for app v3.2.0',
      'Training on real PII',
      'Production secrets in git',
      'Replacing human legal review',
    ], null],
  ];

  let x = M;
  const colW = 3.79, gap = 0.28;
  cols.forEach(([tag, color, sub, items, note]) => {
    s.addShape(pptx.ShapeType.roundRect, { x, y: 2.1, w: colW, h: 4.45, fill: { color: WHITE }, line: { color: LINEC, width: 1 }, rectRadius: 0.08 });
    chip(s, x + 0.28, 2.38, tag, color, tag === 'P1' ? INK : WHITE);
    s.addText(sub, { x: x + 0.28, y: 2.82, w: colW - 0.55, h: 0.5, fontFace: BF, fontSize: 11.5, bold: true, color, margin: 0 });
    let iy = 3.42;
    items.forEach((it) => {
      s.addText('—', { x: x + 0.28, y: iy, w: 0.22, h: 0.26, fontFace: BF, fontSize: 11, color, margin: 0 });
      s.addText(it, { x: x + 0.55, y: iy, w: colW - 0.85, h: 0.45, fontFace: BF, fontSize: 12, color: MUTED, margin: 0 });
      iy += 0.5;
    });
    if (note) {
      s.addShape(pptx.ShapeType.line, { x: x + 0.28, y: 5.7, w: colW - 0.56, h: 0, line: { color: LINEC, width: 1 } });
      s.addText(note, { x: x + 0.28, y: 5.85, w: colW - 0.56, h: 0.5, fontFace: BF, fontSize: 11.5, italic: true, color, margin: 0 });
    }
    x += colW + gap;
  });
  footer(s, 'Source: PRD §4 — P1 / P2 / OUT-01 hard exclusions');
}

// =========================================================== 7. SUCCESS BAR
{
  const s = lightSlide('How we will know the MVP worked', 'Definition of done');
  chip(s, 11.6, 0.72, 'MVP', MINT);

  const big = [
    ['≥ 40%', 'Containment', 'of in-scope demo scripts resolved without a human', MINT],
    ['≥ 90%', 'Grounded', 'of auto-resolved answers cite a tool or policy source', NAVY],
    ['100%', 'Escalations complete', 'every handoff carries intent, entities, steps tried', SLATE],
    ['0', 'Unsafe actions', 'money movement or fabricated totals — hard CI fail', CORAL],
  ];
  let x = M;
  const cw2 = 2.8025, g2 = 0.24;   // 4*2.8025 + 3*0.24 = 11.93 exactly
  big.forEach(([n, l, d, c]) => {
    s.addShape(pptx.ShapeType.roundRect, { x, y: 1.75, w: cw2, h: 2.55, fill: { color: WHITE }, line: { color: LINEC, width: 1 }, rectRadius: 0.08 });
    s.addShape(pptx.ShapeType.rect, { x, y: 1.75, w: cw2, h: 0.075, fill: { color: c } });
    s.addText(n, { x: x + 0.24, y: 2.0, w: cw2 - 0.48, h: 0.8, fontFace: NF, fontSize: 40, bold: true, color: c, margin: 0 });
    s.addText(l, { x: x + 0.24, y: 2.88, w: cw2 - 0.48, h: 0.3, fontFace: BF, fontSize: 13.5, bold: true, color: INK, margin: 0 });
    s.addText(d, { x: x + 0.24, y: 3.22, w: cw2 - 0.48, h: 0.85, fontFace: BF, fontSize: 11.5, color: MUTED, margin: 0 });
    x += cw2 + g2;
  });

  s.addShape(pptx.ShapeType.roundRect, { x: M, y: 4.62, w: CW, h: 1.8, fill: { color: NAVY }, rectRadius: 0.08 });
  s.addText('AND THE SUPPORTING BAR', { x: M + 0.42, y: 4.86, w: 5, h: 0.3, fontFace: BF, fontSize: 10, bold: true, color: MINT, charSpacing: 1.5, margin: 0 });
  const smalls = [
    ['First response', '< 5 sec'],
    ['CSAT on resolved', '≥ 3.5 / 5'],
    ['Task completion', '≥ 80%'],
    ['Eval suite in CI', '100% green'],
  ];
  let sx = M + 0.42;
  const sw = (CW - 0.84) / 4;   // 2.7625
  smalls.forEach(([l, v]) => {
    s.addText(v, { x: sx, y: 5.26, w: sw - 0.15, h: 0.42, fontFace: NF, fontSize: 21, bold: true, color: WHITE, margin: 0 });
    s.addText(l, { x: sx, y: 5.72, w: sw - 0.15, h: 0.3, fontFace: BF, fontSize: 11.5, color: ICE, margin: 0 });
    sx += sw;
  });
  footer(s, 'Source: PRD §7 — Success Metrics & KPIs');
}

// =========================================================== 8. PLAN
{
  const s = lightSlide('Where we are, and what happens next', 'Delivery plan');

  const phases = [
    ['DEFINE', 'Complete', 'MRD, PRD and SAD finalized and frozen. 13 P0 features locked.', MINT, true],
    ['BUILD', 'Next', 'P0 only, in four isolated modules: core config → API → frontend → validation.', NAVY, false],
    ['DELIVER', 'After QA gate', 'Deploy config, CI pipeline, runbook and user guide. No live deploy without sign-off.', SLATE, false],
  ];
  let x = M;
  const pw = 3.79, pg = 0.28;
  phases.forEach(([t, status, d, c, done]) => {
    s.addShape(pptx.ShapeType.roundRect, { x, y: 1.7, w: pw, h: 2.2, fill: { color: done ? c : WHITE }, line: { color: done ? c : LINEC, width: 1 }, rectRadius: 0.08 });
    s.addText(t, { x: x + 0.3, y: 1.92, w: pw - 0.6, h: 0.32, fontFace: BF, fontSize: 12, bold: true, color: done ? WHITE : c, charSpacing: 2, margin: 0 });
    s.addText(status, { x: x + 0.3, y: 2.26, w: pw - 0.6, h: 0.45, fontFace: HF, fontSize: 21, bold: true, color: done ? WHITE : INK, margin: 0 });
    s.addText(d, { x: x + 0.3, y: 2.8, w: pw - 0.6, h: 0.95, fontFace: BF, fontSize: 12, color: done ? WHITE : MUTED, margin: 0 });
    x += pw + pg;
  });

  s.addText('The success bar is a working demo with a green eval suite — not a production SLA.', {
    x: M, y: 4.15, w: CW, h: 0.4, fontFace: HF, fontSize: 18, bold: true, color: INK, margin: 0 });

  s.addText('RISKS WE ARE ALREADY MANAGING', {
    x: M, y: 4.78, w: CW, h: 0.28, fontFace: BF, fontSize: 10, bold: true, color: AMBER, charSpacing: 1.5, margin: 0 });

  const risks = [
    ['Practice data is 2024-dated', 'A single date offset makes every demo current. Designed and validated against the real DB.'],
    ['Multi-agent latency', 'Hard cap of 4 specialist hops and a 60-second turn budget, then force-escalate.'],
    ['Hallucinated policy or totals', 'Answers must cite a tool or policy source, or the turn escalates instead.'],
  ];
  let ry = 5.2;
  risks.forEach(([r, m]) => {
    s.addShape(pptx.ShapeType.ellipse, { x: M, y: ry + 0.07, w: 0.14, h: 0.14, fill: { color: AMBER } });
    s.addText(r, { x: M + 0.3, y: ry, w: 3.9, h: 0.3, fontFace: BF, fontSize: 12.5, bold: true, color: INK, margin: 0 });
    s.addText(m, { x: 4.6, y: ry, w: 8.0, h: 0.3, fontFace: BF, fontSize: 12.5, color: MUTED, margin: 0 });
    ry += 0.52;
  });
  footer(s, 'Source: PRD §8 Implementation Strategy; Capstone timeline realism');
}

// =========================================================== 9. CLOSE
{
  const s = darkSlide();
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.16, h: 7.5, fill: { color: MINT } });
  s.addText('THE ASK', { x: 1.0, y: 1.5, w: 11, h: 0.3, fontFace: BF, fontSize: 12, bold: true, color: MINT, charSpacing: 2.5, margin: 0 });
  s.addText('Approve the MVP boundary.', {
    x: 1.0, y: 1.95, w: 11, h: 0.9, fontFace: HF, fontSize: 40, bold: true, color: WHITE, margin: 0 });
  s.addText('Build the 13 P0 features and nothing else. P1 only if time remains. P2 needs a new PRD revision. OUT stays out.', {
    x: 1.0, y: 3.0, w: 9.8, h: 0.8, fontFace: BF, fontSize: 16, color: ICE, lineSpacing: 24, margin: 0 });

  const asks = [
    ['Confirm', '13 P0 features are the complete build'],
    ['Accept', 'no money movement in any MVP path'],
    ['Agree', 'demo + green evals is the success bar'],
  ];
  let ax = 1.0;
  asks.forEach(([k, v]) => {
    s.addShape(pptx.ShapeType.roundRect, { x: ax, y: 4.25, w: 3.6, h: 1.45, fill: { color: NAVY }, rectRadius: 0.08 });
    s.addText(k, { x: ax + 0.3, y: 4.5, w: 3.0, h: 0.35, fontFace: HF, fontSize: 20, bold: true, color: MINT, margin: 0 });
    s.addText(v, { x: ax + 0.3, y: 4.9, w: 3.0, h: 0.65, fontFace: BF, fontSize: 12.5, color: WHITE, margin: 0 });
    ax += 3.85;
  });
  s.addText('Full detail: project-context/1.define/prd.md · sad.md · mrd.md', {
    x: 1.0, y: 6.5, w: 11, h: 0.3, fontFace: BF, fontSize: 10, color: SLATE, margin: 0 });
}

pptx.writeFile({ fileName: process.argv[2] || 'novamart-prd-scope.pptx' })
  .then((f) => console.log('wrote', f));
