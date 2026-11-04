// Computergegner im Browser (ohne ?mock). Start:
//   cd /home/user/zockerhoelle && python3 -m http.server 8781 &
//   NODE_PATH=$(npm root -g) node tests/muehle.bot.e2e.cjs
const { chromium } = require('playwright');
const path = require('path');
const PORT = process.env.PORT || 8781;
const BASE = `http://localhost:${PORT}/muehle/index.html`;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
const errors = [];
const fail = (m) => { console.log('FEHLER:', m); errors.push(m); };
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

async function opts(page) {
  return page.evaluate(() => {
    const pt = (el) => [el.getAttribute('cx'), el.getAttribute('cy')].join(',');
    const idx = {};
    document.querySelectorAll('#mh-board .mh-hit').forEach((h) => { idx[pt(h)] = Number(h.dataset.p); });
    const pick = (cls) => [...document.querySelectorAll('#mh-board circle.' + cls)].map((c) => idx[pt(c)]);
    return { free: pick('mh-free'), can: pick('mh-can'), target: pick('mh-target'), rem: pick('mh-rem') };
  });
}
const banner = async (page) => (await page.locator('.banner').first().innerText().catch(() => '')).trim();
const mine = async (page) => /Du bist dran/.test(await banner(page));
const stones = (page) => page.locator('#mh-board circle.mh-stone-w, #mh-board circle.mh-stone-b').count();
const isOver = async (page) => (await page.locator('.mh-over').count()) > 0;
const tapP = (page, p) => page.click(`#mh-board [data-p="${p}"]`, { timeout: 4000 });
async function waitMine(page, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await isOver(page)) return false;
    if (await mine(page)) return true;
    await page.waitForTimeout(80);
  }
  return false;
}
async function step(page) {
  const o = await opts(page);
  if (o.rem.length) { await tapP(page, rnd(o.rem)); return 'remove'; }
  if (o.free.length) { await tapP(page, rnd(o.free)); return 'place'; }
  if (o.can.length) {
    const from = rnd(o.can);
    await tapP(page, from);
    await page.waitForSelector('#mh-board circle.mh-sel');
    const t = (await opts(page)).target;
    await tapP(page, rnd(t));
    return 'move';
  }
  return null;
}
// Ein Zug des Menschen; danach muss der Computer von selbst ziehen (Banner wechselt weg und zurück)
async function humanThenBot(page, label) {
  if (!(await waitMine(page))) return false;
  const before = await stones(page);
  const r = await step(page);
  if (!r) return false;
  if (await isOver(page)) return true;
  await page.waitForTimeout(150);
  const b1 = await banner(page);
  if (r !== 'remove' || !/Du bist dran/.test(b1)) {
    // nach meinem Zug (außer mein Zug war nur der erste Teil einer Mühle) ist der Computer dran
    if (/Du bist dran/.test(b1) && r !== 'remove') {
      const o = await opts(page);
      if (!o.rem.length) fail(`${label}: Banner wechselt nach meinem Zug nicht`);
    }
  }
  return true;
}

