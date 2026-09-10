/**
 * Records the 2-minute submission demo against the DEPLOYED app.
 *
 * Three turns, chosen so each one answers a different objection:
 *   1. inside the window   — it reads, and cites what it read
 *   2. three days later    — it stops, and hands a person a real packet
 *   3. "I want a refund"   — it cannot comply, because no refund tool exists
 *
 * httpCredentials rather than credentials in the URL: a page whose own URL carries credentials
 * cannot call fetch() at all, which would produce a crisp recording of the app failing.
 */
const { chromium } = require("playwright");

const BASE = "https://multi-agent-cs-crew-production.up.railway.app";
const PASSWORD = process.env.FINAL_DEMO_PASSWORD;
if (!PASSWORD) { console.error("set FINAL_DEMO_PASSWORD"); process.exit(1); }

const OUT = process.argv[2] || "video2";
const W = 1280, H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 2,
    httpCredentials: { username: "reviewer", password: PASSWORD },
    recordVideo: { dir: OUT, size: { width: W, height: H } },
    colorScheme: "light",
  });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("    [console] " + m.text().slice(0, 160)); });
  page.on("response", (r) => {
    if (r.url().includes("/api/chat")) console.log(`    [api/chat] ${r.status()}`);
  });
  const t0 = Date.now();
  const at = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
  const mark = (s) => console.log(`  ${at()}s  ${s}`);
  const scroll = async (top) => {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), top);
    await sleep(800);
  };

  await page.goto(`${BASE}/final`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Reviewer build");
  mark("loaded");
  await sleep(3800);                       // the reviewer strip and the run-sheet link
  await scroll(150);
  await sleep(2200);                       // crew strip + 23 scenarios

  /*
   * Each scenario runs in its OWN conversation. Asking the same question twice in one
   * conversation with a different order id makes the coordinator stop and ask which order is
   * meant — `needs_input`, not `escalated`. That is correct behaviour and the wrong thing to
   * film: it derails the escalation the demo exists to show. Reset is what starts a fresh
   * conversation, so it is pressed between scenarios rather than trusted to luck.
   */
  /*
   * Each scenario runs in its OWN conversation. Asking the same question twice in one
   * conversation with a different order id makes the coordinator stop and ask which order is
   * meant — `needs_input`, not `escalated`. Correct behaviour, wrong thing to film.
   *
   * And the turn is considered finished when the Run button is enabled again, not when some
   * expected sentence appears. Waiting on the sentence conflates "still running" with "finished
   * differently", which is what made two earlier takes fail after a full two-minute timeout
   * instead of telling me the boundary case had resolved rather than escalated.
   */
  async function finishTurn(capMs) {
    await page.locator('button:text-is("Run")').waitFor({ state: "attached", timeout: capMs });
    await page.waitForFunction(
      () => {
        const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === "Run");
        return b !== undefined && !b.disabled;
      },
      undefined,
      { timeout: capMs },
    );
  }

  async function turn(chip, label, expect, capMs) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const r = page.locator('button:text-is("Reset")');
      if (await r.isEnabled().catch(() => false)) { await r.click(); await sleep(900); }
      await page.locator(`button:has-text("${chip}")`).click();
      await sleep(1400);
      await page.locator('button:text-is("Run")').click();
      const started = Date.now();
      mark(`▶ ${label}${attempt > 1 ? ` (retry ${attempt})` : ""}`);
      await finishTurn(capMs);
      const body = await page.evaluate(() => document.body.innerText);
      const got = body.includes(expect);
      mark(`  ${got ? "✓" : "✗"} ${label} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      if (got) return true;
      // The 15-day boundary sometimes answers and OFFERS escalation instead of escalating.
      // One retry in a fresh conversation, then film whatever it does rather than hang.
      mark(`  did not reach "${expect}" — retrying once in a fresh conversation`);
    }
    return false;
  }

  // ── 1. inside the window ────────────────────────────────────────────────
  await turn("Return, inside the window", "turn 1 · resolved", "Sources:", 150_000);
  await scroll(430);
  await sleep(4800);                       // the answer, then the citations under it

  // ── 2. three days later ─────────────────────────────────────────────────
  await scroll(150);
  await turn("Return, just outside", "turn 2 · escalated", "Handed to a human", 150_000);
  await scroll(520);
  await sleep(3600);                       // the ticket id and the reason code

  // What the human actually receives — the part that makes "handed off" concrete.
  const packet = page.locator('button:has-text("What the human receives")').last();
  if (await packet.count()) {
    await packet.click();
    mark("opened the handoff packet");
    await sleep(1000);
    await scroll(660);
    await sleep(5200);
  }

  // The operator trace: hops and tool calls, counted by the runtime.
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("button")].find((b) => /Operator trace/.test(b.textContent || ""));
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  await sleep(5000);
  mark("showed the operator trace");

  // ── 3. the money boundary ───────────────────────────────────────────────
  await scroll(150);
  await turn("Refund request", "turn 3 · refund refused", "Handed to a human", 150_000);
  await scroll(560);
  await sleep(6000);                       // it never claims to have refunded anything

  mark(`total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await context.close();
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
