// Schach im Browser: (a) Partie gegen den Computer (Leicht) bis zum Ende + "Noch eine Runde", Hilfen aus/an, unerlaubte Züge,
// (b) Matt in 1 per ?fen=, (c) Gastgeber + Gast über Test-Netz (Rochade, Umwandlung, Schach), (d) Lernrunde, (e) Layout 390x844.
// Aufruf: NODE_PATH=$(npm root -g) node tests/schach.e2e.cjs [Screenshot-Ordner] [Port]
// Startet selbst einen Static-Server (python3 -m http.server) und beendet ihn am Ende wieder.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const SP = process.argv[2] || '.';
const PORT = process.argv[3] || '8973';
const ROOT = path.resolve(__dirname, '..');
const check = (c, m) => { if (!c) throw new Error(m); };
const shot = (p, name, full = true) => p.screenshot({ path: `${SP}/schach-${name}.png`, fullPage: full });

// schnelle Uhren: Computer-Verzögerung (600 ms) und kurze Intervalle werden gekürzt
const speedUp = () => {
  const st = window.setTimeout.bind(window);
  window.setTimeout = (f, t, ...a) => st(f, t === 600 || t === 900 ? 12 : t, ...a);
  const si = window.setInterval.bind(window);
  window.setInterval = (f, t, ...a) => si(f, t < 200 ? 4 : t, ...a);
};

const boardSig = (p) => p.evaluate(() => [...document.querySelectorAll('#board .sc-sq')].filter((x) => x.dataset.p !== '0').map((x) => `${x.dataset.sq}:${x.dataset.p}`).sort().join(','));
const boardTop = (p) => p.evaluate(() => { const r = document.querySelector('#board').getBoundingClientRect(); return Math.round((r.top + window.scrollY) * 10) / 10; });
const scoreLine = (p) => p.evaluate(() => [...document.querySelectorAll('.sc-pl')].map((x) => `${x.querySelector('.sc-n b').textContent.replace(' (du)', '')} ${x.querySelector('.sc-p b').textContent}`).sort().join(', '));
const flipped = (p) => p.evaluate(() => document.querySelector('.sc-ranks span').textContent === '1');
const sqSel = (n) => `#board .sc-sq[data-sq="${n}"]`;