async function startBot(page, level, name) {
  await page.goto(BASE);
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* egal */ } });
  await page.goto(BASE);
  await page.fill('#name', name);
  await page.click(`[data-act=bot][data-level="${level}"]`);
  await page.waitForSelector('#mh-board');
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail('pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') fail('console ' + m.text()); });

  // ---------- Mittel ----------
  await page.goto(BASE);
  await page.fill('#name', 'Anna');
  await page.screenshot({ path: path.join(SHOTS, 'muehle-bot-start.png') });
  await page.click('[data-act=bot][data-level="1"]');
  await page.waitForSelector('#mh-board');
  if (!(await mine(page))) fail('Mensch sollte beginnen: ' + (await banner(page)));
  await page.screenshot({ path: path.join(SHOTS, 'muehle-bot-1-start.png') });

  // erster Zug, dann zieht der Computer von selbst
  await step(page);
  await page.waitForTimeout(150);
  if (!/Computer ist dran/.test(await banner(page))) fail('Banner nach Zug: ' + (await banner(page)));
  await page.screenshot({ path: path.join(SHOTS, 'muehle-bot-2-wartet.png') });
  if (!(await waitMine(page, 5000))) fail('Computer zieht nicht von selbst');
  if ((await stones(page)) !== 2) fail('Erwartet 2 Steine, sind ' + (await stones(page)));
  console.log('Computer hat gezogen; Steine:', await stones(page));

  // weiterspielen, dann Remis anbieten -> wird abgelehnt
  for (let i = 0; i < 3; i++) await humanThenBot(page, 'Vorspiel');
  if (!(await waitMine(page, 5000))) fail('nicht wieder dran');
  await page.click('[data-act=draw-offer]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, 'muehle-bot-3-remis.png') });
  const t0 = Date.now();
  let declined = false;
  while (Date.now() - t0 < 5000) {
    if (/abgelehnt/.test(await page.locator('.recap').innerText().catch(() => ''))) { declined = true; break; }
    await page.waitForTimeout(100);
  }
  if (!declined) fail('Remis-Angebot wurde nicht abgelehnt');
  else console.log('Remis abgelehnt:', (await page.locator('.recap li').first().innerText()));
  if (await page.locator('[data-act=draw-accept]').count()) fail('Annahme-Knopf beim Menschen?');

  // Neuladen mitten im Spiel, während der Computer dran ist
  await waitMine(page, 8000);
  await step(page);
  await page.waitForTimeout(150);
  const nBefore = await stones(page);
  await page.reload();
  await page.waitForSelector('#mh-board');
  console.log('Nach Neuladen:', await banner(page), '| Steine', await stones(page));
  if ((await stones(page)) < nBefore - 1) fail('Spielstand nach Neuladen weg');
  await page.screenshot({ path: path.join(SHOTS, 'muehle-bot-4-neuladen.png') });
  if (!(await waitMine(page, 6000))) fail('Computer macht nach Neuladen nicht weiter: ' + (await banner(page)));

  // bis zum Ende
  const t1 = Date.now();
  let shot = false;
  while (!(await isOver(page)) && Date.now() - t1 < 240000) {
    if (!(await waitMine(page, 8000))) { if (await isOver(page)) break; fail('Computer hängt: ' + (await banner(page))); break; }
    await step(page).catch((e) => fail('Zug: ' + e.message));
    if (!shot && /Phase 2/.test(await page.locator('.mh-phase').first().innerText().catch(() => ''))) {
      shot = true; await page.screenshot({ path: path.join(SHOTS, 'muehle-bot-5-ziehphase.png') });
    }
  }
  if (!(await isOver(page))) {
    console.log('Partie lang: gebe auf');
    await page.click('[data-act=resign]'); await page.click('[data-act=resign-yes]');
  }
  await page.waitForSelector('.mh-over');
  console.log('Ende:', (await page.locator('.mh-over h1').innerText()).replace(/\n/g, ' '), '|', await page.locator('.mh-reason').innerText());
  await page.screenshot({ path: path.join(SHOTS, 'muehle-bot-6-ende.png'), fullPage: true });

  // Noch eine Runde
  await page.click('[data-act=again]');
  await page.waitForSelector('#mh-board');
  if ((await page.locator('.mh-over').count()) || (await page.locator('.mh-over').count())) fail('Siegerbildschirm bleibt');
  // Computer oder Mensch beginnt; in beiden Fällen muss es nach spätestens kurzer Zeit weitergehen
  await waitMine(page, 5000);
  const startedBy = (await stones(page)) > 0 ? 'Computer' : 'Mensch';
  await step(page);
  if (!(await waitMine(page, 5000))) fail('Zweite Runde: Computer zieht nicht');
  console.log('Zweite Runde läuft; begonnen hat:', startedBy, '| Steine', await stones(page));
  await page.screenshot({ path: path.join(SHOTS, 'muehle-bot-7-runde2.png') });

  // ---------- Leicht (kurz) ----------
  await page.click('[data-act=resign]'); await page.click('[data-act=resign-yes]');
  await page.waitForSelector('.mh-over');
  await page.click('[data-act=leave-now]');
  await page.waitForSelector('[data-act=bot][data-level="0"]');
  await page.click('[data-act=bot][data-level="0"]');
  await page.waitForSelector('#mh-board');
  for (let i = 0; i < 6; i++) {
    if (!(await waitMine(page, 5000))) { fail('Leicht: Computer zieht nicht'); break; }
    await step(page);
  }
  await waitMine(page, 5000);
  console.log('Leicht: Steine nach 6 Zügen', await stones(page));
  await page.screenshot({ path: path.join(SHOTS, 'muehle-bot-8-leicht.png') });

  await browser.close();
  console.log('errors', JSON.stringify(errors));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.log('ABBRUCH', e); process.exit(2); });
