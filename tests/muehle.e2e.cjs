// Durchspieltest im Browser (zwei Tabs, Test-Modus ?mock=1).
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8772 &  dann  NODE_PATH=$(npm root -g) node tests/muehle.e2e.cjs
const { chromium } = require('playwright');
const path = require('path');
const PORT = process.env.PORT || 8772;
const BASE = `http://localhost:${PORT}/muehle/index.html?mock=1`;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
const errors = [];
const fail = (m) => { console.log('FEHLER:', m); errors.push(m); };

async function opts(page) {
  return page.evaluate(() => {
    const pt = (el) => [el.getAttribute('cx'), el.getAttribute('cy')].join(',');
    const idx = {};
    document.querySelectorAll('#mh-board .mh-hit').forEach((h) => { idx[pt(h)] = Number(h.dataset.p); });
    const pick = (cls) => [...document.querySelectorAll('#mh-board circle.' + cls)].map((c) => idx[pt(c)]);
    return { free: pick('mh-free'), can: pick('mh-can'), target: pick('mh-target'), rem: pick('mh-rem') };
  });
}
const mine = async (page) => /Du bist dran/.test(await page.locator('.banner').first().innerText().catch(() => ''));
const tapP = (page, p) => page.click(`#mh-board [data-p="${p}"]`, { timeout: 4000 });
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

async function step(page) {
  const o = await opts(page);
  if (o.rem.length) { await tapP(page, rnd(o.rem)); return 'remove'; }
  if (o.free.length) { await tapP(page, rnd(o.free)); return 'place'; }
  if (o.can.length) {
    const from = rnd(o.can);
    await tapP(page, from);
    await page.waitForSelector('#mh-board circle.mh-sel');
    const t = (await opts(page)).target;
    if (!t.length) throw new Error('keine Ziele nach Auswahl');
    await tapP(page, rnd(t));
    return 'move';
  }
  return null;
}
const isOver = async (page) => (await page.locator('.mh-over').count()) > 0;

