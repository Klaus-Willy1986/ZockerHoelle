// Durchspieltest im Browser für „Backgammon“:
// (a) ganze Partie gegen den Computer (Mittel) bis zum Ende, Würfel/Tippen/Hinweise/Zoom, Neuladen, „Noch eine Runde“
// (b) Lernrunde kommt durch (nur den Anweisungen im Coach folgen)
// (c) zwei Personen über das Test-Netz (?mock=1): Gastgeber und Gast, Zustände spiegelbildlich gleich
// (d) Layout 390×844: kein seitliches Scrollen, Knöpfe >= 48 px, Brett bleibt an derselben Stelle
// Aufruf: NODE_PATH=$(npm root -g) node tests/backgammon.e2e.cjs
// Der Test startet selbst einen Webserver (python3 -m http.server, Port 8971, mit PORT=… änderbar) und beendet ihn am Ende wieder.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 8971);
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
fs.mkdirSync(SHOTS, { recursive: true });
const errors = [];
const fail = (m) => { console.log('FEHLER:', m); errors.push(m); };
const ok = (c, m) => { if (!c) fail(m); };
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const shot = (p, n, full = false) => p.screenshot({ path: path.join(SHOTS, `bgm-${n}.png`), fullPage: full });

async function startServer() {
  const child = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    const up = await new Promise((r) => { const c = net.connect(PORT, '127.0.0.1', () => { c.end(); r(true); }); c.on('error', () => r(false)); });
    if (up) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { port: PORT, stop() { child.kill(); } };
}

