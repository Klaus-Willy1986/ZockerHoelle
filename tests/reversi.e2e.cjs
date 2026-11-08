// Durchspieltest im Browser für „Reversi“:
// (a) gegen Computer (Mittel/Leicht): Runde bis zum Ende, Passen-Hinweis mit OK, „Noch eine Runde“ (Farbwechsel), Neuladen
// (b) Option „Mögliche Felder anzeigen“ (Punkte nur mit Option)
// (c) Lernrunde kommt durch
// (d) zwei Personen über das Test-Netz (?mock=1): Zustände identisch bei Gastgeber und Gast
// (e) Layout bei 390×844: kein seitliches Scrollen, Feldgröße, Knöpfe, Brett bleibt an derselben Stelle
// Aufruf: NODE_PATH=$(npm root -g) node tests/reversi.e2e.cjs
// Der Test startet selbst einen Webserver (python3 -m http.server) auf Port 8972 (PORT=… überschreibt; ein schon laufender Server wird benutzt).
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
const shot = (p, n, full = false) => p.screenshot({ path: path.join(SHOTS, `rv-${n}.png`), fullPage: full });
const PORT = Number(process.env.PORT || 8972);

const portOpen = (port) => new Promise((r) => { const c = net.connect(port, '127.0.0.1', () => { c.end(); r(true); }); c.on('error', () => r(false)); });
async function startServer() {
  if (await portOpen(PORT)) return { port: PORT, stop() {} };
  const child = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { if (await portOpen(PORT)) break; await new Promise((r) => setTimeout(r, 100)); }
  return { port: PORT, stop() { child.kill(); } };
}

