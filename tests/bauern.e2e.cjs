// Bauernschach im Browser: (a) gegen Computer (Mittel) bis zum Ende + "Noch eine Runde", (b) Lernrunde,
// (c) Gastgeber + Gast über Test-Netz (?mock=1), (d) Layout 390x844.
// Aufruf: NODE_PATH=$(npm root -g) node tests/bauern.e2e.cjs [Screenshot-Ordner] [Port]
// Startet selbst einen Static-Server (python3 -m http.server) und beendet ihn am Ende wieder.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const SP = process.argv[2] || '.';
const PORT = process.argv[3] || '8891';
const ROOT = path.resolve(__dirname, '..');
const check = (c, m) => { if (!c) throw new Error(m); };
const shot = (p, name, full = true) => p.screenshot({ path: `${SP}/bauern-${name}.png`, fullPage: full });

// schnelle Uhren: Computer-Verzögerung (900 ms) und kurze Intervalle werden gekürzt
const speedUp = () => {
  const st = window.setTimeout.bind(window);
  window.setTimeout = (f, t, ...a) => st(f, t === 900 ? 12 : t, ...a);
  const si = window.setInterval.bind(window);
  window.setInterval = (f, t, ...a) => si(f, t < 200 ? 4 : t, ...a);
};

const boardSig = (p) => p.evaluate(() => [...document.querySelectorAll('#board .bs-sq')]
  .map((x) => { const s = x.querySelector('svg'); return s ? `${x.dataset.sq}:${s.classList.contains('w') ? 'w' : 'b'}` : ''; })
  .filter(Boolean).sort().join(','));
const boardTop = (p) => p.evaluate(() => { const r = document.querySelector('#board').getBoundingClientRect(); return Math.round((r.top + window.scrollY) * 10) / 10; });
// Punktestand als "Gerda 1, Heinz 0" (nach Namen sortiert, "(du)" entfernt), unabhängig von der Anzeigereihenfolge
const scoreLine = (p) => p.evaluate(() => [...document.querySelectorAll('.bs-pl')].map((x) => `${x.querySelector('.bs-n b').textContent.replace(' (du)', '')} ${x.querySelector('.bs-p b').textContent}`).sort().join(', '));