// Wartezeiten verkürzen (Lebenszeichen, 800 ms Bedenkzeit des Computers)
async function fast(ctx) {
  await ctx.addInitScript(() => {
    const si = window.setInterval.bind(window);
    window.setInterval = (f, t, ...a) => si(f, t < 200 ? 4 : t, ...a);
    const st = window.setTimeout.bind(window);
    window.setTimeout = (f, t, ...a) => st(f, t === 800 ? 20 : t, ...a);
  });
}
function watch(p, n) {
  p.on('pageerror', (e) => fail(`${n} pageerror ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') fail(`${n} console ${m.text()}`); });
}

const banner = async (p) => ((await p.locator('.banner').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
const isOver = async (p) => (await p.locator('.banner .trophy').count()) > 0;
const boardRect = (p) => p.evaluate(() => { const r = document.querySelector('#board').getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; });
const noHScroll = async (p, label, w = 390) => {
  const sw = await p.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
  ok(sw <= w, `${label}: horizontales Scrollen (${sw}px)`);
};
const snap = (p) => p.evaluate(() => ({
  mine: !!document.querySelector('.banner.mine'),
  over: !!document.querySelector('.banner .trophy'),
  roll: !!document.querySelector('[data-act=roll]'),
  can: document.querySelectorAll('.bg-pt.can').length,
  tgt: document.querySelectorAll('.bg-pt.tgt').length,
  die: document.querySelectorAll('[data-act=die]').length,
  next: !!document.querySelector('[data-act=next]'),
  rolling: !!document.querySelector('#dice .spin'),
}));

// Ein Schritt als Mensch (zufällig): würfeln / Quelle antippen / Ziel antippen / Zahl wählen. Gibt den Schnappschuss zurück.
async function humanStep(p, st) {
  const s = await snap(p);
  if (!s.mine || s.over || s.rolling) return s;
  if (s.roll) { await p.click('[data-act=roll]', { timeout: 4000 }); st.rolls++; return s; }
  if (s.die) { await p.locator('[data-act=die]').first().click({ timeout: 4000 }); st.choices++; return s; }
  if (s.tgt) {
    const i = Math.floor(Math.random() * s.tgt);
    await p.locator('.bg-pt.tgt').nth(i).click({ timeout: 4000 });
    st.moves++;
    return s;
  }
  if (s.can) { await p.locator('.bg-pt.can').nth(Math.floor(Math.random() * s.can)).click({ timeout: 4000 }); st.selects++; return s; }
  return s;
}
async function playToEnd(p, st, ms = 150000, each) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await isOver(p)) return true;
    const s = await humanStep(p, st);
    if (each) await each(s);
    if (!s.mine || s.rolling) await p.waitForTimeout(15);
  }
  return false;
}
async function startBot(page, base, level, { opts = [], name = 'Anna' } = {}) {
  await page.goto(base);
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
  await page.goto(base);
  await page.fill('#name', name);
  for (const id of ['to5', 'one', 'hints', 'pip']) {
    const box = page.locator(`[data-opt="${id}"]`);
    const want = opts.includes(id);
    if ((await box.isChecked()) !== want) await box.setChecked(want);
  }
  await page.click(`[data-act=bot][data-level="${level}"]`);
  await page.waitForSelector('#board');
}
const stats = () => ({ rolls: 0, moves: 0, selects: 0, choices: 0 });

async function main(BASE) {
  const browser = await chromium.launch();
  const mk = async (o = {}) => { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, ...o }); await fast(ctx); return ctx; };
  const URL0 = `${BASE}/backgammon/index.html`;

  // ===== (a) ganze Partie gegen Computer =====
  console.log('--- (a) gegen Computer (Mittel), ein Spiel');
  {
    const ctx = await mk();
    const p = await ctx.newPage(); watch(p, 'a');
    await startBot(p, URL0, 1, { opts: ['one', 'hints', 'pip'] });
    await shot(p, 'a0-start');
    ok((await p.locator('#board .bg-pt[data-p]').count()) === 24, '24 Spitzen antippbar');
    ok((await p.locator('#board .bg-pt.bg-bar').count()) === 1 && (await p.locator('#board [data-act=off]').count()) === 1, 'Bar und Raus antippbar');
    ok(/Ein Spiel/.test(await p.locator('.bg-round').innerText()), 'Ziel-Zeile: ' + (await p.locator('.bg-round').innerText()));
    ok(/Augen bis zum Ziel: 167/.test(await p.locator('.bg-score').innerText()), 'Augenzahl sichtbar (Option)');
    // Eröffnung: wer beginnt, steht in der Zusammenfassung
    const rec = await p.locator('.recap').innerText();
    ok(/Eröffnungswurf/.test(rec), 'Eröffnungswurf im Protokoll');
    // Wartet, bis der Mensch dran ist
    await p.waitForFunction(() => document.querySelector('.banner.mine'), null, { timeout: 15000 });
    // Falsche Eingaben: Spitze ohne eigenen Stein antippen -> Hinweis
    let s = await snap(p);
    if (s.roll) {
      await p.click('#board .bg-pt[data-p="2"]', { force: true });
      ok(/Würfle zuerst/.test(await p.locator('.bg-hint').innerText().catch(() => '')), 'Hinweis „Würfle zuerst“');
      await p.click('[data-act=roll]');
      await p.waitForFunction(() => !document.querySelector('#dice .spin'), null, { timeout: 5000 });
    }
    s = await snap(p);
    if (s.mine && !s.roll && s.can) {
      await shot(p, 'a1-nach-wurf');
      const dice = await p.locator('#dice .die').count();
      ok(dice === 2 || dice === 4, 'Würfel sichtbar: ' + dice);
      // eine leere Spitze antippen -> Hinweis
      const emptyQ = await p.evaluate(() => { const e = [...document.querySelectorAll('#board .bg-pt[data-p]')].find((x) => /leer/.test(x.getAttribute('aria-label'))); return e && e.dataset.p; });
      if (emptyQ) {
        await p.click(`#board .bg-pt[data-p="${emptyQ}"]`, { force: true });
        ok(/Hier liegt kein Stein|Dorthin|Bar/.test(await p.locator('.bg-hint').innerText().catch(() => '')), 'Hinweis bei leerer Spitze');
        await shot(p, 'a2-hinweis');
      }
    }
    // Zoom
    await p.click('[data-act=zoom]');
    ok((await p.locator('.bg-wrap.zoom').count()) === 1, 'Zoom an');
    await noHScroll(p, 'a Zoom');
    await shot(p, 'a3-zoom');
    await p.click('[data-act=zoom]');
    ok((await p.locator('.bg-wrap.zoom').count()) === 0, 'Zoom aus');
    // Spielen; unterwegs: Neuladen, letzter Zug markiert
    const st = stats();
    let reloaded = false; let sawLast = false; let sawUsed = false; let shots = 0;
    const done = await playToEnd(p, st, 180000, async (sn) => {
      if (sn.mine && !sn.roll) {
        if (!sawLast && (await p.locator('.bg-lastp').count())) { sawLast = true; }
        if (!sawUsed && (await p.locator('#dice .bg-used').count())) { sawUsed = true; if (shots < 2) await shot(p, `a4-gebraucht${shots++}`); }
      }
      if (!reloaded && st.moves >= 8 && sn.mine && !sn.roll && !sn.tgt) {
        reloaded = true;
        const before = await p.locator('#board svg').innerHTML();
        await p.reload(); await p.waitForSelector('#board');
        ok((await p.locator('#board svg').innerHTML()).length > 1000, 'Brett nach Neuladen da');
        ok(before.length > 1000, 'vorher auch');
      }
    });
    ok(done, 'Partie endet (Würfe ' + st.rolls + ', Züge ' + st.moves + ')');
    console.log('Partie: Würfe', st.rolls, 'Züge', st.moves, 'Zahlwahl', st.choices, '· Ergebnis:', await banner(p));
    ok(sawLast, 'letzter Zug markiert');
    ok(sawUsed, 'verbrauchte Würfel ausgegraut');
    ok(reloaded, 'Neuladen geprüft');
    await p.waitForSelector('.banner .trophy');
    const over = (await p.locator('.bg-status .big').innerText()).trim();
    console.log('Ende:', over);
    ok(/Punkt/.test(over) && /15 Steine/.test(over), 'Ergebnistext mit Punkten');
    ok(/hat (diese Partie|das Spiel) gewonnen|Du hast/.test(await banner(p)), 'Siegerbanner: ' + (await banner(p)));
    ok((await p.locator('[data-act=next]').count()) === 1 && (await p.locator('[data-act=leave-now]').count()) === 1, 'Knöpfe Noch eine Runde / Spiel beenden');
    await shot(p, 'a5-ende', true);
    await p.click('[data-act=next]');
    await p.waitForSelector('.banner:not(:has(.trophy))');
    ok(/Ein Spiel · Partie 1/.test(await p.locator('.bg-round').innerText()), 'Ein-Spiel-Option: neues Match startet bei Partie 1');
    await ctx.close();
  }

  // ===== (a2) Match bis 3 Punkte mit Punktestand zwischen den Partien =====
  console.log('--- (a2) Match bis 3 Punkte gegen Computer (Leicht)');
  {
    const ctx = await mk();
    const p = await ctx.newPage(); watch(p, 'a2');
    await startBot(p, URL0, 0, { opts: ['hints'] });
    ok(/Bis 3 Punkte · Partie 1/.test(await p.locator('.bg-round').innerText()), 'Standard: bis 3 Punkte');
    const st = stats();
    let games = 0; let carry = true; let matchEnd = false;
    for (let k = 0; k < 8 && !matchEnd; k++) {
      ok(await playToEnd(p, st, 180000), 'Partie ' + (k + 1) + ' endet');
      games++;
      const sc = (await p.locator('.bg-pl .bg-p b').allInnerTexts()).filter((_, i) => i % 2 === 0).map(Number);
      console.log(`Partie ${k + 1}:`, await banner(p), '· Punkte', sc);
      if (Math.max(...sc) >= 3) { matchEnd = true; ok(/Match bis 3 Punkte/.test(await p.locator('.bg-status .big').innerText()), 'Matchende im Text'); ok(/gewonnen/.test(await banner(p)), 'Banner Spiel gewonnen'); break; }
      await p.click('[data-act=next]');
      await p.waitForSelector('.banner:not(:has(.trophy))');
      const sc2 = (await p.locator('.bg-pl .bg-p b').allInnerTexts()).filter((_, i) => i % 2 === 0).map(Number);
      carry = carry && JSON.stringify(sc) === JSON.stringify(sc2);
      ok(new RegExp(`Partie ${k + 2}`).test(await p.locator('.bg-round').innerText()), 'Partie ' + (k + 2));
      // Verlierer beginnt: Banner zeigt, wer dran ist
    }
    ok(carry, 'Punktestand bleibt zwischen den Partien');
    ok(matchEnd, 'Match endet nach höchstens 8 Partien');
    await shot(p, 'a6-matchende', true);
    await p.click('[data-act=next]');
    await p.waitForSelector('.banner:not(:has(.trophy))');
    ok(/Partie 1/.test(await p.locator('.bg-round').innerText()), 'neues Match startet bei Partie 1');
    ok(JSON.stringify((await p.locator('.bg-pl .bg-p b').allInnerTexts()).filter((_, i) => i % 2 === 0)) === '["0","0"]', 'Punkte zurückgesetzt');
    await ctx.close();
  }

  // ===== (b) Lernrunde =====
  console.log('--- (b) Lernrunde');
  {
    const ctx = await mk();
    const p = await ctx.newPage(); watch(p, 'b');
    await p.goto(URL0);
    await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await p.goto(URL0);
    await p.fill('#name', 'Gerda');
    await p.click('[data-act=learn]');
    await p.waitForSelector('.coach');
    ok((await p.locator('.bg-pt.can').count()) >= 0, 'Lernrunde läuft');
    const texts = new Set(); const seqTexts = [];
    let clicks = 0; let stuck = 0; let shots = 0; let noTarget = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 200000) {
      if (await p.locator('.banner .trophy').count()) break;
      const sn = await p.evaluate(() => ({ mine: !!document.querySelector('.banner.mine'), txt: (document.querySelector('.coach .coach-t') || { innerText: '' }).innerText.trim(), targets: document.querySelectorAll('.coach-target').length, rolling: !!document.querySelector('#dice .spin') }));
      if (sn.txt && seqTexts[seqTexts.length - 1] !== sn.txt) { seqTexts.push(sn.txt); texts.add(sn.txt); if (shots < 4 && /Jede Zahl|Rahmen und Punkt|Bar|Pasch|heraus/.test(sn.txt)) await shot(p, `b${++shots}-coach`); }
      if (sn.mine && !sn.rolling) {
        if (!sn.targets) { stuck++; if (stuck > 80) { noTarget++; stuck = 0; await shot(p, 'b-fehler-kein-ziel'); } await p.waitForTimeout(20); continue; }
        stuck = 0;
        await p.locator('.coach-target').first().click({ timeout: 4000 }).catch(() => {});
        clicks++;
      } else {
        ok(!sn.mine || sn.rolling, 'Wartezustand');
        if (!sn.mine && !sn.rolling && sn.txt && !/Computer|Würfel rollen/.test(sn.txt)) ok(false, 'Computer-Text erwartet: ' + sn.txt);
        await p.waitForTimeout(15);
      }
    }
    ok(await p.locator('.banner .trophy').count(), 'Lernrunde endet');
    ok(noTarget === 0, 'immer ein Ziel für den Menschen (' + noTarget + ')');
    const endTxt = (await p.innerText('.coach .coach-t')).trim();
    ok(/Noch eine Runde/.test(endTxt), 'Ende-Text: ' + endTxt);
    ok((await p.locator('.coach-target[data-act=next]').count()) === 1, 'Ziel „Noch eine Runde“');
    await shot(p, 'b9-ende', true);
    console.log('Lernrunde: Klicks', clicks, '· verschiedene Texte', texts.size);
    const strategy = /beste|klug|empfehl|solltest|am besten|Strategie|Falle/i;
    ok(![...texts, endTxt].some((t) => strategy.test(t)), 'Strategie-Wörter im Coach');
    const topics = [/Ziel: Alle deine 15 Steine/, /Jede Zahl ziehst du einzeln/];
    for (const re of topics) ok(seqTexts.filter((t) => re.test(t)).length === 1, 'Erklärung genau einmal: ' + re);
    console.log(' - ' + [...texts].filter((t) => !/^(Tippe auf Würfeln\.|Jetzt ist der Computer dran|Noch zu spielen)/.test(t)).slice(0, 12).join('\n - '));
    await p.click('[data-act=learn-stop]').catch(() => {});
    await ctx.close();
  }

  // ===== (c) zwei Personen =====
  console.log('--- (c) zwei Personen (Test-Netz)');
  {
    const ctx = await mk();
    const A = await ctx.newPage(); watch(A, 'A');
    const B = await ctx.newPage(); watch(B, 'B');
    const URL = `${URL0}?mock=1`;
    await A.goto(URL);
    await A.fill('#name', 'Anna');
    await A.click('[data-act=host]');
    await A.waitForSelector('.code');
    const code = (await A.locator('.code').innerText()).trim();
    await B.goto(`${URL}&raum=${code}`);
    await B.fill('#name', 'Ben');
    await B.click('[data-act=join-invited]');
    await A.waitForSelector('[data-act=start]');
    ok((await A.locator('[data-opt]').count()) === 4, 'vier Optionen in der Lobby');
    await A.check('[data-opt="one"]'); await A.check('[data-opt="hints"]');
    await shot(A, 'c0-lobby', true);
    await A.click('[data-act=start]');
    await A.waitForSelector('#board'); await B.waitForSelector('#board');
    const sides = async () => ({ a: (await A.locator('.bg-legend').innerText()).includes('Hell') ? 'Hell' : 'Dunkel', b: (await B.locator('.bg-legend').innerText()).includes('Hell') ? 'Hell' : 'Dunkel' });
    const sd = await sides();
    ok(sd.a !== sd.b, 'zwei verschiedene Seiten: ' + JSON.stringify(sd));
    // Spiegelvergleich: Spitze q (A) entspricht 25-q (B); eigene <-> gegnerische Steine
    const parse = (l) => { const m = /Spitze (\d+), (?:(\d+) eigene|(\d+) gegnerische|leer)/.exec(l); return { q: Number(m[1]), mine: Number(m[2] || 0), their: Number(m[3] || 0) }; };
    const labels = async (pg) => (await pg.locator('#board .bg-pt[data-p]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).map(parse);
    const compare = async (tag) => {
      const la = await labels(A); const lb = await labels(B);
      for (const x of la) {
        const y = lb.find((z) => z.q === 25 - x.q);
        if (!y || x.mine !== y.their || x.their !== y.mine) { fail(`${tag}: Spitze ${x.q} bei A ≠ Spitze ${25 - x.q} bei B`); return; }
      }
      const sa = (await A.locator('.bg-pl .bg-p').allInnerTexts()).join('|'); const sb = (await B.locator('.bg-pl .bg-p').allInnerTexts()).join('|');
      ok(sa === sb, `${tag}: Punktestand/Raus unterschiedlich: ${sa} / ${sb}`);
      const da = await A.locator('#dice .die').evaluateAll((e) => e.map((x) => x.getAttribute('aria-label')).join(',')); const db = await B.locator('#dice .die').evaluateAll((e) => e.map((x) => x.getAttribute('aria-label')).join(','));
      ok(da === db, `${tag}: Würfel unterschiedlich ${da} / ${db}`);
    };
    await compare('Start');
    await shot(A, 'c1-A-start'); await shot(B, 'c2-B-start');
    // Wer dran ist
    const turnPage = async () => ((await A.locator('.banner.mine').count()) ? A : B);
    // Falsche Person: tippt auf Würfeln-Bereich … hat keinen Knopf; Spitze tippen gibt Hinweis
    const mineFirst = await turnPage();
    const other = mineFirst === A ? B : A;
    ok((await other.locator('[data-act=roll]').count()) === 0, 'Gegenseite hat keinen Würfeln-Knopf');
    await other.click('#board .bg-pt[data-p="13"]', { force: true });
    ok(/nicht dran/.test(await other.locator('.bg-hint').innerText().catch(() => '')), 'Hinweis „nicht dran“');
    // Hilfe
    await A.click('[data-act=help]');
    const help = await A.locator('.modal').innerText();
    ok(/Backgammon/.test(help) && /Gammon/.test(help) && /Bar/.test(help) && /Herausspielen/.test(help) && /Pasch/.test(help), 'Hilfetext');
    await shot(A, 'c3-hilfe');
    await A.evaluate(() => document.querySelector('.overlay').scrollTo(0, 99999));
    await shot(A, 'c3b-hilfe-ende');
    { const bb = await A.locator('.modal [data-act=help-close]').boundingBox(); await A.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); }
    ok((await A.locator('.modal').count()) === 0, 'Hilfe schließt');
    // spielen: wer dran ist, macht Zufallszüge; Vergleich nach jedem Zug
    const st = stats(); const t0 = Date.now(); let cmp = 0;
    while (Date.now() - t0 < 180000) {
      if ((await isOver(A)) && (await isOver(B))) break;
      const pg = await turnPage().catch(() => A);
      const s = await humanStep(pg, st);
      if (s.mine && !s.rolling && !s.roll && !s.can && !s.tgt) await A.waitForTimeout(15);
      if (st.moves % 6 === 0 && s.tgt && cmp < 12) { await A.waitForTimeout(60); await compare('Zug ' + st.moves); cmp++; }
      if (!s.mine) await A.waitForTimeout(15);
    }
    ok((await isOver(A)) && (await isOver(B)), 'Partie endet bei beiden (Würfe ' + st.rolls + ', Züge ' + st.moves + ')');
    await A.waitForTimeout(100);
    await compare('Ende');
    const bA = await banner(A); const bB = await banner(B);
    console.log('Ende A:', bA, '| B:', bB);
    ok((/Du hast/.test(bA) && /Anna|Ben/.test(bB) && !/Du hast/.test(bB)) || (/Du hast/.test(bB) && !/Du hast/.test(bA)), 'Sieger-Banner passend');
    ok((await A.locator('[data-act=next]').count()) === 1 && (await B.locator('[data-act=next]').count()) === 0, 'nur Gastgeber sieht „Noch eine Runde“');
    ok(/Gastgeber startet/.test(await B.locator('.bg-status').innerText()), 'Gast-Hinweis');
    await shot(A, 'c4-A-ende', true); await shot(B, 'c5-B-ende', true);
    // Gast sieht keine Verdeckten Infos: es gibt keine (Würfel und Brett sind offen) – DOM enthält nur Brett, Würfel, Texte
    await A.click('[data-act=next]');
    await A.waitForSelector('.banner:not(:has(.trophy))'); await B.waitForSelector('.banner:not(:has(.trophy))');
    await compare('nach Noch eine Runde');
    await B.click('[data-act=leave-now]').catch(() => {});
    await A.click('[data-act=leave-now]').catch(() => {});
    await ctx.close();
  }

  // ===== (d) Layout 390×844 =====
  console.log('--- (d) Layout 390×844');
  {
    const ctx = await mk();
    const p = await ctx.newPage(); watch(p, 'd');
    await p.goto(URL0);
    await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await p.goto(URL0);
    await noHScroll(p, 'Startseite');
    await shot(p, 'd0-start', true);
    const optTxt = await p.locator('.optcard').innerText();
    ok(/Bis 5 Punkte/.test(optTxt) && /Nur ein Spiel/.test(optTxt) && /Augenzahl anzeigen/.test(optTxt) && /Ziehbare Steine/.test(optTxt), 'Optionen: ' + optTxt.replace(/\s+/g, ' '));
    await startBot(p, URL0, 1, { opts: ['hints'] });
    await noHScroll(p, 'Spiel Start');
    const first = await boardRect(p);
    const rects = [first];
    const sizes = await p.locator('#board .bg-pt[data-p]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }));
    console.log(`Tippfläche einer Spitze: ${Math.min(...sizes.map((s) => s[0])).toFixed(1)} × ${Math.min(...sizes.map((s) => s[1])).toFixed(1)} px; Brettbreite ${first.width.toFixed(0)}`);
    ok(Math.min(...sizes.map((s) => s[1])) >= 100, 'Tippfläche zu niedrig');
    const bar = await p.locator('#board .bg-bar').boundingBox(); const off = await p.locator('#board [data-act=off]').boundingBox();
    ok(bar.height >= 48 && bar.width >= 100 && off.width >= 36 && off.height >= 100, `Bar ${bar.width}×${bar.height}, Raus ${off.width}×${off.height}`);
    const checkBtns = async (label) => {
      const btns = await p.locator('.btn:not(.mini)').evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => [e.innerText.trim().slice(0, 20), e.getBoundingClientRect().height]));
      const small = btns.filter((b) => b[1] < 48);
      ok(small.length === 0, `${label}: Knöpfe unter 48 px: ${JSON.stringify(small)}`);
    };
    await checkBtns('Start');
    // alle Zustände durchlaufen: Wurf, Hinweis, Computerzüge, Pass-Hinweis, Ende
    const st = stats();
    const done = await playToEnd(p, st, 180000, async (sn) => {
      rects.push(await boardRect(p));
      if (sn.roll) await checkBtns('Würfeln');
    });
    ok(done, 'Layout-Partie endet');
    rects.push(await boardRect(p));
    await noHScroll(p, 'Spiel Ende');
    const dy = Math.max(...rects.map((r) => r.y)) - Math.min(...rects.map((r) => r.y));
    const dx = Math.max(...rects.map((r) => r.x)) - Math.min(...rects.map((r) => r.x));
    const dw = Math.max(...rects.map((r) => r.width)) - Math.min(...rects.map((r) => r.width));
    console.log(`Brett über ${rects.length} Zustände – Abweichung y ${dy.toFixed(1)} px, x ${dx.toFixed(1)}, Breite ${dw.toFixed(1)}; Position y=${first.y.toFixed(0)}`);
    ok(dy <= 1 && dx <= 1 && dw <= 1, `Brett springt (y ${dy}, x ${dx}, b ${dw})`);
    await checkBtns('Ende');
    await shot(p, 'd1-ende', true);
    // Hinweis, Zoom, große Schrift
    await p.click('[data-act=next]');
    await p.waitForSelector('.banner:not(:has(.trophy))');
    await p.waitForTimeout(100);
    const r2 = await boardRect(p);
    ok(Math.abs(r2.y - first.y) <= 1, `Brett nach „Noch eine Runde“ an anderer Stelle (${r2.y} statt ${first.y})`);
    await p.click('[data-act=bigger]');
    await noHScroll(p, 'große Schrift');
    const r3 = await boardRect(p);
    ok(r3.width <= 390, 'Brett passt bei großer Schrift');
    await shot(p, 'd2-gross');
    await p.click('[data-act=bigger]');
    await p.click('[data-act=zoom]');
    await noHScroll(p, 'Zoom');
    const zs = await p.locator('#board .bg-pt[data-p]').evaluateAll((els) => Math.min(...els.map((e) => e.getBoundingClientRect().width)));
    console.log(`Zoom: Spitzenbreite ${zs.toFixed(1)} px`);
    ok(zs >= 36, 'Zoom macht Spitzen breiter');
    await shot(p, 'd3-zoom');
    // schmales Handy
    await p.click('[data-act=zoom]');
    await p.setViewportSize({ width: 320, height: 640 });
    await noHScroll(p, '320 px', 320);
    await shot(p, 'd4-320');
    await p.setViewportSize({ width: 1200, height: 900 });
    await shot(p, 'd5-desktop');
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