// Ein Zug der Person an der Seite p (zufällig); bei Umwandlung wird eine Figur gewählt
async function humanMove(p, pick = {}) {
  const can = p.locator('button.sc-sq.can');
  const n = await can.count();
  check(n > 0, 'keine ziehbaren Figuren');
  await can.nth(Math.floor(Math.random() * n)).click();
  const tg = p.locator('button.sc-sq.tgt');
  const tn = await tg.count();
  check(tn > 0, 'nach Auswahl müssen Zielfelder markiert sein');
  check((await p.locator('button.sc-sq.sel').count()) === 1, 'ausgewählte Figur markiert');
  await tg.nth(Math.floor(Math.random() * tn)).click();
  if (await p.locator('[data-act=promo]').count()) {
    check((await p.locator('[data-act=promo]').count()) === 4, 'vier Umwandlungs-Knöpfe');
    await p.locator(`[data-act=promo]${pick.promo ? `[data-p=${pick.promo}]` : ''}`).first().click();
  }
}
const moveByClick = async (p, from, to, promo) => {
  await p.click(sqSel(from)); await p.click(sqSel(to));
  if (promo) await p.click(`[data-act=promo][data-p=${promo}]`);
};

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', PORT], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 900));
  const b = await chromium.launch();
  const errors = [];
  const hook = (pg, n = '') => {
    pg.on('pageerror', (e) => errors.push(n + e.message));
    pg.on('console', (m) => m.type() === 'error' && errors.push(n + 'console: ' + m.text()));
  };
  const base = `http://localhost:${PORT}/schach/index.html`;
  const fresh = async (ctx, name, query = '', hookName = '') => {
    const p = await ctx.newPage(); hook(p, hookName);
    await p.goto(base + query);
    await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await p.goto(base + query);
    await p.fill('#name', name);
    return p;
  };
  try {
    // ================= (a) gegen den Computer (Leicht), Zugdeckel 40 =================
    {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(speedUp);
      const p = await fresh(ctx, 'Gerda', '?maxply=40', 'a: ');
      check((await p.locator('[data-act=bot]').count()) === 2, 'zwei Computer-Knöpfe');
      check((await p.locator('[data-opt=hints]').count()) === 1 && await p.isChecked('[data-opt=hints]'), 'Option "Mögliche Felder anzeigen" Standard an');
      check(/Mögliche Felder anzeigen/.test(await p.textContent('.optcard')), 'Beschriftung der Option');
      await shot(p, 'start');
      await p.click('[data-act=bot][data-level="0"]');
      await p.waitForSelector('#board');
      check(/Gegen den Computer/.test(await p.textContent('.room')), 'Kopfzeile Computer');
      // Startaufstellung
      check((await p.locator('#board svg.sc-pc').count()) === 32, '32 Figuren');
      check((await p.locator('#board svg.sc-pc.w').count()) === 16, '16 weiße Figuren');
      check((await p.locator('button.sc-sq.can').count()) === 10, '10 leuchtende Figuren (8 Bauern, 2 Springer)');
      check((await p.textContent('.sc-files')).replace(/\s/g, '') === 'abcdefgh', 'Spaltenbeschriftung');
      check((await p.textContent('.sc-ranks')).replace(/\s/g, '') === '87654321', 'Reihenbeschriftung');
      check(/Du bist dran! \(Weiß\)/.test(await p.textContent('.banner')), 'Banner');
      check(/Weiß beginnt/.test(await p.textContent('.sc-last')), 'Weiß beginnt');
      check(/geschlagen/.test(await p.textContent('.sc-capcard')), 'Reihe geschlagen');
      await shot(p, 'a-start');
      // Auswahl: Springer b1 -> Ziele a3, c3 mit Rahmen und Punkt; Abwählen
      await p.click(sqSel('b1'));
      const t1 = await p.$$eval('button.sc-sq.tgt', (els) => els.map((e) => e.dataset.sq).sort());
      check(t1.join() === 'a3,c3', 'Zielfelder des Springers: ' + t1.join());
      await shot(p, 'a-auswahl');
      await p.click(sqSel('b1'));
      check((await p.locator('button.sc-sq.tgt').count()) === 0, 'abgewählt');
      // Unerlaubter Zug mit freundlichem Hinweis
      await p.click(sqSel('b1')); await p.click(sqSel('e5'));
      check(/Dieser Zug ist nicht erlaubt/.test(await p.textContent('.sc-msg')), 'Hinweis bei unerlaubtem Ziel');
      await shot(p, 'a-unerlaubt');
      await p.click(sqSel('b1'));
      // eigener Zug, Computer antwortet
      await moveByClick(p, 'e2', 'e4');
      await p.waitForSelector('.banner.mine', { timeout: 8000 });
      await p.waitForFunction(() => /Schwarz (zieht|schlägt)/.test((document.querySelector('.sc-last') || {}).textContent || ''), null, { timeout: 8000 });
      check((await p.locator('.sc-sq.from').count()) === 1 && (await p.locator('.sc-sq.to').count()) === 1, 'letzter Zug markiert');
      check((await p.locator('#board svg.sc-pc').count()) === 32, 'noch 32 Figuren');
      // Zugliste einklappbar
      check((await p.locator('.sc-log').count()) === 0, 'Zugliste anfangs eingeklappt');
      await p.click('[data-act=movelist]');
      const logItems = await p.$$eval('.sc-log li', (els) => els.map((e) => e.textContent));
      check(logItems.length === 2 && /Weiß: Bauer nach e4/.test(logItems[1]), 'Zugliste: ' + logItems.join(' | '));
      await shot(p, 'a-zugliste');
      await p.click('[data-act=movelist]');
      // Partie bis zum Ende
      const tops = []; let plies = 1; const t0 = Date.now();
      while (Date.now() - t0 < 150000) {
        await p.waitForSelector('.banner.mine, .trophy', { timeout: 8000 });
        if (await p.locator('.trophy').count()) break;
        tops.push(await boardTop(p));
        await humanMove(p);
        plies++;
        await p.waitForTimeout(15);
      }
      check(await p.locator('.trophy').count(), 'Partie endet');
      tops.push(await boardTop(p));
      const head = (await p.textContent('h1')).trim();
      console.log(`(a) ${plies} eigene Züge, Ende: ${head} | ${(await p.textContent('.sc-last')).trim()}`);
      check(Math.max(...tops) - Math.min(...tops) < 1.5, 'Brett springt: ' + [...new Set(tops)].join(','));
      await shot(p, 'a-ende');
      const sc = await scoreLine(p);
      check(/^Computer \d, Gerda \d$/.test(sc) && /[12]/.test(sc), 'Punktestand nach Runde 1: ' + sc);
      check((await p.locator('[data-act=next]').count()) === 1 && (await p.locator('[data-act=leave-now]').count()) === 1, 'Noch eine Runde / Spiel beenden');
      await p.click('[data-act=next]');
      await p.waitForSelector('#board'); await p.waitForTimeout(100);
      check(/Runde 2/.test(await p.textContent('.sc-round')), 'Runde 2');
      check((await scoreLine(p)) === sc, 'Punktestand bleibt');
      check((await p.textContent('.sc-ranks')).replace(/\s/g, '') === '12345678', 'Brett gedreht (Gerda hat jetzt Schwarz)');
      await p.waitForSelector('.banner.mine', { timeout: 8000 });
      check(/Du bist dran! \(Schwarz\)/.test(await p.textContent('.banner')), 'Banner Schwarz');
      check(/Weiß (zieht|rochiert)/.test(await p.textContent('.sc-last')), 'Computer hat als Weiß gezogen');
      await shot(p, 'a-runde2');
      await humanMove(p);
      await p.click('[data-act=help]'); await shot(p, 'hilfe', false); await p.click('.modal [data-act=help-close]');
      await ctx.close();
    }

    // ================= (a2) ohne Hilfe-Markierung + Hinweis bei Schach =================
    {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(speedUp);
      const p = await fresh(ctx, 'Gerda', '?fen=' + encodeURIComponent('3rk3/8/8/8/8/8/8/4K3 w - - 0 1'), 'a2: ');
      await p.uncheck('[data-opt=hints]');
      await p.click('[data-act=bot][data-level="0"]');
      await p.waitForSelector('#board');
      check((await p.locator('button.sc-sq.can').count()) === 0, 'ohne Haken leuchtet nichts');
      check(/Mögliche Felder anzeigen: aus/.test(await p.textContent('.sc-rules')), 'Regelzeile zeigt aus');
      await p.click(sqSel('e1'));
      check((await p.locator('button.sc-sq.sel').count()) === 1 && (await p.locator('button.sc-sq.tgt').count()) === 0, 'nur die gewählte Figur markiert');
      await p.click(sqSel('d1'));
      const msg = await p.textContent('.sc-msg');
      check(/Dieser Zug ist nicht erlaubt/.test(msg) && /König stünde im Schach/.test(msg), 'Begründung Schach: ' + msg);
      await shot(p, 'a2-nicht-erlaubt');
      await p.click(sqSel('f1'));
      await p.waitForFunction(() => (document.querySelector('#board [data-sq=f1]') || {}).dataset.p === '6', null, { timeout: 5000 });
      await ctx.close();
    }

    // ================= (b) Matt in 1 per ?fen= =================
    {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(speedUp);
      const p = await fresh(ctx, 'Gerda', '?fen=' + encodeURIComponent('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1'), 'b: ');
      await p.click('[data-act=bot][data-level="1"]');
      await p.waitForSelector('#board');
      await moveByClick(p, 'a1', 'a8');
      await p.waitForSelector('.trophy');
      check(/Schachmatt! Du hast gewonnen/.test(await p.textContent('h1')), 'Matt-Banner');
      check((await scoreLine(p)) === 'Computer 0, Gerda 2', 'Sieg = 2 Punkte: ' + await scoreLine(p));
      check(/Schachmatt/.test(await p.textContent('.sc-last')), 'Ergebnistext');
      check((await p.locator('.sc-sq.chk').count()) === 0, 'nach Spielende keine Schach-Markierung');
      await shot(p, 'b-matt');
      // Konfetti-Leinwand wurde gezeichnet (Sieg)
      await ctx.close();
    }

    // ================= (c) Gastgeber + Gast (Test-Netz): Rochade, Umwandlung, Schach =================
    {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(speedUp);
      const A = await ctx.newPage(); const B = await ctx.newPage();
      hook(A, 'A: '); hook(B, 'B: ');
      const U = base + '?mock=1&fen=' + encodeURIComponent('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
      await A.goto(U); await A.fill('#name', 'Gerda');
      await A.click('[data-act=host]'); await A.waitForSelector('.code');
      const code = (await A.textContent('.code')).trim();
      await B.goto(base + '?mock=1&raum=' + code); await B.fill('#name', 'Heinz'); await B.click('[data-act=join-invited]');
      await A.waitForSelector('[data-act=start]'); await A.click('[data-act=start]');
      await A.waitForSelector('#board'); await B.waitForSelector('#board');
      const same = async (tag) => { check((await boardSig(A)) === (await boardSig(B)), 'Zustände verschieden ' + tag); check((await scoreLine(A)) === (await scoreLine(B)), 'Punkte verschieden'); };
      check((await A.textContent('.sc-ranks')).replace(/\s/g, '') === '87654321', 'A: Weiß unten');
      check((await B.textContent('.sc-ranks')).replace(/\s/g, '') === '12345678', 'B: Schwarz unten');
      check((await A.locator('button.sc-sq.can').count()) > 0 && (await B.locator('button.sc-sq.can').count()) === 0, 'nur Weiß darf ziehen');
      check((await B.locator('button.sc-sq.mine').count()) === 0, 'Schwarz hat jetzt keine bedienbaren Felder');
      await same('start');
      // Rochade: König antippen, Zielfeld g1 zeigt das Turm-Zeichen
      await A.click(sqSel('e1'));
      check((await A.locator('button.sc-sq.tgt.rk[data-sq=g1] svg.sc-rkicon').count()) === 1, 'Rochade-Zielfeld g1 mit Turm-Symbol');
      check((await A.locator('button.sc-sq.tgt.rk[data-sq=c1] svg.sc-rkicon').count()) === 1, 'Rochade-Zielfeld c1 mit Turm-Symbol');
      await shot(A, 'c-rochade-ziele');
      await A.click(sqSel('g1'));
      await B.waitForSelector('.banner.mine');
      check(/Weiß rochiert kurz/.test(await B.textContent('.sc-last')) && /Weiß rochiert kurz/.test(await A.textContent('.sc-last')), 'Text Rochade');
      check((await A.locator(sqSel('g1')).getAttribute('data-p')) === '6' && (await A.locator(sqSel('f1')).getAttribute('data-p')) === '4', 'König g1, Turm f1');
      await same('nach Rochade');
      // Schwarz rochiert lang
      await B.click(sqSel('e8')); await B.click(sqSel('c8'));
      await A.waitForSelector('.banner.mine');
      check((await B.locator(sqSel('c8')).getAttribute('data-p')) === '12' && (await B.locator(sqSel('d8')).getAttribute('data-p')) === '10', 'Schwarz: König c8, Turm d8');
      await same('nach langer Rochade');
      await shot(A, 'c-host-nach-rochade'); await shot(B, 'c-gast-nach-rochade');
      // einige Züge
      for (let i = 0; i < 6; i++) {
        const mover = (await A.locator('.banner.mine').count()) ? A : B;
        await humanMove(mover);
        await (mover === A ? B : A).waitForFunction(() => document.querySelector('.banner.mine') || document.querySelector('.trophy'), null, { timeout: 5000 });
        await A.waitForTimeout(30);
        await same('Zug ' + i);
        if (await A.locator('.trophy').count()) break;
      }
      check((await A.locator('[data-act=next]').count()) + (await B.locator('[data-act=next]').count()) <= 1, 'höchstens Host sieht Noch eine Runde');
      await ctx.close();
    }
    {
      // Umwandlung und Schach über das Netz
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(speedUp);
      const A = await ctx.newPage(); const B = await ctx.newPage();
      hook(A, 'A2: '); hook(B, 'B2: ');
      const U = base + '?mock=1&fen=' + encodeURIComponent('7k/4P3/8/8/8/8/8/K7 w - - 0 1');
      await A.goto(U); await A.fill('#name', 'Gerda');
      await A.click('[data-act=host]'); await A.waitForSelector('.code');
      const code = (await A.textContent('.code')).trim();
      await B.goto(base + '?mock=1&raum=' + code); await B.fill('#name', 'Heinz'); await B.click('[data-act=join-invited]');
      await A.waitForSelector('[data-act=start]'); await A.click('[data-act=start]');
      await A.waitForSelector('#board'); await B.waitForSelector('#board');
      await A.click(sqSel('e7'));
      check((await A.locator('button.sc-sq.tgt.prx[data-sq=e8]').count()) === 1, 'Umwandlungsfeld markiert');
      await A.click(sqSel('e8'));
      await A.waitForSelector('[data-act=promo]');
      const labels = await A.$$eval('[data-act=promo]', (els) => els.map((e) => e.textContent.trim()));
      check(labels.join() === 'Dame,Turm,Läufer,Springer', 'Auswahl: ' + labels.join());
      const bb = await A.$$eval('[data-act=promo]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
      check(Math.min(...bb) >= 48, 'Umwandlungs-Knöpfe >= 48 px: ' + Math.min(...bb));
      await shot(A, 'c-umwandlung');
      check((await A.locator(sqSel('e7')).getAttribute('data-p')) === '1', 'Bauer noch nicht gezogen');
      await A.click('[data-act=promo-cancel]');
      check((await A.locator('[data-act=promo]').count()) === 0, 'Abbrechen schließt den Dialog');
      await A.click(sqSel('e8')); await A.click('[data-act=promo][data-p=q]');
      await B.waitForSelector('.banner.mine');
      check((await B.locator(sqSel('e8')).getAttribute('data-p')) === '5', 'Dame auf e8 (beim Gast)');
      check(/Schach!/.test(await B.textContent('.banner')) && /Schach!/.test(await A.textContent('.banner')), 'Banner Schach: ' + await B.textContent('.banner'));
      check((await B.locator('.sc-sq.chk[data-sq=h8]').count()) === 1, 'König im Schach markiert');
      check(/zur Dame/.test(await B.textContent('.sc-last')), 'Text Umwandlung: ' + await B.textContent('.sc-last'));
      check(/Schach/.test(await B.textContent('.sc-capcard')) === false, 'nichts geschlagen');
      await shot(B, 'c-gast-schach');
      await same2(A, B);
      await ctx.close();
    }

    // ================= (d) Lernrunde =================
    {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(speedUp);
      const p = await fresh(ctx, 'Gerda', '?maxply=40', 'd: ');
      await p.click('[data-act=learn]');
      await p.waitForSelector('.coach');
      check(/Mögliche Felder anzeigen: an/.test(await p.textContent('.sc-rules')), 'Lernrunde mit Hilfe an');
      const texts = []; let over = false, steps = 0, shots = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 150000 && steps < 200) {
        if (await p.locator('.trophy').count()) { over = true; break; }
        const snap = await p.evaluate(() => ({
          mine: !!document.querySelector('.banner.mine'),
          txt: (document.querySelector('.coach .coach-t') || { innerText: '' }).innerText.trim(),
          targets: document.querySelectorAll('.coach-target').length,
        }));
        if (snap.mine) {
          check(snap.targets > 0, 'Mensch dran, aber kein Ziel: ' + snap.txt);
          steps++;
          if (!texts.includes(snap.txt)) { texts.push(snap.txt); if (shots < 4) await p.screenshot({ path: `${SP}/schach-lern-${++shots}.png` }); }
          await humanMove(p);
          // nach dem Zug ändert sich der Text im selben Zug nicht mehr (Text vor dem Zug beibehalten)
        } else {
          if (/Noch eine Runde/.test(snap.txt)) continue; // Runde ist gerade zu Ende gegangen
          check(/Computer|Schach gesagt/.test(snap.txt), 'Computer-Text erwartet: ' + snap.txt);
          check(snap.targets === 0, 'Computer dran: kein Ziel');
          await p.waitForTimeout(25);
        }
      }
      check(over, 'Lernrunde kommt durch (Spielende erreicht)');
      const t = (await p.innerText('.coach .coach-t')).trim();
      check(/Noch eine Runde/.test(t), 'Ende-Text: ' + t);
      check((await p.locator('.coach-target[data-act=next]').count()) === 1, 'Ziel Noch eine Runde');
      await p.screenshot({ path: `${SP}/schach-lern-ende.png`, fullPage: true });
      const topics = texts.map((x) => x.replace(/^\S+\s/, '')).filter((x) => !/^(Jetzt ist der Computer|Du bist dran\.|Tippe auf ein markiertes|Du stehst im Schach|Wähle die neue|Du hast Schach gesagt)/.test(x) && !/Noch eine Runde/.test(x));
      console.log(`(d) Lernrunde: ${steps} Schritte, ${texts.length} verschiedene Texte, davon ${topics.length} Erklärungen`);
      for (const x of topics) console.log('    - ' + x);
      check(new Set(texts).size === texts.length, 'jeder Text wird nur in einem Zug gezeigt');
      check(topics.some((x) => /Das Brett hat 64 Felder/.test(x)) && topics.some((x) => /^Ziel: den gegnerischen/.test(x)), 'Brett und Ziel erklärt');
      check(topics.length >= 5, 'mehrere Erklärungen');
      await p.click('[data-act=next]');
      await p.waitForSelector('#board'); await p.waitForSelector('.coach');
      await p.click('[data-act=learn-stop]');
      check((await p.locator('.coach').count()) === 0, '.coach verschwindet');
      await ctx.close();
    }

    // ================= (e) Layout 390x844 =================
    {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(speedUp);
      const p = await fresh(ctx, 'Gerda', '?fen=' + encodeURIComponent('r3k2r/pPpppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1'), 'e: ');
      const noHScroll = async (tag) => check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth), 'horizontaler Seitenscroll ' + tag);
      await noHScroll('Start');
      await p.click('[data-act=bot][data-level="0"]');
      await p.waitForSelector('#board');
      const tops = [];
      await noHScroll('Spiel');
      tops.push(await boardTop(p));
      let minCell = 999;
      const sizes0 = await p.$$eval('.sc-sq', (els) => els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)));
      minCell = Math.min(...sizes0);
      // Umwandlung: b7 -> a8/c8 schlagen (Dialog), Brett bleibt an Ort und Stelle
      await p.click(sqSel('b7')); tops.push(await boardTop(p)); await noHScroll('Auswahl');
      await p.click(sqSel('a8')); await p.waitForSelector('[data-act=promo]');
      tops.push(await boardTop(p)); await noHScroll('Umwandlungsdialog');
      const btn = await p.$$eval('button[data-act], button.sc-sq', (els) => els.filter((e) => e.offsetParent && !e.closest('.topbtns')).map((e) => Math.min(e.getBoundingClientRect().height, e.getBoundingClientRect().width)));
      check(Math.min(...btn) >= 44, 'Tippziele >= 44 px: ' + Math.min(...btn));
      await shot(p, 'e-umwandlung');
      await p.click('[data-act=promo][data-p=n]');
      await p.waitForFunction(() => document.querySelector('.banner.mine'), null, { timeout: 8000 });
      tops.push(await boardTop(p)); await noHScroll('nach Zug');
      for (let i = 0; i < 8; i++) {
        await p.waitForSelector('.banner.mine, .trophy', { timeout: 8000 });
        if (await p.locator('.trophy').count()) break;
        tops.push(await boardTop(p));
        await humanMove(p, { promo: 'q' });
        await p.waitForTimeout(20);
        await noHScroll('Zug ' + i);
      }
      tops.push(await boardTop(p));
      console.log(`(e) kleinste Feldgröße ${minCell.toFixed(1)} px, Brett-Top-Werte: ${[...new Set(tops)].join(', ')}`);
      check(minCell >= 44, 'Felder >= 44 px: ' + minCell);
      check(Math.max(...tops) - Math.min(...tops) < 1.5, 'Brett springt: ' + [...new Set(tops)].join(','));
      const bb = await p.locator('#board').boundingBox();
      check(bb.x >= 0 && bb.x + bb.width <= 390.5, 'Brett passt in die Breite');
      await p.click('[data-act=bigger]');
      await noHScroll('große Schrift');
      await shot(p, 'e-gross');
      await p.click('[data-act=bigger]');
      await shot(p, 'e-normal');
      await p.setViewportSize({ width: 1280, height: 800 });
      await p.waitForTimeout(100);
      const bd = await p.locator('#board').boundingBox();
      console.log('(e) Desktop: Brett', Math.round(bd.width), 'x', Math.round(bd.height));
      await shot(p, 'e-desktop', false);
      await ctx.close();
    }
  } finally {
    await b.close();
    srv.kill();
  }
  console.log('errors', JSON.stringify(errors));
  if (errors.length) process.exit(1);
  console.log('ALLES OK');
})().catch((e) => { console.error('FAIL', e.stack); process.exit(1); });

async function same2(A, B) {
  const sig = (p) => p.evaluate(() => [...document.querySelectorAll('#board .sc-sq')].filter((x) => x.dataset.p !== '0').map((x) => `${x.dataset.sq}:${x.dataset.p}`).sort().join(','));
  if ((await sig(A)) !== (await sig(B))) throw new Error('Zustände verschieden');
}