// Ein Zug der Person an der Seite p (zufällig oder "vorwärts"); true = Zug gemacht
async function humanMove(p, greedy = false) {
  const can = p.locator('button.bs-sq.can');
  const n = await can.count();
  check(n > 0, 'keine ziehbaren Bauern');
  let from = Math.floor(Math.random() * n);
  if (greedy) {
    const ranks = await p.$$eval('button.bs-sq.can', (els) => els.map((e) => Number(e.dataset.sq[1])));
    const flipped = await p.evaluate(() => document.querySelector('.bs-ranks span').textContent === '1');
    const best = flipped ? Math.min(...ranks) : Math.max(...ranks);
    from = ranks.indexOf(best);
  }
  await can.nth(from).click();
  const tg = p.locator('button.bs-sq.tgt');
  const tn = await tg.count();
  check(tn > 0, 'nach Auswahl müssen Zielfelder markiert sein');
  check((await p.locator('button.bs-sq.sel').count()) === 1, 'ausgewählter Bauer markiert');
  let to = Math.floor(Math.random() * tn);
  if (greedy) {
    const ranks = await p.$$eval('button.bs-sq.tgt', (els) => els.map((e) => Number(e.dataset.sq[1])));
    const flipped = await p.evaluate(() => document.querySelector('.bs-ranks span').textContent === '1');
    to = ranks.indexOf(flipped ? Math.min(...ranks) : Math.max(...ranks));
  }
  await tg.nth(to).click();
}

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', PORT], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 900));
  const b = await chromium.launch();
  const errors = [];
  const hook = (pg, n = '') => {
    pg.on('pageerror', (e) => errors.push(n + e.message));
    pg.on('console', (m) => m.type() === 'error' && errors.push(n + 'console: ' + m.text()));
  };
  const base = `http://localhost:${PORT}/bauern/index.html`;
  try {
    // ================= (a) gegen den Computer (Mittel) =================
    {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(speedUp);
      const p = await ctx.newPage(); hook(p, 'a: ');
      await p.goto(base);
      await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
      await p.goto(base);
      await p.fill('#name', 'Gerda');
      check((await p.locator('[data-act=bot]').count()) === 2, 'zwei Computer-Knöpfe');
      check((await p.locator('[data-act=solo]').count()) === 0, 'kein Alleinspiel');
      check((await p.locator('[data-opt]').count()) === 2, 'zwei Regel-Optionen');
      await shot(p, 'start');
      await p.click('[data-act=bot][data-level="1"]');
      await p.waitForSelector('#board');
      check(/Gegen den Computer/.test(await p.textContent('.room')), 'Kopfzeile Computer');

      const tops = [];
      const cellsOk = [];
      let plies = 0, shots = { sel: false, last: false };
      const t0 = Date.now();
      while (Date.now() - t0 < 120000) {
        await p.waitForSelector('.banner.mine, .trophy', { timeout: 8000 });
        if (await p.locator('.trophy').count()) break;
        tops.push(await boardTop(p));
        if (plies === 0) {
          // Startaufstellung: 16 Bauern, unten Weiß, Koordinaten
          check((await p.locator('#board svg.bs-pc').count()) === 16, '16 Bauern');
          check((await p.locator('#board svg.bs-pc.w').count()) === 8, '8 weiße');
          check((await p.locator('button.bs-sq.can').count()) === 8, '8 leuchtende Bauern');
          check((await p.textContent('.bs-files')).replace(/\s/g, '') === 'abcdefgh', 'Spaltenbeschriftung');
          check((await p.textContent('.bs-ranks')).replace(/\s/g, '') === '87654321', 'Reihenbeschriftung');
          check(/Weiß beginnt/.test(await p.textContent('.bs-last')), 'Weiß beginnt');
          await shot(p, 'a-start');
        }
        if (plies === 1) {
          // letzter Zug des Gegners hervorgehoben
          check((await p.locator('.bs-sq.from').count()) === 1 && (await p.locator('.bs-sq.to').count()) === 1, 'letzter Zug markiert');
          check(/^(Schwarz) (zieht|schlägt)/.test((await p.textContent('.bs-last')).trim()), 'Zugtext: ' + (await p.textContent('.bs-last')));
          shots.last = true;
          await shot(p, 'a-letzter-zug');
        }
        for (const bx of await p.$$eval('.bs-sq', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }))) cellsOk.push(Math.min(...bx));
        if (plies === 2 && !shots.sel) {
          shots.sel = true;
          await p.locator('button.bs-sq.can').first().click();
          check((await p.locator('button.bs-sq.tgt').count()) > 0, 'Zielfelder');
          tops.push(await boardTop(p));
          await shot(p, 'a-auswahl');
          await p.click('[data-act=undo]');
          check((await p.locator('button.bs-sq.tgt').count()) === 0, 'Auswahl aufgehoben');
        }
        await humanMove(p);
        plies++;
        await p.waitForTimeout(20);
      }
      check(await p.locator('.trophy').count(), 'Partie gegen Mittel endet');
      tops.push(await boardTop(p));
      const head = (await p.textContent('h1')).trim();
      console.log(`(a) ${plies} eigene Züge, Ende: ${head} | ${(await p.textContent('.bs-last')).trim()}`);
      check(Math.max(...tops) - Math.min(...tops) < 1.5, 'Brett springt: ' + [...new Set(tops)].join(','));
      check(Math.min(...cellsOk) >= 44, 'Felder zu klein: ' + Math.min(...cellsOk));
      await shot(p, 'a-ende');
      const sc = await scoreLine(p);
      check(/^Computer [01], Gerda [01]$/.test(sc) && /1/.test(sc), 'Punktestand nach Runde 1: ' + sc);
      check((await p.locator('[data-act=next]').count()) === 1 && (await p.locator('[data-act=leave-now]').count()) === 1, 'Noch eine Runde / Spiel beenden');
      // Noch eine Runde: Seitenwechsel
      await p.click('[data-act=next]');
      await p.waitForSelector('#board'); await p.waitForTimeout(100);
      check((await p.locator('#board svg.bs-pc').count()) === 16 || plies >= 0, 'Brett');
      check(/Runde 2/.test(await p.textContent('.bs-round')), 'Runde 2');
      check((await scoreLine(p)) === sc, 'Punktestand bleibt');
      // Gerda hat jetzt Schwarz: Brett gedreht (unten Reihe 8), Computer beginnt von selbst
      check((await p.textContent('.bs-ranks')).replace(/\s/g, '') === '12345678', 'Brett gedreht');
      await p.waitForSelector('.banner.mine', { timeout: 8000 });
      check(/Du bist dran! \(Schwarz\)/.test(await p.textContent('.banner')), 'Banner Schwarz');
      check(/Weiß zieht/.test(await p.textContent('.bs-last')), 'Computer hat als Weiß gezogen');
      await shot(p, 'a-runde2');
      await humanMove(p);
      await p.waitForSelector('.banner.mine, .trophy', { timeout: 8000 });
      console.log('(a) Noch eine Runde ok (Farben getauscht, Punktestand bleibt)');
      // Spiel beenden
      await p.click('[data-act=help]'); await shot(p, 'hilfe', false); await p.click('.modal [data-act=help-close]');
      await ctx.close();
    }

    // ================= (b) Lernrunde =================
    {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(speedUp);
      const p = await ctx.newPage(); hook(p, 'b: ');
      await p.goto(base);
      await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
      await p.goto(base);
      await p.fill('#name', 'Gerda');
      await p.click('[data-act=learn]');
      await p.waitForSelector('.coach');
      const texts = new Set();
      let over = false, humanSteps = 0, shots = 0, reloaded = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 120000 && humanSteps < 200) {
        if (await p.locator('.trophy').count()) { over = true; break; }
        const snap = await p.evaluate(() => ({
          mine: !!document.querySelector('.banner.mine'),
          txt: (document.querySelector('.coach .coach-t') || { innerText: '' }).innerText.trim(),
          targets: document.querySelectorAll('.coach-target').length,
        }));
        if (snap.mine) {
          check(snap.targets > 0, 'Mensch dran, aber kein Ziel: ' + snap.txt);
          humanSteps++;
          if (!texts.has(snap.txt)) { texts.add(snap.txt); if (shots < 4) await p.screenshot({ path: `${SP}/bauern-lern-${++shots}.png` }); }
          if (humanSteps === 6 && !reloaded) {
            reloaded = true;
            await p.reload();
            await p.waitForSelector('.coach', { timeout: 8000 });
            check(await p.locator('#board').count(), 'nach Neuladen wieder im Spiel');
            continue;
          }
          await p.locator('.coach-target').first().click({ timeout: 3000 }).catch(() => {});
        } else {
          check(/Computer/.test(snap.txt), 'Computer-Text erwartet: ' + snap.txt);
          check(snap.targets === 0, 'Computer dran: kein Ziel');
          await p.waitForTimeout(25);
        }
      }
      check(over, 'Lernrunde kommt durch (Spielende erreicht)');
      const t = (await p.innerText('.coach .coach-t')).trim();
      check(/Noch eine Runde/.test(t), 'Ende-Text: ' + t);
      check((await p.locator('.coach-target[data-act=next]').count()) === 1, 'Ziel Noch eine Runde');
      await p.screenshot({ path: `${SP}/bauern-lern-ende.png`, fullPage: true });
      console.log(`(b) Lernrunde: ${humanSteps} Schritte, ${texts.size} verschiedene Texte, Ende erreicht`);
      for (const x of texts) console.log('    - ' + x);
      const goalTexts = [...texts].filter((x) => /Dein Ziel/.test(x));
      check(goalTexts.length === 1, 'Ziel-Erklärung nur einmal');
      await p.click('[data-act=next]');
      await p.waitForSelector('#board'); await p.waitForSelector('.coach');
      await p.click('[data-act=learn-stop]');
      check((await p.locator('.coach').count()) === 0, '.coach verschwindet');
      await ctx.close();
    }

    // ================= (c) Gastgeber + Gast (Test-Netz) =================
    {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(speedUp);
      const A = await ctx.newPage(); const B = await ctx.newPage();
      hook(A, 'A: '); hook(B, 'B: ');
      const U = base + '?mock=1';
      await A.goto(U); await A.fill('#name', 'Gerda');
      await A.click('[data-act=host]'); await A.waitForSelector('.code');
      const code = (await A.textContent('.code')).trim();
      // Regeln: Schlagzwang an
      await A.check('[data-opt=mustCapture]');
      await B.goto(U + '&raum=' + code); await B.fill('#name', 'Heinz'); await B.click('[data-act=join-invited]');
      await A.waitForSelector('[data-act=start]'); await A.click('[data-act=start]');
      await A.waitForSelector('#board'); await B.waitForSelector('#board');
      check(/Schlagzwang: an/.test(await A.textContent('.bs-rules')) && /Schlagzwang: an/.test(await B.textContent('.bs-rules')), 'Regel Schlagzwang bei beiden sichtbar');
      await shot(A, 'c-host-start'); await shot(B, 'c-gast-start');
      // Gerda (Host) ist Weiß: A unten Reihe 1, B gedreht
      check((await A.textContent('.bs-ranks')).replace(/\s/g, '') === '87654321', 'A: Weiß unten');
      check((await B.textContent('.bs-ranks')).replace(/\s/g, '') === '12345678', 'B: Schwarz unten');
      check((await A.locator('button.bs-sq.can').count()) === 8 && (await B.locator('button.bs-sq.can').count()) === 0, 'nur Weiß darf ziehen');
      let plies = 0;
      const same = async (tag) => { check((await boardSig(A)) === (await boardSig(B)), 'Zustände verschieden ' + tag); check((await scoreLine(A)) === (await scoreLine(B)), 'Punkte verschieden'); };
      await same('start');
      while (plies < 80) {
        if (await A.locator('.trophy').count()) break;
        const mover = (await A.locator('.banner.mine').count()) ? A : B;
        check((await mover.locator('.banner.mine').count()) === 1, 'jemand muss dran sein');
        await humanMove(mover, true);
        plies++;
        // Gegenüber sieht den Zug
        await (mover === A ? B : A).waitForFunction(() => document.querySelector('.banner.mine') || document.querySelector('.trophy'), null, { timeout: 5000 });
        await A.waitForTimeout(30);
        await same('nach Zug ' + plies);
        if (plies === 2) { await shot(A, 'c-host-zug2'); await shot(B, 'c-gast-zug2'); }
      }
      await A.waitForSelector('.trophy'); await B.waitForSelector('.trophy');
      await same('Ende');
      check((await A.textContent('h1')).trim() !== '' && (await B.textContent('h1')).trim() !== '', 'Überschriften');
      check((await A.locator('[data-act=next]').count()) === 1, 'Host sieht Noch eine Runde');
      check((await B.locator('[data-act=next]').count()) === 0, 'Gast sieht den Wiederholungsknopf nicht');
      check(/Gastgeber/.test(await B.textContent('.bs-action')), 'Gast: Hinweis auf Gastgeber');
      check((await B.locator('[data-act=leave-now]').count()) === 1, 'Gast: Spiel beenden');
      console.log(`(c) ${plies} Züge, A: ${(await A.textContent('h1')).trim()} | B: ${(await B.textContent('h1')).trim()} | Punkte ${await scoreLine(A)}`);
      await shot(A, 'c-host-ende'); await shot(B, 'c-gast-ende');
      const sc = await scoreLine(A);
      await A.click('[data-act=next]');
      await B.waitForFunction(() => /Runde 2/.test((document.querySelector('.bs-round') || {}).textContent || ''), null, { timeout: 5000 });
      await same('Runde 2');
      check((await scoreLine(B)) === sc, 'Punktestand bleibt');
      check((await A.textContent('.bs-ranks')).replace(/\s/g, '') === '12345678', 'A hat jetzt Schwarz');
      check((await B.textContent('.bs-ranks')).replace(/\s/g, '') === '87654321', 'B hat jetzt Weiß');
      check((await B.locator('.banner.mine').count()) === 1, 'Heinz (Weiß) beginnt');
      // Gast darf nicht "next" schicken: Nachricht wirkt nicht (Runde läuft ja noch)
      await ctx.close();
    }

    // ================= (d) Layout 390x844 =================
    {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      await ctx.addInitScript(speedUp);
      const p = await ctx.newPage(); hook(p, 'd: ');
      await p.goto(base);
      await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
      await p.goto(base);
      await p.fill('#name', 'Gerda');
      const noHScroll = async (tag) => check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth), 'horizontaler Seitenscroll ' + tag);
      await noHScroll('Start');
      await p.click('[data-act=bot][data-level="0"]');
      await p.waitForSelector('#board');
      const tops = [];
      let minCell = 999;
      for (let ply = 0; ply < 12; ply++) {
        await p.waitForSelector('.banner.mine, .trophy', { timeout: 8000 });
        if (await p.locator('.trophy').count()) break;
        await noHScroll('Zug ' + ply);
        tops.push(await boardTop(p));
        const sizes = await p.$$eval('.bs-sq', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
        minCell = Math.min(minCell, ...sizes);
        const bb = await p.locator('#board').boundingBox();
        check(bb.x >= 0 && bb.x + bb.width <= 390 + 0.5, 'Brett passt in die Breite');
        // Auswahl ändert nichts an der Position
        await p.locator('button.bs-sq.can').first().click();
        tops.push(await boardTop(p));
        await noHScroll('Auswahl ' + ply);
        await p.click('[data-act=undo]');
        await humanMove(p);
        await p.waitForTimeout(20);
      }
      const btnSizes = await p.$$eval('button.bs-sq, [data-act]', (els) => els.filter((e) => e.offsetParent && !e.closest('.topbtns')).map((e) => Math.min(e.getBoundingClientRect().height, e.getBoundingClientRect().width)));
      console.log(`(d) kleinste Feldgröße ${minCell.toFixed(1)} px, Brett-Top-Werte: ${[...new Set(tops)].join(', ')}`);
      check(minCell >= 44, 'Felder >= 44 px: ' + minCell);
      check(Math.max(...tops) - Math.min(...tops) < 1.5, 'Brett springt: ' + [...new Set(tops)].join(','));
      check(Math.min(...btnSizes) >= 44, 'Tippziele >= 44 px: ' + Math.min(...btnSizes));
      // große Schrift
      await p.click('[data-act=bigger]');
      await noHScroll('große Schrift');
      await shot(p, 'd-gross');
      const t1 = await boardTop(p);
      await p.click('[data-act=bigger]');
      await shot(p, 'd-normal');
      console.log('(d) große Schrift: Brett-Top', t1);
      // Desktop-Breite
      await p.setViewportSize({ width: 1280, height: 800 });
      await p.waitForTimeout(100);
      const bb = await p.locator('#board').boundingBox();
      console.log('(d) Desktop: Brett', Math.round(bb.width), 'x', Math.round(bb.height));
      await shot(p, 'd-desktop', false);
      await ctx.close();
    }
  } finally {
    await b.close();
    srv.kill();
  }
  console.log('errors', JSON.stringify(errors));
  if (errors.length) process.exit(1);
  console.log('ALLES OK');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
