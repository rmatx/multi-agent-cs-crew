/**
 * Records "Final Submission/NovaMart-demo-60s.mp4" — the two-turn demo, against the DEPLOYED app.
 *
 *   npm i playwright                       (not a project dependency)
 *   FINAL_DEMO_PASSWORD=… node week5/assets/demo-record.js out/
 *   ffmpeg -i out/*.webm -c:v libx264 -crf 20 -pix_fmt yuv420p demo.mp4
 *
 * A single unedited take: no cuts, no speed-up. The waits in the finished video are the real
 * model latency, which is the honest thing to show and also the thing worth rehearsing against.
 *
 * httpCredentials rather than credentials in the URL: a page whose own URL carries credentials
 * cannot call fetch() at all ("Request cannot be constructed from a URL that includes
 * credentials"), which breaks the very thing being demonstrated. This is the same trap that bit
 * the first browser test of /final.
 *
 * The password comes from the environment. Nothing here writes it to disk.
 */
const { chromium } = require("playwright");

const URL_BASE = "https://multi-agent-cs-crew-production.up.railway.app";
const PASSWORD = process.env.FINAL_DEMO_PASSWORD;
if (!PASSWORD) { console.error("set FINAL_DEMO_PASSWORD"); process.exit(1); }

const OUT = process.argv[2] || "video";
const W = 1280, H = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });  // system Chrome: the bundled build is not in the cache
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 2,
    httpCredentials: { username: "reviewer", password: PASSWORD },
    recordVideo: { dir: OUT, size: { width: W, height: H } },
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  const t0 = Date.now();
  const mark = (s) => console.log(`  ${String((Date.now() - t0) / 1000).padStart(5)}s  ${s}`);

  await page.goto(`${URL_BASE}/final`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Reviewer build");
  mark("loaded /final");
  await sleep(3200);                                   // let a viewer read the strip

  // Keep the crew strip, the picker and the conversation all in frame for the whole run.
  await page.evaluate(() => window.scrollTo({ top: 150, behavior: "smooth" }));
  await sleep(1600);

  async function turn(chip, label, doneText, capMs) {
    await page.locator(`button:has-text("${chip}")`).click();
    mark(`picked "${chip}"`);
    await sleep(1500);                                 // the form visibly fills
    await page.locator('button:text-is("Run")').click();
    const started = Date.now();
    mark(`run ${label}`);
    await page.waitForFunction(
      (t) => document.body.innerText.includes(t),
      doneText,
      { timeout: capMs },
    );
    mark(`${label} done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }

  // Turn 1 — inside the window: resolves, and cites what it read.
  await turn("Return, inside the window", "turn 1", "Sources:", 90_000);
  await page.evaluate(() => window.scrollTo({ top: 420, behavior: "smooth" }));
  await sleep(4200);                                   // read the answer and the citations

  // Turn 2 — three days later: same question, handed to a person.
  await page.evaluate(() => window.scrollTo({ top: 150, behavior: "smooth" }));
  await sleep(900);
  await turn("Return, just outside", "turn 2", "Handed to a human", 120_000);
  await page.evaluate(() => window.scrollTo({ top: 520, behavior: "smooth" }));
  await sleep(5200);                                   // the ticket, and the handoff packet

  mark(`total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await context.close();                                // flushes the video
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
