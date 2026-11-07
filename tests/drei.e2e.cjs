// Durchspieltest im Browser für „Drei gewinnt“:
// (a) gegen Computer (Mittel), 3×3, eine Runde bis zum Ende, dann „Noch eine Runde“
// (b) Option „Großes Feld“ (5×5) gegen Computer
// (c) Lernrunde kommt durch
// (d) zwei Personen über das Test-Netz (?mock=1): Gastgeber und Gast
// (e) Layout bei 390×844: kein seitliches Scrollen, Tippfelder groß genug, Brett bleibt an derselben Stelle
// Aufruf: NODE_PATH=$(npm root -g) node tests/drei.e2e.cjs
// Der Test startet selbst einen kleinen Webserver (python3 -m http.server) auf einem freien Port und beendet ihn am Ende wieder.
// Mit PORT=… wird stattdessen ein schon laufender Server benutzt.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
fs.mkdirSync(SHOTS, { recursive: true });
const errors = [];
const fail = (m) => { console.log('FEHLER:', m); errors.push(m); };
const ok = (c, m) => { if (!c) fail(m); };
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const shot = (p, n, full = false) => p.screenshot({ path: path.join(SHOTS, `drei-${n}.png`), fullPage: full });

function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
}
async function startServer() {
  if (process.env.PORT) return { port: Number(process.env.PORT), stop() {} };
  const port = await freePort();
  const child = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    const up = await new Promise((r) => { const c = net.connect(port, '127.0.0.1', () => { c.end(); r(true); }); c.on('error', () => r(false)); });
    if (up) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { port, stop() { child.kill(); } };
}

