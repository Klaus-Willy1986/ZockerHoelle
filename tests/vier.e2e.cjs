// Durchspieltest im Browser für „Vier in Reihe“ (Port 8965):
// (a) gegen Computer (Mittel/Leicht), 7×6, Runde bis zum Ende, „Noch eine Runde“, Neuladen
// (b) Option „Größeres Brett (8×7)“ gegen Computer
// (c) Lernrunde kommt durch
// (d) zwei Personen über das Test-Netz (?mock=1): Gastgeber und Gast, Zustände identisch
// (e) Layout bei 390×844: kein seitliches Scrollen, Spalten breit genug, Brett bleibt an derselben Stelle
// Aufruf: NODE_PATH=$(npm root -g) node tests/vier.e2e.cjs
// Der Test startet selbst `python3 -m http.server 8965` und beendet ihn am Ende wieder.
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
const shot = (p, n, full = false) => p.screenshot({ path: path.join(SHOTS, `vier-${n}.png`), fullPage: full });

function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
}
async function startServer() {
  if (process.env.PORT) return { port: Number(process.env.PORT), stop() {} };
  const port = 8965;
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
    // merkt sich, ob je ein fallender Stein im Seitenbaum war (Fall-Animation)
    window.__sawDrop = 0;
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(() => { if (document.querySelector('.vr-disc.drop')) window.__sawDrop++; }).observe(document.body, { childList: true, subtree: true });
    });
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
const cellCount = (p) => p.locator('#board .vr-cell').count();
const marks = (p) => p.locator('#board .vr-cell svg').count();
const score = async (p) => (await p.locator('.vr-pl .vr-p b').allInnerTexts()).map(Number);
const roundText = async (p) => ((await p.locator('.vr-round').innerText()) || '').trim();
async function waitMineOrOver(p, ms = 8000) {
  await p.waitForFunction(() => document.querySelector('.banner.mine') || document.querySelector('.banner .trophy'), null, { timeout: ms });
  return !(await isOver(p));
}
async function tapFree(p) {
  const open = await p.locator('#board .vr-col').evaluateAll((els) => els.filter((e) => !e.classList.contains('full')).map((e) => e.dataset.c));
  if (!open.length) throw new Error('keine offene Spalte');
  await p.click(`#board .vr-col[data-c="${rnd(open)}"]`, { timeout: 4000 });
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


const cellSeq = (p) => p.locator('#board .vr-cell').evaluateAll((els) => els.map((e) => { const d = e.querySelector('.vr-disc'); return d ? (d.classList.contains('y') ? 'Y' : 'R') : '.'; }).join(''));

async function main(BASE) {
  const M = await import(path.join(ROOT, 'vier', 'engine.js'));
  const browser = await chromium.launch();
  const mk = async (opts = {}) => { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, ...opts }); await fast(ctx); return ctx; };
  const URLP = `${BASE}/vier/index.html`;

  // ===== (a) Computer Mittel, 7×6 =====
  console.log('--- (a) gegen Computer (Mittel), 7×6');
  {
    const ctx = await mk();
    const p = await ctx.newPage(); watch(p, 'a');
    await startBot(p, URLP, 1);
    await shot(p, 'a0-start-bot');
    ok((await cellCount(p)) === 42, '7×6 hat 42 Plätze');
    ok((await p.locator('#board .vr-col').count()) === 7, '7 Spalten');
    ok(/Du bist dran/.test(await banner(p)), 'Mensch beginnt: ' + (await banner(p)));
    ok(/Runde 1 · Du beginnst/.test(await roundText(p)), 'Rundenzeile: ' + (await roundText(p)));
    ok((await p.locator('[data-hint]').count()) === 0, 'keine Hervorhebung möglicher Spalten außerhalb der Lernrunde');
    await tapFree(p);
    await p.waitForFunction(() => document.querySelectorAll('#board .vr-cell svg').length >= 1);
    ok(await p.evaluate(() => window.__sawDrop > 0), 'Fall-Animation lief (Stein mit Klasse drop)');
    await shot(p, 'a1-nach-erstem-zug');
    await p.waitForFunction(() => document.querySelectorAll('#board .vr-cell svg').length >= 2, null, { timeout: 5000 });
    console.log('Computer hat von selbst gesetzt, Steine:', await marks(p));
    ok((await p.locator('.vr-status .big').innerText()).includes('wirft in Spalte'), 'Vorlese-Text nennt den Zug: ' + (await p.locator('.vr-status .big').innerText()));
    ok(await playRound(p), 'Runde 1 endet');
    await p.waitForSelector('.banner .trophy');
    const sc1 = await score(p);
    const draw1 = /unentschieden/i.test(await banner(p));
    console.log('Ende Runde 1:', await banner(p), '| Punkte', sc1, '|', (await p.locator('.vr-status .big').innerText()).trim());
    ok(draw1 ? (sc1[0] === 1 && sc1[1] === 1) : (sc1[0] + sc1[1] === 2 && (sc1[0] === 0 || sc1[1] === 0)), 'Punkte passen zum Ausgang (Sieg 2, Unentschieden je 1)');
    if (!draw1) ok((await p.locator('#board .vr-disc.win').count()) >= 4, 'Siegreihe leuchtet');
    await shot(p, 'a2-ende-runde1', true);
    ok((await p.locator('[data-act=next]').count()) === 1 && (await p.locator('[data-act=leave-now]').count()) === 1, 'Knöpfe „Noch eine Runde“ / „Spiel beenden“');
    await p.click('[data-act=next]');
    await p.waitForSelector('.banner:not(:has(.trophy))');
    ok(/Runde 2/.test(await roundText(p)) && /Computer beginnt/.test(await roundText(p)), 'Runde 2, Computer beginnt: ' + (await roundText(p)));
    ok(JSON.stringify(await score(p)) === JSON.stringify(sc1), 'Punktestand bleibt');
    await p.waitForFunction(() => document.querySelectorAll('#board .vr-cell svg').length >= 1, null, { timeout: 5000 });
    ok(/Du bist dran/.test(await banner(p)), 'Nach Computerzug bin ich dran: ' + (await banner(p)));
    await shot(p, 'a3-runde2');
    const before = await cellSeq(p);
    await p.reload();
    await p.waitForSelector('#board');
    ok((await cellSeq(p)) === before, 'Spielstand nach Neuladen');
    ok(/Runde 2/.test(await roundText(p)), 'Runde bleibt nach Neuladen');
    ok(await playRound(p), 'Runde 2 endet');
    await p.click('[data-act=leave-now]');
    await p.waitForSelector('[data-act=host]');
    await p.fill('#name', 'Anna');
    await p.click('[data-act=bot][data-level="0"]');
    await p.waitForSelector('#board');
    ok(await playRound(p), 'Leicht: Runde endet');
    await shot(p, 'a4-leicht-ende');
    await ctx.close();
  }

  // ===== (b) 8×7 =====
  console.log('--- (b) Größeres Brett 8×7 gegen Computer');
  {
    const ctx = await mk();
    const p = await ctx.newPage(); watch(p, 'b');
    await p.goto(URLP);
    await p.evaluate(() => { try { localStorage.clear(); } catch { /* egal */ } });
    await p.goto(URLP);
    await p.fill('#name', 'Berta');
    const opt = await p.locator('.opt', { has: p.locator('[data-opt="big"]') }).innerText();
    ok(/Größeres Brett \(8×7\)/.test(opt), 'Option: ' + opt);
    ok(!(await p.locator('[data-opt="big"]').isChecked()), 'Option steht standardmäßig aus');
    await shot(p, 'b0-option', true);
    await p.check('[data-opt="big"]');
    await p.click('[data-act=bot][data-level="1"]');
    await p.waitForSelector('#board');
    ok((await cellCount(p)) === 56 && (await p.locator('#board .vr-col').count()) === 8, '8×7 hat 56 Plätze, 8 Spalten');
    await shot(p, 'b1-start');
    ok(await playRound(p), '8×7 Runde endet');
    await p.waitForSelector('.banner .trophy');
    console.log('8×7 Ende:', await banner(p), '|', (await p.locator('.vr-status .big').innerText()).trim());
    await shot(p, 'b2-ende', true);
    await p.click('[data-act=next]');
    await p.waitForSelector('.banner:not(:has(.trophy))');
    ok((await cellCount(p)) === 56, 'Größe bleibt in Runde 2');
    p.once('dialog', (d) => d.accept());
    await p.click('[data-act=leave]');
    await p.waitForSelector('[data-act=learn]');
    ok(await p.locator('[data-opt="big"]').isChecked(), 'Option bleibt angekreuzt');
    await p.click('[data-act=learn]');
    await p.waitForSelector('.coach');
    ok((await cellCount(p)) === 42, 'Lernrunde ist immer 7×6');
    await ctx.close();
  }

  // ===== (c) Lernrunde =====
  console.log('--- (c) Lernrunde');
  {
    const ctx = await mk();
    const p = await ctx.newPage(); watch(p, 'c');
    await p.goto(URLP);
    await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await p.goto(URLP);
    await p.fill('#name', 'Gerda');
    await p.click('[data-act=learn]');
    await p.waitForSelector('.coach');
    const texts = [];
    let human = 0; let reloaded = false; let shots = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
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
    const strategy = /beste|klug|Mitte|Falle|verhindere|blocke|empfehl|solltest/i;
    ok(![...texts, endTxt].some((t) => strategy.test(t)), 'Strategie-Wörter im Coach');
    ok(new Set(texts.filter((t) => !/^Du bist dran\./.test(t))).size === texts.filter((t) => !/^Du bist dran\./.test(t)).length, 'Erklärung doppelt');
    await p.click('[data-act=next]');
    await p.waitForSelector('.banner:not(:has(.trophy))');
    await p.click('[data-act=learn-stop]');
    ok((await p.locator('.coach').count()) === 0, 'Coach verschwindet');
    ok((await p.locator('[data-hint]').count()) === 0, 'Nach der Lernrunde keine Markierung mehr');
    await ctx.close();
  }

  // ===== (d) zwei Personen =====
  console.log('--- (d) zwei Personen (Test-Netz)');
  {
    const ctx = await mk();
    const A = await ctx.newPage(); watch(A, 'A');
    const B = await ctx.newPage(); watch(B, 'B');
    const URL = `${URLP}?mock=1`;
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
    ok(/Du bist dran! \(Gelb ●\)/.test(await banner(A)), 'A beginnt: ' + (await banner(A)));
    ok(/Anna ist dran \(Gelb ●\)/.test(await banner(B)), 'B sieht: ' + (await banner(B)));
    await shot(A, 'd1-A-start'); await shot(B, 'd2-B-start');
    const same = async (label) => {
      const a = await cellSeq(A); const b = await cellSeq(B);
      ok(a === b, `${label}: Bretter verschieden ${a} / ${b}`);
      ok(JSON.stringify(await score(A)) === JSON.stringify(await score(B)), `${label}: Punkte verschieden`);
      ok((await roundText(A)).replace(/Du beginnst|Anna beginnt/, 'X').replace(/Ben beginnt/, 'Y') !== '', `${label}: Rundenzeile`);
    };
    await B.click('#board .vr-col[data-c="4"]', { force: true });
    ok((await marks(A)) === 0 && (await marks(B)) === 0, 'Zug der falschen Person');
    ok(/nicht an der Reihe/.test(await B.locator('.vr-hint').innerText().catch(() => '')), 'Hinweis „nicht an der Reihe“');
    await A.click('#board .vr-col[data-c="3"]', { force: true });
    await B.waitForFunction(() => document.querySelectorAll('#board .vr-cell svg').length === 1);
    ok(/Du bist dran! \(Rot ◆\)/.test(await banner(B)), 'B ist dran: ' + (await banner(B)));
    ok((await B.locator('#board .vr-col[data-c="3"] .vr-cell:last-child svg.y').count()) === 1, 'Gelber Stein ganz unten in Spalte 4 (Fall bis zum Boden)');
    ok(await B.evaluate(() => window.__sawDrop > 0), 'Gast sah die Fall-Animation');
    ok((await B.locator('.vr-status .big').innerText()).includes('Gelb wirft in Spalte 4'), 'Vorlese-Text: ' + (await B.locator('.vr-status .big').innerText()));
    await B.click('#board .vr-col[data-c="3"]', { force: true });
    await A.waitForFunction(() => document.querySelectorAll('#board .vr-cell svg').length === 2);
    ok((await A.locator('#board .vr-col[data-c="3"] .vr-cell:nth-last-child(2) svg.r').count()) === 1, 'Roter Stein liegt auf dem gelben');
    await same('nach 2 Zügen');
    await A.click('[data-act=help]');
    const help = await A.locator('.modal').innerText();
    ok(/Vier in Reihe/.test(help) && /Unentschieden/.test(help) && /Größeres Brett/.test(help) && !/Vier gewinnt|Connect/i.test(help), 'Hilfetext');
    await shot(A, 'd3-hilfe');
    await A.evaluate(() => document.querySelector('.overlay').scrollTo(0, 99999));
    await shot(A, 'd3b-hilfe-ende');
    { const bb = await A.locator('.modal [data-act=help-close]').boundingBox(); await A.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); }
    ok((await A.locator('.modal').count()) === 0, 'Hilfe schließt');
    // Spalte 1 (Index 0) auffüllen bis voll: zwei Steine liegen in Spalte 4. Weiter: A0 B0 A0 B0 A0 B0
    for (const [pg, c] of [[A, 0], [B, 0], [A, 0], [B, 0], [A, 0], [B, 0]]) { await pg.click(`#board .vr-col[data-c="${c}"]`, { force: true }); await A.waitForTimeout(40); }
    await A.waitForFunction(() => document.querySelectorAll('#board .vr-cell svg').length === 8);
    ok((await A.locator('#board .vr-col[data-c="0"].full').count()) === 1, 'Spalte voll markiert');
    await A.click('#board .vr-col[data-c="0"]', { force: true });
    ok(/Die Spalte ist voll/.test(await A.locator('.vr-hint').innerText().catch(() => '')), 'Hinweis „Die Spalte ist voll“');
    ok((await marks(A)) === 8, 'volle Spalte: kein neuer Stein');
    await shot(A, 'd3c-voll');
    await same('volle Spalte');
    // Sieg Gelb: 4 in unterster Reihe? Spalte 3 (Index 3) unten ist gelb. A bräuchte 0,1,2,3 unten: 0 ist gelb? (A0 B0 ...: unten gelb)
    for (const [pg, c] of [[A, 1], [B, 1], [A, 2]]) { await pg.click(`#board .vr-col[data-c="${c}"]`, { force: true }); await A.waitForTimeout(40); }
    // jetzt ist A dran; unterste Reihe: 0 gelb, 1 gelb, 2 gelb, 3 gelb (Spalte 3 unten gelb vom ersten Zug) -> es hätte schon gewonnen
    await A.waitForSelector('.banner .trophy'); await B.waitForSelector('.banner .trophy');
    ok(/Du hast gewonnen/.test(await banner(A)), 'A gewinnt: ' + (await banner(A)));
    ok(/Anna hat gewonnen/.test(await banner(B)), 'B sieht: ' + (await banner(B)));
    ok(JSON.stringify(await score(A)) === '[2,0]' && JSON.stringify(await score(B)) === '[2,0]', 'Punkte 2:0 bei beiden: ' + (await score(A)) + ' / ' + (await score(B)));
    ok((await A.locator('#board .vr-disc.win').count()) >= 4 && (await B.locator('#board .vr-disc.win').count()) >= 4, 'Siegreihe leuchtet bei beiden');
    await same('Ende Runde 1');
    ok((await A.locator('[data-act=next]').count()) === 1, 'Host sieht „Noch eine Runde“');
    ok((await B.locator('[data-act=next]').count()) === 0, 'Gast sieht es nicht');
    ok(/Gastgeber startet/.test(await B.locator('.vr-status').innerText()), 'Gast-Hinweis');
    ok(/2 Punkte/.test(await A.locator('.vr-status .big').innerText()), 'Sieg gibt 2 Punkte im Text: ' + (await A.locator('.vr-status .big').innerText()));
    await shot(A, 'd4-A-ende', true); await shot(B, 'd5-B-ende', true);
    await A.click('[data-act=next]');
    await A.waitForSelector('.banner:not(:has(.trophy))'); await B.waitForSelector('.banner:not(:has(.trophy))');
    ok(/Du bist dran! \(Rot ◆\)/.test(await banner(B)), 'Runde 2 beginnt Ben: ' + (await banner(B)));
    ok(/Ben beginnt/.test(await roundText(A)) && /Du beginnst/.test(await roundText(B)), 'Rundenzeile beider Seiten');
    ok((await marks(A)) === 0 && (await marks(B)) === 0, 'Brett leer');
    ok(JSON.stringify(await score(B)) === '[2,0]', 'Punktestand bleibt');
    // Unentschieden-Runde (Ben beginnt = Rot = Farbindex 1)
    const mask = 7; const rows = 6; const cols = 7;
    const colorAt = (r, c) => { const b = (mask >> (rows - 1 - r)) & 1; return c % 2 ? 1 - b : b; };
    const h = Array(cols).fill(0); const seq = []; const dead = new Set();
    const dfs = (t) => {
      if (seq.length === cols * rows) return true;
      const k = h.join(','); if (dead.has(k)) return false;
      for (let c = 0; c < cols; c++) { if (h[c] >= rows) continue; if (colorAt(rows - 1 - h[c], c) !== t) continue; h[c]++; seq.push(c); if (dfs(1 - t)) return true; h[c]--; seq.pop(); }
      dead.add(k); return false;
    };
    ok(dfs(1), 'Zugfolge für Unentschieden gefunden');
    for (let i = 0; i < seq.length; i++) { const pg = i % 2 === 0 ? B : A; await pg.click(`#board .vr-col[data-c="${seq[i]}"]`, { force: true }); await A.waitForTimeout(25); }
    await A.waitForSelector('.banner .trophy'); await B.waitForSelector('.banner .trophy');
    ok(/Unentschieden/.test(await banner(A)) && /Unentschieden/.test(await banner(B)), 'Unentschieden: ' + (await banner(A)));
    ok(JSON.stringify(await score(A)) === '[3,1]', 'Unentschieden: beide +1 -> [3,1]: ' + (await score(A)));
    await same('Unentschieden');
    await shot(A, 'd6-unentschieden', true);
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
      const label = big ? '8×7' : '7×6';
      await startBot(p, URLP, 1, { big });
      await noScroll(label + ' Start');
      const cw = await p.locator('#board .vr-col').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
      const br = await boardRect(p);
      console.log(`${label}: Spaltenbreite ${Math.min(...cw).toFixed(1)} px, Brettbreite ${br.width.toFixed(0)} px, Höhe ${br.height.toFixed(0)} px`);
      ok(Math.min(...cw) >= 48, `${label}: Spalte zu schmal ${Math.min(...cw)}`);
      const btns = await p.locator('.btn').evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height));
      ok(Math.min(...btns) >= 44, 'Knopfhöhe');
      const rects = [];
      const first = await boardRect(p);
      await tapFree(p);
      await p.waitForFunction(() => document.querySelectorAll('#board .vr-cell svg').length >= 1);
      rects.push(await boardRect(p));
      // eine Spalte füllen, bis voll, dann antippen: Hinweis, Brett springt nicht
      await shot(p, `e-${big ? '8x7' : '7x6'}-brett`);
      await playRound(p, rects);
      await noScroll(label + ' Ende');
      const all = [first, ...rects];
      const dy = Math.max(...all.map((r) => r.y)) - Math.min(...all.map((r) => r.y));
      const dx = Math.max(...all.map((r) => r.x)) - Math.min(...all.map((r) => r.x));
      const dw = Math.max(...all.map((r) => r.width)) - Math.min(...all.map((r) => r.width));
      console.log(`${label}: Brett über ${all.length} Zustände – Abweichung y ${dy.toFixed(1)} px, x ${dx.toFixed(1)}, Breite ${dw.toFixed(1)}; Position y=${first.y.toFixed(0)}`);
      ok(dy <= 1 && dx <= 1 && dw <= 1, `${label}: Brett springt (y ${dy}, x ${dx}, b ${dw})`);
      await shot(p, `e-${big ? '8x7' : '7x6'}-ende`, true);
      await p.click('[data-act=next]');
      await p.waitForSelector('.banner:not(:has(.trophy))');
      await p.waitForTimeout(100);
      const r2 = await boardRect(p);
      ok(Math.abs(r2.y - first.y) <= 1, `${label}: Brett in Runde 2 an anderer Stelle (${r2.y} statt ${first.y})`);
      await p.click('[data-act=bigger]');
      await noScroll(label + ' große Schrift');
      const bs = await p.locator('#board .vr-col').evaluateAll((els) => Math.min(...els.map((e) => e.getBoundingClientRect().width)));
      ok(bs >= 48, `${label} große Schrift: Spalte ${bs}`);
      await shot(p, `e-${big ? '8x7' : '7x6'}-gross`);
      await p.click('[data-act=bigger]');
    }
    // Hinweis „Spalte voll“ verschiebt das Brett nicht (Mock mit zwei Seiten ist in (d) geprüft); hier Startseite
    await p.goto(URLP);
    await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await p.goto(URLP);
    await noScroll('Startseite');
    await shot(p, 'e-startseite', true);
    await p.setViewportSize({ width: 320, height: 640 });
    await p.fill('#name', 'Eva');
    await p.click('[data-act=bot][data-level="1"]');
    await p.waitForSelector('#board');
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    const m = await p.locator('#board .vr-col').evaluateAll((els) => Math.min(...els.map((e) => e.getBoundingClientRect().width)));
    console.log(`320 px breit: Seitenbreite ${sw}, schmalste Spalte ${m.toFixed(1)} px`);
    ok(sw <= 320, 'Scrollen bei 320 px: ' + sw);
    await shot(p, 'e-320');
    await p.setViewportSize({ width: 1200, height: 900 });
    await shot(p, 'e-desktop');
    await ctx.close();
    // reduzierte Bewegung: keine Fall-Animation
    const rctx = await mk({ reducedMotion: 'reduce' });
    const rp = await rctx.newPage(); watch(rp, 'rm');
    await startBot(rp, URLP, 1);
    await rp.click('#board .vr-col[data-c="3"]');
    await rp.waitForSelector('#board .vr-disc');
    const an = await rp.locator('#board .vr-disc').first().evaluate((e) => getComputedStyle(e).animationName);
    ok(an === 'none', 'prefers-reduced-motion: keine Animation (' + an + ')');
    await rctx.close();
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