async function playUntilOver(a, b, maxMoves) {
  let n = 0;
  while (n++ < maxMoves) {
    if ((await isOver(a)) && (await isOver(b))) return true;
    let acted = false;
    for (const p of [a, b]) {
      if (await isOver(p)) continue;
      if (await mine(p)) {
        const r = await step(p).catch((e) => { fail('Zug: ' + e.message); return null; });
        if (r) { acted = true; await p.waitForTimeout(25); break; }
      }
    }
    if (!acted) await a.waitForTimeout(40);
  }
  return false;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const A = await ctx.newPage();
  const B = await ctx.newPage();
  for (const [n, p] of [['A', A], ['B', B]]) {
    p.on('pageerror', (e) => fail(`${n} pageerror ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') fail(`${n} console ${m.text()}`); });
  }
  await A.goto(BASE);
  await A.fill('#name', 'Anna');
  await A.click('[data-act=host]');
  await A.waitForSelector('.code');
  const code = (await A.locator('.code').innerText()).trim();
  console.log('Code', code);
  await B.goto(BASE + '&raum=' + code);
  await B.fill('#name', 'Ben');
  await B.click('[data-act=join-invited]');
  await A.waitForSelector('[data-act=start]');
  await A.screenshot({ path: path.join(SHOTS, 'muehle-lobby.png') });
  await A.click('[data-act=start]');
  await A.waitForSelector('#mh-board');
  await B.waitForSelector('#mh-board');
  await A.screenshot({ path: path.join(SHOTS, 'muehle-start-A.png') });
  await B.screenshot({ path: path.join(SHOTS, 'muehle-start-B.png') });

  // Hilfe
  await A.click('[data-act=help]');
  if (!(await A.locator('.modal').innerText()).includes('Mühle')) fail('Hilfe fehlt');
  await A.screenshot({ path: path.join(SHOTS, 'muehle-help.png') });
  await A.evaluate(() => document.querySelector('.overlay').scrollTo(0, 99999));
  await A.screenshot({ path: path.join(SHOTS, 'muehle-help-end.png') });
  { const bb = await A.locator('.modal [data-act=help-close]').boundingBox(); await A.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); }
  if (await A.locator('.modal').count()) fail('Hilfe lässt sich nicht schließen');

  // Unerlaubtes: Banner prüfen, Nicht-Dran-Seite darf nichts bewirken
  if (!(await mine(A))) fail('A sollte beginnen');
  await tapP(B, 3); // B ist nicht dran
  if ((await A.locator('#mh-board circle.mh-stone-w, #mh-board circle.mh-stone-b').count()) !== 0) fail('Zug von falscher Person');
  // Besetzten Punkt antippen -> Hinweis
  await tapP(A, 0); await B.waitForTimeout(100);
  await tapP(B, 0);
  if (!(await B.locator('.mh-hint').count())) fail('Hinweis bei besetztem Punkt fehlt');
  await tapP(B, 1);

  // Zwischen-Screenshots in Ziehphase: erst eine Weile spielen
  let shotDone = false;
  // Partie 1: bis zum Ende
  const t0 = Date.now();
  let over = false;
  for (let round = 0; round < 40 && !over; round++) {
    over = await playUntilOver(A, B, 60);
    if (!shotDone) {
      const st = await A.locator('.mh-phase').first().innerText().catch(() => '');
      if (/Phase 2/.test(st)) {
        for (const [n, p] of [['A', A], ['B', B]]) await p.screenshot({ path: path.join(SHOTS, `muehle-move-${n}.png`) });
        // Auswahl-Screenshot
        const cur = (await mine(A)) ? A : B;
        const o = await opts(cur);
        if (o.can.length) { await tapP(cur, o.can[0]); await cur.screenshot({ path: path.join(SHOTS, 'muehle-selected.png') }); await tapP(cur, o.can[0]); if (await cur.locator('circle.mh-sel').count()) fail('Abwahl funktioniert nicht'); }
        shotDone = true;
      }
    }
    if (Date.now() - t0 > 120000) break;
  }
  if (!over) {
    console.log('Partie 1 lang: gebe auf');
    const p = (await mine(A)) ? A : B;
    await p.click('[data-act=resign]'); await p.click('[data-act=resign-yes]');
    await A.waitForSelector('.mh-over');
  }
  await A.waitForSelector('.mh-over'); await B.waitForSelector('.mh-over');
  console.log('Partie 1 Ende:', (await A.locator('.mh-over h1').innerText()).replace(/\n/g, ' '), '|', await A.locator('.mh-reason').innerText());
  await A.screenshot({ path: path.join(SHOTS, 'muehle-over-A.png'), fullPage: true });
  await B.screenshot({ path: path.join(SHOTS, 'muehle-over-B.png'), fullPage: true });

  // Neustart
  await A.click('[data-act=again]');
  await A.waitForSelector('#mh-board'); await B.waitForSelector('#mh-board');
  if ((await A.locator('#mh-board circle.mh-stone-w, #mh-board circle.mh-stone-b').count()) !== 0) fail('Brett nach Neustart nicht leer');
  console.log('Neustart ok; am Zug (A):', await mine(A));

  // Partie 2: Remis anbieten, ablehnen, nochmal anbieten, annehmen
  const first = (await mine(A)) ? A : B; const second = first === A ? B : A;
  await tapP(first, (await opts(first)).free[0]);
  await second.waitForSelector('[data-act=draw-offer]');
  await second.click('[data-act=draw-offer]');
  await first.waitForSelector('[data-act=draw-accept]');
  await first.screenshot({ path: path.join(SHOTS, 'muehle-draw-offer.png') });
  await first.click('[data-act=draw-decline]');
  await second.waitForSelector('[data-act=draw-offer]:not([disabled])');
  await second.click('[data-act=draw-offer]');
  await first.waitForSelector('[data-act=draw-accept]');
  await first.click('[data-act=draw-accept]');
  await A.waitForSelector('.mh-over'); await B.waitForSelector('.mh-over');
  const r2 = await A.locator('.mh-reason').innerText();
  console.log('Partie 2 Ende:', (await A.locator('.mh-over h1').innerText()).replace(/\n/g, ' '), '|', r2);
  if (r2 !== 'Remis') fail('Remis-Grund falsch');

  // Partie 3: Aufgeben mit Bestätigung
  await A.click('[data-act=again]');
  await A.waitForSelector('#mh-board');
  await B.click('[data-act=resign]');
  await B.waitForSelector('[data-act=resign-yes]');
  await B.screenshot({ path: path.join(SHOTS, 'muehle-resign.png') });
  await B.click('[data-act=resign-no]');
  if (await B.locator('.mh-over').count()) fail('Aufgeben ohne Bestätigung');
  await B.click('[data-act=resign]'); await B.click('[data-act=resign-yes]');
  await A.waitForSelector('.mh-over');
  const r3 = await A.locator('.mh-reason').innerText();
  console.log('Partie 3 Ende:', (await A.locator('.mh-over h1').innerText()).replace(/\n/g, ' '), '|', r3);
  if (r3 !== 'Aufgegeben') fail('Aufgeben-Grund falsch');

  // Desktop-Screenshot
  await A.setViewportSize({ width: 1200, height: 900 });
  await A.click('[data-act=again]');
  await A.waitForSelector('#mh-board');
  await A.screenshot({ path: path.join(SHOTS, 'muehle-desktop.png') });

  // Tippflächen mindestens 44 px (Handy)
  await A.setViewportSize({ width: 390, height: 844 });
  const min = await A.evaluate(() => Math.min(...[...document.querySelectorAll('#mh-board .mh-hit')].map((h) => h.getBoundingClientRect().width)));
  console.log('Kleinste Tippfläche (px):', min.toFixed(1));
  if (min < 44) fail('Tippfläche zu klein ' + min);
  const sw = await A.evaluate(() => document.documentElement.scrollWidth);
  if (sw > 390) fail('horizontales Scrollen: ' + sw);

  console.log('errors', errors);
  console.log(errors.length ? 'FEHLGESCHLAGEN' : 'ALLES OK – Ende erreicht');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.log('Abbruch', e); process.exit(1); });