// Wartezeiten verkürzen (Lebenszeichen und die 800 ms Bedenkzeit des Computers)
async function fast(ctx) {
  await ctx.addInitScript(() => {
    const si = window.setInterval.bind(window);
    window.setInterval = (f, t, ...a) => si(f, t < 200 ? 4 : t, ...a);
    const st = window.setTimeout.bind(window);
    window.setTimeout = (f, t, ...a) => st(f, t === 800 ? 25 : t, ...a);
  });
}
function watch(p, n) {
  p.on('pageerror', (e) => fail(`${n} pageerror ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') fail(`${n} console ${m.text()}`); });
}

const banner = async (p) => ((await p.locator('.banner').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
const isOver = async (p) => (await p.locator('.banner .trophy').count()) > 0;
const boardRect = (p) => p.evaluate(() => { const r = document.querySelector('#board').getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; });
const cellCount = (p) => p.locator('#board .rv-cell').count();
const discs = (p) => p.locator('#board .rv-disc').count();
const stones = async (p) => (await p.locator('.rv-stones b').allInnerTexts()).map(Number);
const points = async (p) => (await p.locator('.rv-p b').allInnerTexts()).map(Number);
const roundText = async (p) => ((await p.locator('.rv-round').innerText()) || '').trim();
const boardKey = (p) => p.evaluate(() => [...document.querySelectorAll('#board .rv-cell')].map((c) => (c.querySelector('.rv-face:not(.back)') || { className: '' }).className.replace('rv-face ', '').trim() || '.').join(''));
async function waitReady(p, ms = 8000) {
  await p.waitForFunction(() => document.querySelector('.banner.mine') || document.querySelector('.banner .trophy') || document.querySelector('[data-act=ack]'), null, { timeout: ms });
}
async function tapLegal(p) {
  const free = await p.locator('#board .rv-cell[data-hint="legal"]').evaluateAll((els) => els.map((e) => e.dataset.p));
  if (!free.length) throw new Error('kein erlaubtes Feld antippbar');
  await p.click(`#board .rv-cell[data-p="${rnd(free)}"]`, { timeout: 4000 });
}
async function startBot(page, base, level, { hints = false, name = 'Anna' } = {}) {
  await page.goto(base);
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
  await page.goto(base);
  await page.fill('#name', name);
  const box = page.locator('[data-opt="hints"]');
  if ((await box.isChecked()) !== hints) await box.setChecked(hints);
  await page.click(`[data-act=bot][data-level="${level}"]`);
  await page.waitForSelector('#board');
}
// Spielt als Mensch zufällig, bis die Runde zu Ende ist. Bestätigt Passen-Hinweise. Gibt zurück, wie oft gepasst wurde.
async function playRound(page, rects, passTexts) {
  const t0 = Date.now(); let passes = 0;
  while (Date.now() - t0 < 90000) {
    if (rects) rects.push(await boardRect(page));
    await waitReady(page);
    if (await isOver(page)) { if (rects) rects.push(await boardRect(page)); return passes; }
    if (await page.locator('[data-act=ack]').count()) {
      passes++;
      const txt = (await page.locator('.rv-status .big').innerText()).trim();
      if (passTexts) passTexts.push(txt);
      if (rects) rects.push(await boardRect(page));
      await page.click('[data-act=ack]');
      continue;
    }
    await tapLegal(page);
  }
  return -1;
}

async function main(BASE) {
  const browser = await chromium.launch();
  const mk = async (opts = {}) => { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, ...opts }); await fast(ctx); return ctx; };
  const URL = `${BASE}/reversi/index.html`;

  // ===== (a) Computer =====
  console.log('--- (a) gegen Computer');
  {
    const ctx = await mk();
    const p = await ctx.newPage(); watch(p, 'a');
    await startBot(p, URL, 1);
    await shot(p, 'a0-start');
    ok((await cellCount(p)) === 64, '8×8 = 64 Felder');
    ok((await discs(p)) === 4, 'Startstellung 4 Steine: ' + (await discs(p)));
    ok(JSON.stringify(await stones(p)) === '[2,2]', 'Steinzahl 2:2');
    ok(JSON.stringify(await points(p)) === '[0,0]', 'Punkte 0:0');
    ok(/Du bist dran! \(Schwarz\)/.test(await banner(p)), 'Mensch ist Schwarz und beginnt: ' + (await banner(p)));
    ok(/Runde 1 · Du beginnst/.test(await roundText(p)), 'Rundenzeile: ' + (await roundText(p)));
    ok((await p.locator('.rv-dot').count()) === 0, 'ohne Option keine Punkte');
    // Startstellung: d4/e5 weiß, d5/e4 schwarz
    ok((await boardKey(p)).slice(27, 28) === 'w' && (await boardKey(p))[36] === 'w' && (await boardKey(p))[35] === 'k' && (await boardKey(p))[28] === 'k', 'Startfarben: ' + (await boardKey(p)));
    // illegales Feld antippen
    await p.click('#board .rv-cell[data-p="0"]', { force: true });
    ok(/Dort kannst du nicht setzen/.test(await p.locator('.rv-hint').innerText().catch(() => '')), 'Hinweis bei illegalem Feld');
    ok((await discs(p)) === 4, 'illegaler Zug ändert nichts');
    await shot(p, 'a1-illegal');
    // erster Zug
    await tapLegal(p);
    await p.waitForFunction(() => document.querySelectorAll('#board .rv-disc').length >= 6, null, { timeout: 5000 });
    ok(await p.locator('#board .rv-cell.last').count() >= 1, 'letzter Zug markiert');
    ok(await p.locator('#board .rv-disc.flip').count() >= 1, 'Umdreh-Animation läuft');
    await shot(p, 'a2-nach-zug');
    // Computer zieht von selbst
    await p.waitForFunction(() => document.querySelectorAll('#board .rv-disc').length >= 7 || document.querySelector('.banner.mine'), null, { timeout: 5000 });
    let passes = await playRound(p);
    ok(passes >= 0, 'Runde 1 endet');
    await p.waitForSelector('.banner .trophy');
    const sc1 = await points(p);
    const st1 = await stones(p);
    console.log('Ende Runde 1:', await banner(p), '| Steine', st1, '| Punkte', sc1, '|', (await p.locator('.rv-status .big').innerText()).trim());
    const draw = /Unentschieden/.test(await banner(p));
    ok(draw ? (sc1[0] === 1 && sc1[1] === 1) : (sc1[0] + sc1[1] === 2 && Math.max(...sc1) === 2), 'Punkte passen zum Ausgang: ' + sc1);
    ok(st1[0] + st1[1] <= 64 && st1[0] + st1[1] >= 5, 'Steinzahl plausibel');
    await shot(p, 'a3-ende', true);
    ok((await p.locator('[data-act=next]').count()) === 1 && (await p.locator('[data-act=leave-now]').count()) === 1, 'Knöpfe „Noch eine Runde“ / „Spiel beenden“');
    await p.click('[data-act=next]');
    await p.waitForSelector('.banner:not(:has(.trophy))');
    ok(/Runde 2/.test(await roundText(p)), 'Runde 2: ' + (await roundText(p)));
    ok(/Computer beginnt/.test(await roundText(p)), 'Farbwechsel, Computer beginnt (Schwarz): ' + (await roundText(p)));
    ok(JSON.stringify(await points(p)) === JSON.stringify(sc1), 'Punktestand bleibt');
    // Computer beginnt: er setzt von selbst
    await p.waitForFunction(() => document.querySelectorAll('#board .rv-disc').length >= 5, null, { timeout: 5000 });
    await p.waitForSelector('.banner.mine');
    ok(/Du bist dran! \(Weiß\)/.test(await banner(p)), 'Ich bin jetzt Weiß: ' + (await banner(p)));
    // Neuladen mitten im Spiel
    const before = await boardKey(p);
    await p.reload();
    await p.waitForSelector('#board');
    ok((await boardKey(p)) === before, 'Spielstand nach Neuladen');
    ok(/Runde 2/.test(await roundText(p)), 'Runde bleibt nach Neuladen');
    ok((await playRound(p)) >= 0, 'Runde 2 endet');
    await p.click('[data-act=leave-now]');
    await p.waitForSelector('[data-act=host]');
    // Leicht: mehrere Partien, bis ein Passen vorkommt (Hinweis prüfen)
    const passTexts = [];
    for (let k = 0; k < 8 && !passTexts.length; k++) {
      await p.fill('#name', 'Anna');
      await p.click('[data-act=bot][data-level="0"]');
      await p.waitForSelector('#board');
      const n = await playRound(p, null, passTexts);
      ok(n >= 0, 'Leicht: Runde endet');
      if (passTexts.length) await shot(p, 'a4-nach-passen');
      await p.click('[data-act=leave-now]');
      await p.waitForSelector('[data-act=host]');
    }
    console.log('Passen-Hinweise:', passTexts.length ? passTexts.join(' | ') : '(in 8 Partien nicht vorgekommen)');
    for (const t of passTexts) ok(/Du kannst nicht ziehen, Computer ist wieder dran\.|Computer kann nicht ziehen\. Du bist wieder dran\./.test(t), 'Passen-Text: ' + t);
    await ctx.close();
  }

  // ===== (b) Option Hinweis-Felder =====
  console.log('--- (b) Mögliche Felder anzeigen');
  {
    const ctx = await mk();
    const p = await ctx.newPage(); watch(p, 'b');
    await p.goto(URL);
    await p.evaluate(() => { try { localStorage.clear(); } catch { /* egal */ } });
    await p.goto(URL);
    await p.fill('#name', 'Berta');
    const opt = await p.locator('.opt', { has: p.locator('[data-opt="hints"]') }).innerText();
    ok(/Mögliche Felder anzeigen/.test(opt), 'Option: ' + opt);
    ok(!(await p.locator('[data-opt="hints"]').isChecked()), 'Standard AUS');
    await shot(p, 'b0-option', true);
    await p.check('[data-opt="hints"]');
    await p.click('[data-act=bot][data-level="1"]');
    await p.waitForSelector('#board');
    ok((await p.locator('.rv-dot').count()) === 4, 'vier Punkte in der Startstellung: ' + (await p.locator('.rv-dot').count()));
    ok((await p.locator('#board .rv-cell[data-hint="legal"]').count()) === 4, 'vier erlaubte Felder');
    await shot(p, 'b1-hinweise');
    await tapLegal(p);
    await p.waitForSelector('.banner.mine');
    ok((await p.locator('.rv-dot').count()) >= 3, 'Punkte wieder da');
    ok((await p.locator('.rv-dot').count()) === (await p.locator('#board .rv-cell[data-hint="legal"]').count()), 'Punkte = erlaubte Felder');
    await ctx.close();
  }

  // ===== (c) Lernrunde =====
  console.log('--- (c) Lernrunde');
  {
    const ctx = await mk();
    const p = await ctx.newPage(); watch(p, 'c');
    await p.goto(URL);
    await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await p.goto(URL);
    await p.fill('#name', 'Gerda');
    await p.click('[data-act=learn]');
    await p.waitForSelector('.coach');
    ok((await p.locator('.rv-dot').count()) === 4, 'Lernrunde zeigt mögliche Felder');
    const texts = [];
    let human = 0; let reloaded = false; let shots = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      if (await p.locator('.banner .trophy').count()) break;
      const snap = await p.evaluate(() => ({ mine: !!document.querySelector('.banner.mine'), ack: !!document.querySelector('[data-act=ack]'), txt: (document.querySelector('.coach .coach-t') || { innerText: '' }).innerText.trim(), targets: document.querySelectorAll('.coach-target').length }));
      if (snap.mine || snap.ack) {
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
    const strategy = /beste|klug|empfehl|solltest|besser|Falle|Vorteil/i;
    ok(![...texts, endTxt].some((t) => strategy.test(t)), 'Strategie-Wörter im Coach');
    const nonRepeat = texts.filter((t) => !/^Du bist dran\./.test(t) && !/^Du kannst nicht ziehen, Computer ist wieder dran\./.test(t) && !/^Der Computer kann nicht ziehen\./.test(t));
    ok(new Set(nonRepeat).size === nonRepeat.length, 'Erklärung doppelt');
    ok(texts.some((t) => /Ziel:/.test(t)) && texts.some((t) => /einen Stein, indem/.test(t)) && texts.some((t) => /werden umgedreht/.test(t)), 'Ziel, Setzen, Umdrehen erklärt');
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
    const MURL = `${URL}?mock=1`;
    await A.goto(MURL);
    await A.fill('#name', 'Anna');
    await A.click('[data-act=host]');
    await A.waitForSelector('.code');
    const code = (await A.locator('.code').innerText()).trim();
    await B.goto(`${MURL}&raum=${code}`);
    await B.fill('#name', 'Ben');
    await B.click('[data-act=join-invited]');
    await A.waitForSelector('[data-act=start]');
    ok((await A.locator('[data-opt="hints"]').count()) === 1, 'Option in der Lobby');
    await shot(A, 'd0-lobby', true);
    await A.click('[data-act=start]');
    await A.waitForSelector('#board'); await B.waitForSelector('#board');
    ok(/Du bist dran! \(Schwarz\)/.test(await banner(A)), 'A beginnt als Schwarz: ' + (await banner(A)));
    ok(/Anna ist dran \(Schwarz\)/.test(await banner(B)), 'B sieht: ' + (await banner(B)));
    ok((await A.locator('.rv-dot').count()) === 0 && (await B.locator('.rv-dot').count()) === 0, 'keine Punkte ohne Option');
    await shot(A, 'd1-A-start'); await shot(B, 'd2-B-start');
    ok((await boardKey(A)) === (await boardKey(B)), 'Bretter gleich');
    // B ist nicht dran
    await B.click('#board .rv-cell[data-p="19"]', { force: true });
    ok((await discs(A)) === 4 && (await discs(B)) === 4, 'Zug der falschen Person');
    ok(/nicht an der Reihe/.test(await B.locator('.rv-hint').innerText().catch(() => '')), 'Hinweis „nicht an der Reihe“');
    // A setzt d3 (19) und dreht d4 um
    await A.click('#board .rv-cell[data-p="19"]', { force: true });
    await B.waitForFunction(() => document.querySelectorAll('#board .rv-disc').length === 5);
    ok(/Du bist dran! \(Weiß\)/.test(await banner(B)), 'B ist dran: ' + (await banner(B)));
    ok(JSON.stringify(await stones(A)) === '[4,1]' && JSON.stringify(await stones(B)) === '[4,1]', 'Steinzahl 4:1 bei beiden: ' + (await stones(A)) + ' / ' + (await stones(B)));
    ok((await boardKey(A)) === (await boardKey(B)), 'Bretter gleich nach Zug');
    // Hilfe
    await A.click('[data-act=help]');
    const help = await A.locator('.modal').innerText();
    ok(/Reversi/.test(help) && /einschließen/.test(help) && /passen/.test(help) && /Ecken/.test(help) && /Unentschieden/.test(help) && !/Othello/i.test(help), 'Hilfetext');
    await shot(A, 'd3-hilfe');
    { const bb = await A.locator('.modal [data-act=help-close]').boundingBox().catch(() => null); if (bb) await A.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); else await A.evaluate(() => document.querySelector('.overlay').scrollTo(0, 99999)); }
    await A.evaluate(() => document.querySelector('.overlay') && document.querySelector('.overlay').scrollTo(0, 99999));
    if (await A.locator('.modal').count()) { const bb = await A.locator('.modal [data-act=help-close]').boundingBox(); await A.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); }
    ok((await A.locator('.modal').count()) === 0, 'Hilfe schließt');
    // Rest der Runde: beide ziehen jeweils zufällig; Zustände müssen immer gleich sein
    const t0 = Date.now(); let steps = 0; let sawPass = false;
    while (Date.now() - t0 < 90000) {
      if ((await isOver(A)) && (await isOver(B))) break;
      const pageA = await A.locator('[data-act=ack]').count(); const pageB = await B.locator('[data-act=ack]').count();
      if (pageA || pageB) {
        sawPass = true;
        const ta = (await A.locator('.rv-status .big').innerText()).trim(); const tb = (await B.locator('.rv-status .big').innerText()).trim();
        console.log('Passen (A):', ta, '| (B):', tb);
        ok(/Anna|Ben|Du kannst nicht ziehen/.test(ta + tb), 'Passen-Text');
        await (pageB ? B : A).click('[data-act=ack]');
        await A.waitForFunction(() => !document.querySelector('[data-act=ack]')); await B.waitForFunction(() => !document.querySelector('[data-act=ack]'));
        continue;
      }
      const turnA = await A.locator('.banner.mine').count(); const turnB = await B.locator('.banner.mine').count();
      const pg = turnA ? A : turnB ? B : null;
      if (!pg) { await A.waitForTimeout(30); continue; }
      const before = steps;
      await tapLegal(pg); steps++;
      await A.waitForTimeout(40);
      if (steps % 6 === 0) ok((await boardKey(A)) === (await boardKey(B)), `Bretter gleich nach ${steps} Zügen`);
      void before;
    }
    await A.waitForSelector('.banner .trophy'); await B.waitForSelector('.banner .trophy');
    ok((await boardKey(A)) === (await boardKey(B)), 'Endbretter gleich');
    ok(JSON.stringify(await stones(A)) === JSON.stringify(await stones(B)), 'Steinzahlen gleich');
    ok(JSON.stringify(await points(A)) === JSON.stringify(await points(B)), 'Punkte gleich');
    console.log('Zwei Personen:', steps, 'Züge, Passen gesehen:', sawPass, '| A:', await banner(A), '| B:', await banner(B), '| Steine', await stones(A), 'Punkte', await points(A));
    ok(/Du hast gewonnen|Ben hat gewonnen|Unentschieden/.test(await banner(A)), 'A Banner: ' + (await banner(A)));
    ok((await A.locator('[data-act=next]').count()) === 1, 'Host sieht „Noch eine Runde“');
    ok((await B.locator('[data-act=next]').count()) === 0, 'Gast sieht es nicht');
    ok(/Gastgeber startet/.test(await B.locator('.rv-status').innerText()), 'Gast-Hinweis');
    await shot(A, 'd4-A-ende', true); await shot(B, 'd5-B-ende', true);
    const scAfter = await points(A);
    await A.click('[data-act=next]');
    await A.waitForSelector('.banner:not(:has(.trophy))'); await B.waitForSelector('.banner:not(:has(.trophy))');
    ok(/Du bist dran! \(Schwarz\)/.test(await banner(B)), 'Runde 2 beginnt Ben als Schwarz: ' + (await banner(B)));
    ok(/Ben beginnt/.test(await roundText(A)) && /Du beginnst/.test(await roundText(B)), 'Rundenzeile beider Seiten');
    ok((await discs(A)) === 4 && (await discs(B)) === 4, 'Startstellung in Runde 2');
    ok(JSON.stringify(await points(B)) === JSON.stringify(scAfter), 'Punktestand bleibt');
    ok(!/Othello/i.test(await A.content()), 'Name nirgends Othello');
    B.once('dialog', (d) => d.accept()); A.once('dialog', (d) => d.accept());
    await B.click('[data-act=leave]').catch(() => {});
    await A.click('[data-act=leave]');
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
    for (const hints of [false, true]) {
      const label = hints ? 'mit Hinweisen' : 'ohne Hinweise';
      await startBot(p, URL, 1, { hints });
      await noScroll(label + ' Start');
      const sizes = await p.locator('#board .rv-cell').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
      console.log(`${label}: kleinstes Feld ${Math.min(...sizes).toFixed(1)} px, größtes ${Math.max(...sizes).toFixed(1)} px`);
      ok(Math.min(...sizes) >= 44 && Math.min(...sizes) <= 48, `Feldgröße ${Math.min(...sizes)}`);
      const brect = await boardRect(p);
      ok(brect.width >= 366, 'Brett volle Breite: ' + brect.width);
      const btns = await p.locator('.btn').evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height));
      ok(Math.min(...btns) >= 44, 'Knopfhöhe');
      const rects = [];
      const first = await boardRect(p);
      await tapLegal(p);
      await p.waitForFunction(() => document.querySelectorAll('#board .rv-disc').length >= 6);
      rects.push(await boardRect(p));
      await p.waitForSelector('.banner.mine');
      await p.click('#board .rv-cell[data-p="0"]', { force: true });
      rects.push(await boardRect(p));
      ok(await p.locator('.rv-hint').count(), 'Hinweis sichtbar');
      await shot(p, `e-${hints ? 'hint' : 'plain'}-hinweis`);
      await playRound(p, rects);
      await noScroll(label + ' Ende');
      const all = [first, ...rects];
      const dy = Math.max(...all.map((r) => r.y)) - Math.min(...all.map((r) => r.y));
      const dx = Math.max(...all.map((r) => r.x)) - Math.min(...all.map((r) => r.x));
      const dw = Math.max(...all.map((r) => r.width)) - Math.min(...all.map((r) => r.width));
      console.log(`${label}: Brett über ${all.length} Zustände – Abweichung y ${dy.toFixed(1)} px, x ${dx.toFixed(1)}, Breite ${dw.toFixed(1)}; Position y=${first.y.toFixed(0)}`);
      ok(dy <= 1 && dx <= 1 && dw <= 1, `${label}: Brett springt (y ${dy}, x ${dx}, b ${dw})`);
      await shot(p, `e-${hints ? 'hint' : 'plain'}-ende`, true);
      await p.click('[data-act=next]');
      await p.waitForSelector('.banner:not(:has(.trophy))');
      await p.waitForTimeout(100);
      const r2 = await boardRect(p);
      ok(Math.abs(r2.y - first.y) <= 1, `${label}: Brett in Runde 2 an anderer Stelle (${r2.y} statt ${first.y})`);
      await p.click('[data-act=bigger]');
      await noScroll(label + ' große Schrift');
      await shot(p, `e-${hints ? 'hint' : 'plain'}-gross`);
      await p.click('[data-act=bigger]');
    }
    await p.goto(URL);
    await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await p.goto(URL);
    await noScroll('Startseite');
    await shot(p, 'e-startseite', true);
    await p.setViewportSize({ width: 320, height: 640 });
    await p.fill('#name', 'Eva');
    await p.click('[data-act=bot][data-level="1"]');
    await p.waitForSelector('#board');
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    const m = await p.locator('#board .rv-cell').evaluateAll((els) => Math.min(...els.map((e) => e.getBoundingClientRect().width)));
    console.log(`320 px breit: Seitenbreite ${sw}, kleinstes Feld ${m.toFixed(1)} px`);
    ok(sw <= 320, 'Scrollen bei 320 px: ' + sw);
    await shot(p, 'e-320');
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
