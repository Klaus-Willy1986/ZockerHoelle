// Playwright-Test: Stapelrennen (Computer, Neuladen, Lernrunde, Zweier-Online mit ?mock=1).
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8823 &
//        NODE_PATH=$(npm root -g) node tests/stapelrennen.e2e.cjs
// Umgebung: PORT, SHOTS (Screenshot-Ordner), SR_MAX_MS (Obergrenze je Spiel, Standard 240000)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PORT = process.env.PORT || 8823;
const BASE = `http://localhost:${PORT}/stapelrennen/index.html`;
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'stapelrennen-shots');
const MAX_MS = Number(process.env.SR_MAX_MS || 240000);
fs.mkdirSync(SHOTS, { recursive: true });
const errors = [];
const shot = (page, name, full = true) => page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: full });

async function open(browser, label, fast = true) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (fast) {
    await ctx.addInitScript(() => {
      const si = window.setInterval;
      window.setInterval = (fn, ms, ...a) => si(fn, ms < 200 ? 4 : ms, ...a);
      const st = window.setTimeout; // Computer-Takt (900 ms) beschleunigen
      window.setTimeout = (fn, ms, ...a) => st(fn, ms === 900 ? 20 : ms, ...a);
    });
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: console ${m.text()}`); });
  return page;
}

const boardTop = (page) => page.evaluate(() => { const b = document.getElementById('board'); return b ? Math.round(b.getBoundingClientRect().top + window.scrollY) : null; });

// Ein Zug des Menschen: erst alles legen, was leuchtet (mit Zufall), dann abwerfen.
async function humanAction(page, st) {
  const ok = page.locator('[data-act=src].sr-ok');
  const cnt = await ok.count();
  if (cnt > 0 && Math.random() < 0.93) {
    await ok.nth(Math.floor(Math.random() * cnt)).click();
    const tg = page.locator('[data-act=to-build]');
    const n = await tg.count();
    if (!n) throw new Error('Quelle gewählt, aber kein leuchtender Aufbaustapel');
    if (st.plays === 3 && !st.shotSel) { st.shotSel = true; await shot(page, 'karte-gewaehlt'); }
    await tg.nth(Math.floor(Math.random() * n)).click();
    st.plays++;
    return;
  }
  const hand = page.locator('[data-act=src][data-from=hand]');
  const hn = await hand.count();
  if (!hn) return;
  await hand.nth(Math.floor(Math.random() * hn)).click();
  const aux = page.locator('[data-act=to-aux]');
  if ((await aux.count()) !== 4) throw new Error('Beim Abwerfen sollten vier Hilfsstapel leuchten');
  if (!st.shotDiscard) { st.shotDiscard = true; await shot(page, 'abwerfen'); }
  await aux.nth(Math.floor(Math.random() * 4)).click();
  st.discards++;
}

async function runBot(browser, n, label, maxMs, untilEnd) {
  const page = await open(browser, label);
  await page.goto(BASE);
  await page.fill('#name', 'Anna');
  await shot(page, `${label}-start`);
  await page.click(`[data-act=bot][data-n="${n}"][data-level="1"]`);
  await page.waitForSelector('#board');
  const tops = new Set();
  const st = { plays: 0, discards: 0, shotSel: false, shotDiscard: false };
  const t0 = Date.now();
  let reloaded = false, botSeen = false, botShot = false, jokers = 0, over = false;
  while (Date.now() - t0 < maxMs) {
    if (await page.locator('.trophy').count()) { over = true; break; }
    const top = await boardTop(page);
    if (top !== null) tops.add(top);
    const banner = ((await page.locator('.banner').first().textContent().catch(() => '')) || '');
    if (/Computer/.test(banner)) {
      botSeen = true;
      if (!botShot) { botShot = true; await shot(page, `${label}-computer-dran`, false); }
    }
    if (!reloaded && st.plays + st.discards >= 8 && /Computer/.test(banner)) {
      reloaded = true;
      await page.reload();
      await page.waitForSelector('#board', { timeout: 8000 });
      await shot(page, `${label}-nach-neuladen`);
      continue;
    }
    if (await page.locator('.banner.mine').count()) {
      jokers += await page.locator('.sr-bp .sr-c.jk').count() > 0 ? 1 : 0;
      await humanAction(page, st);
      await page.waitForTimeout(15);
      continue;
    }
    await page.waitForTimeout(30);
  }
  console.log(label, `Legen ${st.plays}, Abwerfen ${st.discards}, Computer gesehen ${botSeen}, Neuladen ${reloaded}, Spielende ${over}, Tischmitte-Positionen ${[...tops]}, Joker sichtbar ${jokers}`);
  if (!botSeen) errors.push(`${label}: Computer war nie dran`);
  if (!reloaded) errors.push(`${label}: Neuladen nicht getestet`);
  if (Math.max(...tops) - Math.min(...tops) > 1) errors.push(`${label}: Tischmitte springt: ${[...tops]}`);
  if (untilEnd) {
    if (!over) errors.push(`${label}: Spiel nicht beendet`);
    else {
      console.log(label, 'Ende:', (await page.textContent('.over h1')).trim());
      await shot(page, `${label}-ende`);
      await page.click('[data-act=again]');
      await page.waitForSelector('#board');
      if (await page.locator('.trophy').count()) errors.push(`${label}: Siegerbildschirm nach „Noch eine Runde“ noch da`);
      console.log(label, 'Noch eine Runde ok');
      await shot(page, `${label}-neue-runde`);
    }
  } else {
    await shot(page, `${label}-ende`);
  }
  await page.context().close();
}

// Mehrere Runden mit Punkten gegen den Computer
async function runPoints(browser, label, maxMs) {
  const page = await open(browser, label);
  await page.goto(BASE);
  await page.fill('#name', 'Anna');
  await page.check('[data-opt=points]');
  await page.click('[data-act=bot][data-n="1"][data-level="0"]');
  await page.waitForSelector('#board');
  const st = { plays: 0, discards: 0, shotSel: true, shotDiscard: true };
  const t0 = Date.now();
  let rounds = 0, shotRound = false;
  while (Date.now() - t0 < maxMs) {
    if (await page.locator('[data-act=next-round]').count()) {
      rounds++;
      if (!shotRound) { shotRound = true; await shot(page, `${label}-rundenende`); }
      await page.click('[data-act=next-round]');
      await page.waitForSelector('#board');
      continue;
    }
    if (await page.locator('.trophy').count() && !(await page.locator('[data-act=next-round]').count())) break;
    if (await page.locator('.banner.mine').count()) { await humanAction(page, st); await page.waitForTimeout(10); continue; }
    await page.waitForTimeout(25);
  }
  const over = await page.locator('[data-act=again]').count();
  console.log(label, `Runden ${rounds + 1}, Serie beendet: ${!!over}`);
  if (!over) errors.push(`${label}: Serie nicht beendet`);
  else { console.log(label, (await page.textContent('.over h1')).trim(), '|', (await page.textContent('.ranking')).replace(/\s+/g, ' ').trim()); await shot(page, `${label}-serie-ende`); }
  await page.context().close();
}

// Lernrunde: nur den leuchtenden Zielen folgen
async function runLearn(browser, label, maxMs) {
  const page = await open(browser, label);
  await page.goto(BASE);
  await page.fill('#name', 'Anna');
  await page.click('[data-act=learn]');
  await page.waitForSelector('.coach', { timeout: 8000 });
  await page.waitForSelector('#board');
  const texts = new Set();
  const tops = new Set();
  let clicks = 0, fails = 0, noTarget = 0, stuck = 0, reloaded = false, over = false, shots = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const text = ((await page.locator('.coach .coach-t').first().textContent().catch(() => '')) || '').trim();
    if (text) texts.add(text);
    const top = await boardTop(page);
    if (top !== null) tops.add(top);
    if (await page.locator('.trophy').count()) { over = true; break; }
    const tgt = page.locator('.coach-target').first();
    if (await tgt.count()) {
      stuck = 0;
      if (shots < 3 && /leuchtende Karte|leuchtenden Aufbaustapel|abzuwerfen/.test(text)) { shots++; await shot(page, `${label}-coach-${shots}`, false); }
      try { await tgt.click({ timeout: 4000 }); clicks++; } catch { fails++; }
      await page.waitForTimeout(10);
    } else {
      if (await page.locator('.banner.mine').count()) { stuck++; if (stuck > 60) { noTarget++; stuck = 0; await shot(page, `fehler-kein-ziel-${Date.now()}`); } }
      await page.waitForTimeout(25);
    }
    if (!reloaded && clicks >= 8) {
      reloaded = true;
      await page.reload();
      await page.waitForSelector('#board', { timeout: 8000 });
      await page.waitForSelector('.coach', { timeout: 5000 });
      console.log(label, 'Neuladen mitten in der Lernrunde: Coach ist wieder da');
    }
  }
  console.log(label, `Klicks ${clicks}, Klickfehler ${fails}, ohne Ziel ${noTarget}, Coach-Texte ${texts.size}, Spielende ${over}, Tischmitte ${[...tops]}`);
  const all = [...texts];
  for (const t of all) if (t.length > 230) errors.push(`${label}: Coach-Text zu lang: ${t}`);
  if (!all.some((t) => /Joker/.test(t))) console.log(label, 'Hinweis: Joker wurde in dieser Lernrunde nicht erklärt (kam keiner vor)');
  if (noTarget) errors.push(`${label}: Mensch war dran, aber ohne Ziel (${noTarget}x)`);
  if (fails > 5) errors.push(`${label}: zu viele nicht klickbare Ziele (${fails})`);
  if (!over) errors.push(`${label}: Lernrunde nicht zu Ende gekommen`);
  if (Math.max(...tops) - Math.min(...tops) > 1) errors.push(`${label}: Tischmitte springt in der Lernrunde: ${[...tops]}`);
  if (over) {
    const ct = await page.locator('.coach .coach-t').first().textContent();
    if (!/zu Ende/.test(ct)) errors.push(`${label}: Coach am Ende: ${ct}`);
    if ((await page.locator('.coach-target[data-act=again]').count()) !== 1) errors.push(`${label}: Knopf Noch eine Runde pulsiert nicht`);
    await shot(page, `${label}-ende`);
  }
  console.log(label, 'Beispiele:', all.slice(0, 4).map((t) => t.slice(0, 70)).join(' | '));
  await page.context().close();
}

// Zwei Personen online (?mock=1, zwei Tabs im selben Browser-Kontext)
async function runOnline(browser, label, maxMs) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const watch = (p, n) => {
    p.on('pageerror', (e) => errors.push(`${label} ${n}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`${label} ${n}: console ${m.text()}`); });
  };
  const A = await ctx.newPage(); watch(A, 'A');
  await A.goto(BASE + '?mock=1');
  await A.fill('#name', 'Anna');
  await A.click('[data-act=host]');
  await A.waitForSelector('.code');
  const code = (await A.textContent('.code')).trim();
  const B = await ctx.newPage(); watch(B, 'B');
  await B.goto(BASE + '?mock=1&raum=' + code);
  await B.fill('#name', 'Bernd');
  await B.click('[data-act=join-invited]');
  await A.waitForSelector('[data-act=start]:not([disabled])');
  await A.click('[data-act=start]');
  await A.waitForSelector('#board'); await B.waitForSelector('#board');
  const st = { plays: 0, discards: 0, shotSel: true, shotDiscard: true };
  const topsA = new Set(), topsB = new Set();
  const t0 = Date.now();
  let turns = 0, shots = false;
  while (Date.now() - t0 < maxMs) {
    if (await A.locator('.trophy').count()) break;
    topsA.add(await boardTop(A)); topsB.add(await boardTop(B));
    const me = (await A.locator('.banner.mine').count()) ? A : (await B.locator('.banner.mine').count()) ? B : null;
    if (!me) { await A.waitForTimeout(40); continue; }
    if (!shots && st.plays > 6) { shots = true; await shot(A, `${label}-host`); await shot(B, `${label}-gast`); }
    await humanAction(me, st);
    turns++;
    await me.waitForTimeout(40);
  }
  const over = (await A.locator('.trophy').count()) > 0;
  console.log(label, `Aktionen ${turns}, Legen ${st.plays}, Abwerfen ${st.discards}, Spielende ${over}`);
  if (!over) errors.push(`${label}: Spiel nicht beendet`);
  else {
    await B.waitForSelector('.trophy', { timeout: 5000 });
    console.log(label, 'Ende:', (await A.textContent('.over h1')).trim(), '/', (await B.textContent('.over h1')).trim());
    if (await B.locator('[data-act=again]').count()) errors.push(`${label}: Gast sieht den Knopf Noch eine Runde`);
    await shot(A, `${label}-ende-host`); await shot(B, `${label}-ende-gast`);
    await A.click('[data-act=again]');
    await A.waitForSelector('#board'); await B.waitForSelector('#board');
    console.log(label, 'Neustart ok:', !(await A.locator('.trophy').count()) && !(await B.locator('.trophy').count()));
  }
  if (Math.max(...topsA) - Math.min(...topsA) > 1 || Math.max(...topsB) - Math.min(...topsB) > 1) errors.push(`${label}: Tischmitte springt: ${[...topsA]} / ${[...topsB]}`);
  await A.click('[data-act=help]');
  await A.waitForSelector('.modal');
  await shot(A, `${label}-hilfe`, false);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  const only = process.env.SR_ONLY; // z. B. SR_ONLY=lernrunde
  const want = (n) => !only || only.split(',').includes(n);
  if (want('eins')) await runBot(browser, 1, 'eins', MAX_MS, true);
  if (want('drei')) await runBot(browser, 3, 'drei', Math.min(MAX_MS, 90000), false);
  if (want('punkte')) await runPoints(browser, 'punkte', MAX_MS * 2);
  if (want('lernrunde')) await runLearn(browser, 'lernrunde', MAX_MS);
  if (want('online')) await runOnline(browser, 'online', MAX_MS);
  await browser.close();
  console.log('errors', JSON.stringify(errors));
  if (errors.length) process.exit(1);
  console.log('STAPELRENNEN E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors)); process.exit(1); });