// Wartezeiten verkürzen (Lebenszeichen und die 700 ms Bedenkzeit des Computers)
async function fast(ctx) {
  await ctx.addInitScript(() => {
    const si = window.setInterval.bind(window);
    window.setInterval = (f, t, ...a) => si(f, t < 200 ? 4 : t, ...a);
    const st = window.setTimeout.bind(window);
    window.setTimeout = (f, t, ...a) => st(f, t === 700 ? 25 : t, ...a);
  });
}
function watch(p, n) {
  p.on('pageerror', (e) => fail(`${n} pageerror ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') fail(`${n} console ${m.text()}`); });
}

const banner = async (p) => ((await p.locator('.banner').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
const isOver = async (p) => (await p.locator('.banner .trophy').count()) > 0;
const mineNow = async (p) => (await p.locator('.banner.mine').count()) > 0;
// Lage des Bretts auf der Seite (nicht im Fenster), damit Scrollen nicht als Springen zählt
const boardRect = (p) => p.evaluate(() => { const r = document.querySelector('#board').getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; });
const cellCount = (p) => p.locator('#board .dr-cell').count();
const marks = (p) => p.locator('#board .dr-cell svg').count();
const score = async (p) => (await p.locator('.dr-pl .dr-p b').allInnerTexts()).map(Number);
const roundText = async (p) => ((await p.locator('.dr-round').innerText()) || '').trim();
async function waitMineOrOver(p, ms = 8000) {
  await p.waitForFunction(() => document.querySelector('.banner.mine') || document.querySelector('.banner .trophy'), null, { timeout: ms });
  return !(await isOver(p));
}
async function tapFree(p) {
  const free = await p.locator('#board .dr-cell[data-hint="free"]').evaluateAll((els) => els.map((e) => e.dataset.p));
  if (!free.length) throw new Error('kein freies Feld antippbar');
  await p.click(`#board .dr-cell[data-p="${rnd(free)}"]`, { timeout: 4000 });
}
async function startBot(page, base, level, { big = false, name = 'Anna' } = {}) {
  await page.goto(base);
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
  await page.goto(base);
  await page.fill('#name', name);
  const box = page.locator('[data-opt="big"]');
  if ((await box.isChecked()) !== big) await box.setChecked(big);
  await page.click(`[data-act=bot][data-level="${level}"]`);
  await page.waitForSelector('#board');
}
// Spielt als Mensch zufällig, bis die Runde zu Ende ist. Gibt die Boxen des Bretts nach jedem Zustand zurück.
async function playRound(page, rects) {
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    if (rects) rects.push(await boardRect(page));
    if (!(await waitMineOrOver(page))) { if (rects) rects.push(await boardRect(page)); return true; }
    await tapFree(page);
  }
  return false;
}

async function main(BASE) {
  const browser = await chromium.launch();
  const mk = async (opts = {}) => { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, ...opts }); await fast(ctx); return ctx; };

  // ===== (a) Computer Mittel, 3×3 =====
  console.log('--- (a) gegen Computer (Mittel), 3×3');
  {
    const ctx = await mk();
    const p = await ctx.newPage(); watch(p, 'a');
    await startBot(p, `${BASE}/drei/index.html`, 1);
    await shot(p, 'a0-start-bot');
    ok((await cellCount(p)) === 9, '3×3 hat 9 Felder');
    ok(/Du bist dran/.test(await banner(p)), 'Mensch beginnt: ' + (await banner(p)));
    ok(/Runde 1 · Du beginnst/.test(await roundText(p)), 'Rundenzeile: ' + (await roundText(p)));
    ok((await p.locator('[data-act=speak-toggle]').count()) >= 0, 'Kopfzeile');
    await tapFree(p);
    await p.waitForFunction(() => document.querySelectorAll('#board .dr-cell svg').length >= 1);
    ok(/Computer ist dran/.test(await banner(p)) || (await marks(p)) >= 2, 'Banner nach Zug: ' + (await banner(p)));
    await shot(p, 'a1-nach-erstem-zug');
    // Computer zieht von selbst
    await p.waitForFunction(() => document.querySelectorAll('#board .dr-cell svg').length >= 2, null, { timeout: 5000 });
    console.log('Computer hat von selbst gesetzt, Zeichen auf dem Feld:', await marks(p));
    ok(await playRound(p), 'Runde 1 endet');
    await p.waitForSelector('.banner .trophy');
    const sc1 = await score(p);
    console.log('Ende Runde 1:', await banner(p), '| Punkte', sc1, '|', (await p.locator('.dr-status .big').innerText()).trim());
    ok(sc1[0] + sc1[1] === (/unentschieden/i.test(await banner(p)) ? 0 : 1), 'Punkte passen zum Ausgang');
    if (!/unentschieden/i.test(await banner(p))) ok((await p.locator('#board .dr-cell.win').count()) >= 3, 'Siegreihe hervorgehoben');
    await shot(p, 'a2-ende-runde1', true);
    ok((await p.locator('[data-act=next]').count()) === 1 && (await p.locator('[data-act=leave-now]').count()) === 1, 'Knöpfe „Noch eine Runde“ / „Spiel beenden“');
    await p.click('[data-act=next]');
    await p.waitForSelector('.banner:not(:has(.trophy))');
    ok(/Runde 2/.test(await roundText(p)), 'Runde 2: ' + (await roundText(p)));
    ok(/Computer beginnt/.test(await roundText(p)), 'Computer beginnt Runde 2: ' + (await roundText(p)));
    ok(JSON.stringify(await score(p)) === JSON.stringify(sc1), 'Punktestand bleibt');
    // Computer beginnt: er setzt von selbst
    await p.waitForFunction(() => document.querySelectorAll('#board .dr-cell svg').length >= 1, null, { timeout: 5000 });
    ok(/Du bist dran/.test(await banner(p)), 'Nach Computerzug bin ich dran: ' + (await banner(p)));
    await shot(p, 'a3-runde2');
    // Neuladen mitten im Spiel
    const before = await marks(p);
    await p.reload();
    await p.waitForSelector('#board');
    ok((await marks(p)) === before, 'Spielstand nach Neuladen');
    ok(/Runde 2/.test(await roundText(p)), 'Runde bleibt nach Neuladen');
    ok(await playRound(p), 'Runde 2 endet');
    await p.click('[data-act=leave-now]');
    await p.waitForSelector('[data-act=host]');
    // Leicht
    await p.fill('#name', 'Anna');
    await p.click('[data-act=bot][data-level="0"]');
    await p.waitForSelector('#board');
    ok(await playRound(p), 'Leicht: Runde endet');
    await shot(p, 'a4-leicht-ende');
    await ctx.close();
  }

  // ===== (b) 5×5 =====
  console.log('--- (b) Großes Feld 5×5 gegen Computer');
  {
    const ctx = await mk();
    const p = await ctx.newPage(); watch(p, 'b');
    await p.goto(`${BASE}/drei/index.html`);
    await p.evaluate(() => { try { localStorage.clear(); } catch { /* egal */ } });
    await p.goto(`${BASE}/drei/index.html`);
    await p.fill('#name', 'Berta');
    const opt = await p.locator('.opt', { has: p.locator('[data-opt="big"]') }).innerText();
    ok(/Großes Feld: 5×5, vier in einer Reihe/.test(opt) && /Wer zuerst vier/.test(opt), 'Option und Hilfe: ' + opt);
    await shot(p, 'b0-option', true);
    await p.check('[data-opt="big"]');
    await p.click('[data-act=bot][data-level="1"]');
    await p.waitForSelector('#board');
    ok((await cellCount(p)) === 25, '5×5 hat 25 Felder: ' + (await cellCount(p)));
    await shot(p, 'b1-start');
    const sizes = await p.locator('#board .dr-cell').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    console.log('5×5 kleinstes Feld (px):', Math.min(...sizes).toFixed(1), ' größtes:', Math.max(...sizes).toFixed(1));
    ok(Math.min(...sizes) >= 56, '5×5 Felder zu klein');
    ok(await playRound(p), '5×5 Runde endet');
    await p.waitForSelector('.banner .trophy');
    console.log('5×5 Ende:', await banner(p), '|', (await p.locator('.dr-status .big').innerText()).trim());
    await shot(p, 'b2-ende', true);
    if (!/unentschieden/i.test(await banner(p))) ok((await p.locator('#board .dr-cell.win').count()) >= 4, '5×5: mindestens vier hervorgehoben');
    await p.click('[data-act=next]');
    await p.waitForSelector('.banner:not(:has(.trophy))');
    ok((await cellCount(p)) === 25, 'Feldgröße bleibt in Runde 2');
    // Die Option bleibt gemerkt; Lernrunde nutzt immer 3×3. Mitten im Spiel verlassen (mit Rückfrage)
    p.once('dialog', (d) => d.accept());
    await p.click('[data-act=leave]');
    await p.waitForSelector('[data-act=learn]');
    ok(await p.locator('[data-opt="big"]').isChecked(), 'Option bleibt angekreuzt');
    await p.click('[data-act=learn]');
    await p.waitForSelector('.coach');
    ok((await cellCount(p)) === 9, 'Lernrunde ist immer 3×3');
    await ctx.close();
  }

  // ===== (c) Lernrunde =====
  console.log('--- (c) Lernrunde');
  {
    const ctx = await mk();
    const p = await ctx.newPage(); watch(p, 'c');
    await p.goto(`${BASE}/drei/index.html`);
    await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await p.goto(`${BASE}/drei/index.html`);
    await p.fill('#name', 'Gerda');
    await p.click('[data-act=learn]');
    await p.waitForSelector('.coach');
    const texts = [];
    let human = 0; let reloaded = false; let shots = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      if (await p.locator('.banner .trophy').count()) break;
      const snap = await p.evaluate(() => ({ mine: !!document.querySelector('.banner.mine'), txt: (document.querySelector('.coach .coach-t') || { innerText: '' }).innerText.trim(), targets: document.querySelectorAll('.coach-target').length }));
      if (snap.mine) {
        ok(snap.targets > 0, 'Mensch dran, aber kein Ziel: ' + snap.txt);
        if (!texts.includes(snap.txt)) { texts.push(snap.txt); if (shots < 3) await shot(p, `c${++shots}-coach`); }
        human++;
        if (human === 2 && !reloaded) {
          reloaded = true;
          await p.reload(); await p.waitForSelector('.coach'); ok(await p.locator('#board').count(), 'nach Neuladen im Spiel');
          continue;
        }
        await p.locator('.coach-target').first().click({ timeout: 3000 }).catch(() => {});
      } else {
        ok(/Computer/.test(snap.txt), 'Computer-Text erwartet: ' + snap.txt);
        await p.waitForTimeout(30);
      }
    }
    ok(await p.locator('.banner .trophy').count(), 'Lernrunde endet');
    const endTxt = (await p.innerText('.coach .coach-t')).trim();
    ok(/Noch eine Runde/.test(endTxt), 'Ende-Text: ' + endTxt);
    ok((await p.locator('.coach-target[data-act=next]').count()) === 1, 'Ziel „Noch eine Runde“');
    await shot(p, 'c4-ende');
    console.log('Erklärungen:\n - ' + [...texts, endTxt].join('\n - '));
    const strategy = /beste|klug|Ecke|Mitte|Falle|verhindere|blocke|empfehl|solltest/i;
    ok(![...texts, endTxt].some((t) => strategy.test(t)), 'Strategie-Wörter im Coach');
    ok(new Set(texts.filter((t) => !/^Du bist dran\./.test(t))).size === texts.filter((t) => !/^Du bist dran\./.test(t)).length, 'Erklärung doppelt');
    await p.click('[data-act=next]');
    await p.waitForSelector('.banner:not(:has(.trophy))');
    await p.click('[data-act=learn-stop]');
    ok((await p.locator('.coach').count()) === 0, 'Coach verschwindet');
    await ctx.close();
  }

  // ===== (d) zwei Personen =====
  console.log('--- (d) zwei Personen (Test-Netz)');
  {
    const ctx = await mk();
    const A = await ctx.newPage(); watch(A, 'A');
    const B = await ctx.newPage(); watch(B, 'B');
    const URL = `${BASE}/drei/index.html?mock=1`;
    await A.goto(URL);
    await A.fill('#name', 'Anna');
    await A.click('[data-act=host]');
    await A.waitForSelector('.code');
    const code = (await A.locator('.code').innerText()).trim();
    await B.goto(`${URL}&raum=${code}`);
    await B.fill('#name', 'Ben');
    await B.click('[data-act=join-invited]');
    await A.waitForSelector('[data-act=start]');
    ok((await A.locator('[data-opt="big"]').count()) === 1, 'Option in der Lobby');
    await shot(A, 'd0-lobby', true);
    await A.click('[data-act=start]');
    await A.waitForSelector('#board'); await B.waitForSelector('#board');
    ok(/Du bist dran! \(Kreuz\)/.test(await banner(A)), 'A beginnt: ' + (await banner(A)));
    ok(/Anna ist dran \(Kreuz\)/.test(await banner(B)), 'B sieht: ' + (await banner(B)));
    await shot(A, 'd1-A-start'); await shot(B, 'd2-B-start');
    // B ist nicht dran: nichts passiert, Hinweis erscheint
    await B.click('#board .dr-cell[data-p="4"]', { force: true });
    ok((await marks(A)) === 0 && (await marks(B)) === 0, 'Zug der falschen Person');
    ok(/nicht an der Reihe/.test(await B.locator('.dr-hint').innerText().catch(() => '')), 'Hinweis „nicht an der Reihe“');
    // A setzt, B sieht es
    await A.click('#board .dr-cell[data-p="4"]', { force: true });
    await B.waitForFunction(() => document.querySelectorAll('#board .dr-cell svg').length === 1);
    ok(/Du bist dran! \(Kreis\)/.test(await banner(B)), 'B ist dran: ' + (await banner(B)));
    ok((await B.locator('#board .dr-cell[data-p="4"] svg.x').count()) === 1, 'Kreuz in der Mitte');
    // Besetztes Feld antippen: Hinweis, kein Zug
    await B.click('#board .dr-cell[data-p="4"]', { force: true });
    ok(/schon besetzt/.test(await B.locator('.dr-hint').innerText().catch(() => '')), 'Hinweis „besetzt“');
    ok((await marks(B)) === 1, 'besetztes Feld bleibt');
    // Hilfe
    await A.click('[data-act=help]');
    const help = await A.locator('.modal').innerText();
    ok(/Drei gewinnt/.test(help) && /Unentschieden/.test(help) && /Großes Feld/.test(help), 'Hilfetext');
    await shot(A, 'd3-hilfe');
    await A.evaluate(() => document.querySelector('.overlay').scrollTo(0, 99999));
    await shot(A, 'd3b-hilfe-ende');
    { const bb = await A.locator('.modal [data-act=help-close]').boundingBox(); await A.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); }
    ok((await A.locator('.modal').count()) === 0, 'Hilfe schließt');
    // Rest der Runde: Kreuz gewinnt oben waagerecht (0,1,2); Kreis setzt 3,4(belegt) -> 3,5
    const seq = [[B, 3], [A, 0], [B, 5], [A, 8], [B, 7], [A, 6]]; // A: 4,0,8 -> Diagonale gewinnt
    for (const [pg, c] of seq) {
      if (await isOver(A)) break;
      await pg.click(`#board .dr-cell[data-p="${c}"]`, { force: true });
      await A.waitForTimeout(40);
    }
    await A.waitForSelector('.banner .trophy'); await B.waitForSelector('.banner .trophy');
    ok(/Du hast gewonnen/.test(await banner(A)), 'A gewinnt: ' + (await banner(A)));
    ok(/Anna hat gewonnen/.test(await banner(B)), 'B sieht: ' + (await banner(B)));
    ok(JSON.stringify(await score(A)) === '[1,0]' && JSON.stringify(await score(B)) === '[1,0]', 'Punkte 1:0 bei beiden: ' + (await score(A)) + ' / ' + (await score(B)));
    ok((await A.locator('#board .dr-cell.win').count()) === 3 && (await B.locator('#board .dr-cell.win').count()) === 3, 'Siegreihe bei beiden');
    ok((await A.locator('[data-act=next]').count()) === 1, 'Host sieht „Noch eine Runde“');
    ok((await B.locator('[data-act=next]').count()) === 0, 'Gast sieht es nicht');
    ok(/Gastgeber startet/.test(await B.locator('.dr-status').innerText()), 'Gast-Hinweis');
    await shot(A, 'd4-A-ende', true); await shot(B, 'd5-B-ende', true);
    await A.click('[data-act=next]');
    await A.waitForSelector('.banner:not(:has(.trophy))'); await B.waitForSelector('.banner:not(:has(.trophy))');
    ok(/Du bist dran! \(Kreis\)/.test(await banner(B)), 'Runde 2 beginnt Ben: ' + (await banner(B)));
    ok(/Ben beginnt/.test(await roundText(A)) && /Du beginnst/.test(await roundText(B)), 'Rundenzeile beider Seiten');
    ok((await marks(A)) === 0, 'Feld leer');
    ok(JSON.stringify(await score(B)) === '[1,0]', 'Punktestand bleibt');
    // Ben (Kreis) beginnt; Unentschieden spielen: Kreis 0,1,5,6,8? — Zugfolge unten ergibt volles Feld ohne Reihe
    const draw = [[B, 0], [A, 1], [B, 2], [A, 4], [B, 3], [A, 5], [B, 7], [A, 6], [B, 8]];
    for (const [pg, c] of draw) { await pg.click(`#board .dr-cell[data-p="${c}"]`, { force: true }); await A.waitForTimeout(40); }
    await A.waitForSelector('.banner .trophy');
    ok(/Unentschieden/.test(await banner(A)) && /Unentschieden/.test(await banner(B)), 'Unentschieden: ' + (await banner(A)));
    ok(JSON.stringify(await score(A)) === '[1,0]', 'Unentschieden gibt keine Punkte');
    await shot(A, 'd6-unentschieden', true);
    // Guest verlässt, Host beendet
    await B.click('[data-act=leave-now]').catch(() => {});
    await A.click('[data-act=leave-now]');
    await A.waitForSelector('[data-act=host]');
    await ctx.close();
  }

  // ===== (e) Layout 390×844 =====
  console.log('--- (e) Layout 390×844');
  {
    const ctx = await mk();
    const p = await ctx.newPage(); watch(p, 'e');
    const noScroll = async (label) => {
      const sw = await p.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
      ok(sw <= 390, `${label}: horizontales Scrollen (${sw}px)`);
    };
    for (const big of [false, true]) {
      const label = big ? '5×5' : '3×3';
      await startBot(p, `${BASE}/drei/index.html`, 1, { big });
      await noScroll(label + ' Start');
      const minPx = big ? 56 : 64;
      const sizes = await p.locator('#board .dr-cell').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
      console.log(`${label}: kleinstes Tippfeld ${Math.min(...sizes).toFixed(1)} px (Soll >= ${minPx})`);
      ok(Math.min(...sizes) >= minPx, `${label}: Tippfeld zu klein ${Math.min(...sizes)}`);
      const btns = await p.locator('.btn').evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height));
      ok(Math.min(...btns) >= 44, 'Knopfhöhe');
      const rects = [];
      const first = await boardRect(p);
      // Zwischenzustände: Hinweis bei besetztem Feld, Computer-Zug, Ende
      await tapFree(p);
      await p.waitForFunction(() => document.querySelectorAll('#board .dr-cell svg').length >= 1);
      rects.push(await boardRect(p));
      const occupied = await p.locator('#board .dr-cell svg').first().evaluate((s) => s.parentElement.dataset.p);
      if (await mineNow(p)) { await p.click(`#board .dr-cell[data-p="${occupied}"]`, { force: true }); rects.push(await boardRect(p)); ok(await p.locator('.dr-hint').count(), 'Hinweis sichtbar'); }
      await shot(p, `e-${big ? '5x5' : '3x3'}-hinweis`);
      await playRound(p, rects);
      await noScroll(label + ' Ende');
      const all = [first, ...rects];
      const dy = Math.max(...all.map((r) => r.y)) - Math.min(...all.map((r) => r.y));
      const dx = Math.max(...all.map((r) => r.x)) - Math.min(...all.map((r) => r.x));
      const dw = Math.max(...all.map((r) => r.width)) - Math.min(...all.map((r) => r.width));
      console.log(`${label}: Brett über ${all.length} Zustände – Abweichung y ${dy.toFixed(1)} px, x ${dx.toFixed(1)}, Breite ${dw.toFixed(1)}; Position y=${first.y.toFixed(0)}`);
      ok(dy <= 1 && dx <= 1 && dw <= 1, `${label}: Brett springt (y ${dy}, x ${dx}, b ${dw})`);
      await shot(p, `e-${big ? '5x5' : '3x3'}-ende`, true);
      // Nach „Noch eine Runde“ und beim Wechsel Start->Spiel gleiche Stelle?
      await p.click('[data-act=next]');
      await p.waitForSelector('.banner:not(:has(.trophy))');
      await p.waitForTimeout(100);
      const r2 = await boardRect(p);
      ok(Math.abs(r2.y - first.y) <= 1, `${label}: Brett in Runde 2 an anderer Stelle (${r2.y} statt ${first.y})`);
      // große Schrift
      await p.click('[data-act=bigger]');
      await noScroll(label + ' große Schrift');
      const bs = await p.locator('#board .dr-cell').evaluateAll((els) => Math.min(...els.map((e) => e.getBoundingClientRect().width)));
      ok(bs >= minPx, `${label} große Schrift: Feld ${bs}`);
      await shot(p, `e-${big ? '5x5' : '3x3'}-gross`);
      await p.click('[data-act=bigger]');
    }
    // Start- und Lobby-Seite
    await p.goto(`${BASE}/drei/index.html`);
    await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await p.goto(`${BASE}/drei/index.html`);
    await noScroll('Startseite');
    await shot(p, 'e-startseite', true);
    // schmales Handy 320 px
    await p.setViewportSize({ width: 320, height: 640 });
    await p.fill('#name', 'Eva');
    await p.check('[data-opt="big"]');
    await p.click('[data-act=bot][data-level="1"]');
    await p.waitForSelector('#board');
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    const m = await p.locator('#board .dr-cell').evaluateAll((els) => Math.min(...els.map((e) => e.getBoundingClientRect().width)));
    console.log(`320 px breit: Seitenbreite ${sw}, kleinstes Feld ${m.toFixed(1)} px`);
    ok(sw <= 320, 'Scrollen bei 320 px: ' + sw);
    ok(m >= 54, 'Feld bei 320 px: ' + m);
    await shot(p, 'e-320');
    // Desktop
    await p.setViewportSize({ width: 1200, height: 900 });
    await shot(p, 'e-desktop');
    await ctx.close();
  }

  await browser.close();
}

(async () => {
  const srv = await startServer();
  try {
    await main(`http://127.0.0.1:${srv.port}`);
  } catch (e) {
    console.log('ABBRUCH', e);
    errors.push('Abbruch: ' + e.message);
  } finally {
    srv.stop();
  }
  console.log('Fehler:', JSON.stringify(errors));
  console.log(errors.length ? 'FEHLGESCHLAGEN' : 'ALLES OK');
  process.exit(errors.length ? 1 : 0);
})();
