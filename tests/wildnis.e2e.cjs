// Durchspieltest Wildnis-Mosaik im Browser.
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8871 &  dann  NODE_PATH=$(npm root -g) node tests/wildnis.e2e.cjs
//   (a) allein gegen Computer (Mittel) bis zur Endabrechnung mit Naturmarker-Aktionen + (e) Layout 390x844,
//   (b) Lernrunde, (c) Gastgeber + Gast über Mock-Netz, (d) Solo-Partie
const { chromium } = require('playwright');
const path = require('path');
const PORT = process.env.PORT || 8871;
const URL0 = `http://localhost:${PORT}/wildnis/index.html`;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
const errors = [];
const fail = (m) => { console.log('FEHLER:', m); errors.push(m); };
const check = (c, m) => { if (!c) fail(m); };
const rint = (n) => Math.floor(Math.random() * n);
const shot = (p, n, full = false) => p.screenshot({ path: path.join(SHOTS, `wn-e2e-${n}.png`), fullPage: full });

function watch(p, n) {
  p.on('pageerror', (e) => fail(`${n} pageerror ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') fail(`${n} console ${m.text()}`); });
}
const fast = (ctx) => ctx.addInitScript(() => {
  const st = window.setTimeout.bind(window);
  window.setTimeout = (f, t, ...a) => st(f, t >= 700 && t <= 1000 ? 5 : t, ...a);
});
const mine = async (p) => /^\s*Du bist dran/.test(await p.locator('.banner').first().innerText().catch(() => ''));
const isOver = async (p) => (await p.locator('.wn-over').count()) > 0;
const tiles = (p) => p.evaluate(() => document.querySelectorAll('#board svg > g[transform]').length);

// Ein Teilzug des Menschen; gibt 'choose' | 'tile' | 'token' | null
async function step(p, stats = {}) {
  const ph = await p.evaluate(() => (document.querySelector('[data-act=rot]') ? 'tile' : document.querySelector('[data-act=discard]') ? 'token'
    : document.querySelector('.wn-mt:not([disabled]), .wn-mk:not([disabled])') ? 'choose' : ''));
  const inc = (k) => { stats[k] = (stats[k] || 0) + 1; };
  if (ph === 'choose') {
    const has = (s) => p.locator(s).count();
    const want = (k, pr) => (Math.random() < pr || !stats[k]);
    if ((await has('[data-act=free-mode]')) && want('free', 0.15)) {
      await p.click('[data-act=free-mode]');
      check(/freie Wahl/.test(await p.locator('.banner').innerText()), 'Banner freie Wahl');
      const ens = await p.evaluate(() => [...document.querySelectorAll('.wn-mt:not([disabled])')].map((b) => Number(b.dataset.i)));
      const eks = await p.evaluate(() => [...document.querySelectorAll('.wn-mk:not([disabled])')].map((b) => Number(b.dataset.i)));
      const ti = ens[rint(ens.length)];
      const mis = eks.filter((m) => m !== ti);
      // zuerst absichtlich dasselbe Paar: Hinweis, kein Zug
      await p.click(`.wn-mt[data-i="${ti}"]`);
      if (eks.includes(ti)) { await p.click(`.wn-mk[data-i="${ti}"]`); check(await p.locator('.wn-note').count() > 0, 'Hinweis bei normalem Paar in freier Wahl'); }
      await p.click(`.wn-mk[data-i="${mis[rint(mis.length)]}"]`);
      inc('free');
      return 'choose';
    }
    if ((await has('[data-act=wipe-mode]')) && want('wipe', 0.15)) {
      await p.click('[data-act=wipe-mode]');
      check(await p.locator('[data-act=wipe-done][disabled]').count() === 1, 'Fertig erst nach Auswahl');
      const eks = await p.evaluate(() => [...document.querySelectorAll('.wn-mk:not([disabled])')].map((b) => Number(b.dataset.i)));
      for (const i of eks.slice(0, 2)) await p.click(`.wn-mk[data-i="${i}"]`);
      check(await p.locator('.wn-col.wsel').count() === Math.min(2, eks.length), 'Auswahl markiert');
      await p.click('[data-act=wipe-done]');
      inc('wipe');
      return 'choose';
    }
    if ((await has('[data-act=wipe3]')) && Math.random() < 0.5) { await p.click('[data-act=wipe3]'); inc('wipe3'); return 'choose'; }
    const i = await p.evaluate(() => { const c = [...document.querySelectorAll('.wn-mt:not([disabled])')].map((b) => b.dataset.i).filter((i) => document.querySelector(`.wn-mk[data-i="${i}"]:not([disabled])`)); return c.length ? c[Math.floor(Math.random() * c.length)] : null; });
    if (i === null) return null;
    await p.click(`.wn-${Math.random() < 0.5 ? 'mt' : 'mk'}[data-i="${i}"]`, { timeout: 4000 });
    return 'choose';
  }
  if (ph === 'tile') {
    const k = rint(4);
    for (let j = 0; j < k; j++) { await p.click('[data-act=rot]'); inc('rot'); }
    const cells = p.locator('[data-act=cell]');
    const n = await cells.count();
    if (!n) return null;
    const c = cells.nth(rint(n));
    await c.click({ timeout: 4000 }).catch(async () => { await c.dispatchEvent('click'); inc('cellDispatch'); });
    return 'tile';
  }
  if (ph === 'token') {
    const tk = p.locator('g[data-act=tok]');
    const n = await tk.count();
    const keyIdx = await p.evaluate(() => [...document.querySelectorAll('g[data-act=tok]')].map((g, i) => ({ i, t: g.getAttribute('transform') })).filter((o) => [...document.querySelectorAll('#board svg > g[transform]')].some((x) => x.getAttribute('transform') === o.t && /Schlüsselplättchen/.test((x.querySelector('title')?.textContent || '')))).map((o) => o.i));
    if (n && keyIdx.length && Math.random() < 0.85) { await tk.nth(keyIdx[0]).click({ timeout: 4000 }).catch(async () => { await tk.nth(keyIdx[0]).dispatchEvent('click'); }); inc('tokKey'); }
    else if (n && Math.random() > 0.2) { await tk.nth(rint(n)).click({ timeout: 4000 }).catch(async () => { await tk.nth(0).dispatchEvent('click'); inc('tokDispatch'); }); inc('tok'); }
    else { await p.click('[data-act=discard]'); inc('discard'); }
    return 'token';
  }
  return null;
}

async function playToEnd(p, limitMs, stats) {
  const t0 = Date.now();
  while (Date.now() - t0 < limitMs) {
    if (await isOver(p)) return true;
    if (await mine(p)) { await step(p, stats).catch((e) => fail('Zug: ' + e.message.split('\n')[0])); await p.waitForTimeout(12); } else await p.waitForTimeout(40);
  }
  return false;
}

(async () => {
  const browser = await chromium.launch();

  // ---------- (a) allein gegen 1 Computer (Mittel) + (e) Layout ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await fast(ctx);
    const p = await ctx.newPage(); watch(p, 'A');
    await p.goto(URL0);
    await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await p.goto(URL0);
    await p.fill('#name', 'Gerda');
    await shot(p, 'start', true);
    check(await p.locator('[data-act=bot]').count() === 6, 'sechs Computer-Knöpfe (1-3 x Leicht/Mittel)');
    check(await p.locator('[data-act=solo]').count() === 1, 'Allein-spielen-Knopf');
    check(await p.locator('[data-act=learn]').count() === 1, 'Lernrunde-Knopf');
    await p.click('[data-act=help]');
    const help = await p.locator('.modal').innerText();
    check(/Wildnis-Mosaik/.test(help) && /Naturmarker/.test(help) && /27 Punkte/.test(help) && /höchstens 4 Punkte/.test(help), 'Hilfetext');
    await shot(p, 'help');
    await p.click('.modal [data-act=help-close]');
    await p.fill('#name', 'Gerda');
    await p.click('[data-act=bot][data-n="1"][data-level="1"]');
    await p.waitForSelector('#board');
    check(await tiles(p) === 3, 'Start mit 3 Plättchen');
    const stats = {};
    const lay = [];
    const measure = async () => p.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top + scrollY), Math.round(b.width), Math.round(b.height)]; };
      const small = [...document.querySelectorAll('#app .btn:not([disabled]), #app .wn-mt:not([disabled]), #app .wn-mk:not([disabled]), #app summary')].filter((b) => b.offsetParent && !b.closest('.topbtns') && (b.getBoundingClientRect().height < 48 || b.getBoundingClientRect().width < 48)).map((b) => (b.textContent.trim() || b.className) + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height));
      return { market: r('#market'), act: r('.wn-act'), board: r('#board'), banner: r('.banner'), hscroll: document.documentElement.scrollWidth > innerWidth + 1, small, ph: document.querySelector('[data-act=rot]') ? 'tile' : document.querySelector('[data-act=discard]') ? 'token' : 'choose' };
    });
    let n = 0, over = false, shots = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 170000) {
      if (await isOver(p)) { over = true; break; }
      if (await mine(p)) {
        if (n % 3 === 0 || n < 3) { const m = await measure(); lay.push(m); if (shots < 3 && m.ph === 'choose' && n === 0) { await shot(p, 'play-choose'); shots++; } }
        const ph = await step(p, stats).catch((e) => { fail('Zug: ' + e.message.split('\n')[0]); return null; });
        if (ph === 'choose') {
          await p.waitForTimeout(25);
          if (await p.locator('[data-act=rot]').count()) {
            const m = await measure(); lay.push(m);
            if (!stats.shotTile) { stats.shotTile = 1; await shot(p, 'play-tile'); }
            await step(p, stats).catch((e) => fail('Zug2: ' + e.message.split('\n')[0]));
            await p.waitForTimeout(25);
            if (await p.locator('[data-act=discard]').count()) {
              const m2 = await measure(); lay.push(m2);
              if (!stats.shotTok) { stats.shotTok = 1; await shot(p, 'play-token'); }
              await step(p, stats).catch((e) => fail('Zug3: ' + e.message.split('\n')[0]));
            }
          }
          n++;
        }
        await p.waitForTimeout(15);
      } else await p.waitForTimeout(40);
    }
    check(over, 'Partie bis zur Endabrechnung (Zeitlimit)');
    if (over) {
      await p.waitForSelector('.trophy');
      const h1 = (await p.locator('.wn-over h1').innerText()).replace(/\n/g, ' ');
      const rk = await p.locator('.ranking li').count();
      const sums = await p.locator('table.wn-tab tr.sum td').allInnerTexts();
      const tabText = await p.locator('.wn-final').first().innerText();
      console.log('Ende:', h1, '| Rangliste Zeilen', rk, '| Summen', sums.join('/'), '| Teilzüge', JSON.stringify(stats), '| Plättchen', await tiles(p));
      check(rk === 2, 'Rangliste 2 Zeilen');
      check(sums.length === 2, 'Abrechnung je Person');
      check(/Bär/.test(tabText) && /Hirsch/.test(tabText) && /Lachs/.test(tabText) && /Falke/.test(tabText) && /Fuchs/.test(tabText) && /Berg/.test(tabText) && /Fluss/.test(tabText) && /Bonus/.test(tabText) && /Natur/.test(tabText) && /Summe/.test(tabText), 'Abrechnungstabelle vollständig');
      const sc = await p.evaluate(() => JSON.parse(sessionStorage.getItem('zh.wn.hostState') || localStorage.getItem('zh.wn.hostState') || 'null'));
      check(sc && sc.game && sc.game.phase === 'over' && sc.game.players.every((q) => q.turns === 20), '20 Züge je Person');
      check(await p.locator('[data-act=again]').count() === 1, 'Neustart-Knopf');
      check(!/\bPunkte\b.*Zug/.test(''), 'ok');
      await p.waitForTimeout(600);
      await shot(p, 'over', true);
      await p.click('[data-act=again]');
      await p.waitForSelector('#board');
      check((await tiles(p)) === 3, 'Neues Spiel startet mit 3 Plättchen');
    }
    check((stats.free || 0) >= 1 && (stats.wipe || 0) >= 1, 'Naturmarker-Aktionen kamen vor: ' + JSON.stringify(stats));
    // Layout-Auswertung
    const uniq = (k) => new Set(lay.map((m) => m[k].join(',')));
    console.log('Layout: Messungen', lay.length, '| Markt-Boxen', uniq('market').size, '| Aktions-Boxen', uniq('act').size, '| Brett-Boxen', uniq('board').size, '| Banner-Boxen', uniq('banner').size);
    console.log('  Markt', [...uniq('market')][0], 'Aktion', [...uniq('act')][0], 'Brett', [...uniq('board')][0]);
    check(uniq('market').size === 1, 'Markt springt: ' + [...uniq('market')].join(' | '));
    check(uniq('act').size === 1, 'Aktionsfläche springt: ' + [...uniq('act')].join(' | '));
    check(uniq('board').size === 1, 'Brett springt: ' + [...uniq('board')].join(' | '));
    check(uniq('banner').size === 1, 'Banner springt');
    check(!lay.some((m) => m.hscroll), 'horizontaler Seiten-Scroll');
    const small = [...new Set(lay.flatMap((m) => m.small))];
    check(small.length === 0, 'Knöpfe unter 48px: ' + small.join(', '));
    await ctx.close();
  }

  // ---------- (b) Lernrunde ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await fast(ctx);
    const p = await ctx.newPage(); watch(p, 'L');
    await p.goto(URL0);
    await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await p.goto(URL0);
    await p.fill('#name', 'Gerda');
    await p.click('[data-act=learn]');
    await p.waitForSelector('.coach');
    const texts = new Set();
    let human = 0, shots = 0, over = false, reloaded = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      if (await p.locator('.trophy').count()) { over = true; break; }
      const snap = await p.evaluate(() => ({ mine: !!document.querySelector('.banner.mine'), txt: (document.querySelector('.coach .coach-t') || { innerText: '' }).innerText.trim(), targets: document.querySelectorAll('.coach-target').length }));
      if (snap.mine) {
        check(snap.targets > 0, 'Mensch dran, aber kein Ziel: ' + snap.txt);
        human++;
        if (!texts.has(snap.txt)) { texts.add(snap.txt); if (shots < 4) await shot(p, `lern-${++shots}`); }
        if (human === 7 && !reloaded) { reloaded = true; await p.reload(); await p.waitForSelector('.coach', { timeout: 8000 }); check(await p.locator('#board').count(), 'nach Neuladen wieder im Spiel'); continue; }
        await p.evaluate(() => {
          const q = (s) => document.querySelector(s);
          const t = q('[data-act=cell].coach-target') || q('[data-act=tok].coach-target') || q('[data-act=cell]') || q('[data-act=tok]') || q('.wn-mt:not([disabled])');
          if (t) t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await p.waitForTimeout(10);
      } else {
        check(/Computer/.test(snap.txt), 'Computer-Text: ' + snap.txt);
        await p.waitForTimeout(30);
      }
    }
    console.log('Lernrunde: Menschen-Schritte', human, 'Ende', over, 'verschiedene Texte', texts.size);
    check(human >= 40 && texts.size >= 12, 'Lernrunde kommt durch');
    check(over, 'Lernrunde bis zum Ende');
    if (over) {
      check(/zu Ende/.test(await p.innerText('.coach .coach-t')), 'Ende-Text');
      await shot(p, 'lern-ende', true);
    }
    await ctx.close();
  }

  // ---------- (c) Gastgeber + Gast über Mock ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const A = await ctx.newPage(); const B = await ctx.newPage();
    watch(A, 'H'); watch(B, 'G');
    const M = URL0 + '?mock=1';
    await A.goto(M);
    await A.fill('#name', 'Anna');
    await A.click('[data-act=host]');
    await A.waitForSelector('.code');
    const code = (await A.locator('.code').innerText()).trim();
    await B.goto(M + '&raum=' + code);
    await B.fill('#name', 'Ben');
    await B.click('[data-act=join-invited]');
    await A.waitForSelector('[data-act=start]');
    await A.click('[data-act=start]');
    await A.waitForSelector('#board'); await B.waitForSelector('#board');
    const cmp = async (what) => {
      await A.waitForTimeout(60);
      const sig = (p) => p.evaluate(() => ({ m: document.querySelector('#market').innerHTML.replace(/ disabled(="")?/g, '').replace(/× \d+ Naturmarker/, ''), z: document.querySelector('.wn-nat').innerText.split('\n').pop(), mini: [...document.querySelectorAll('.wn-mini-box')].length }));
      let a, b, same = false;
      for (let k = 0; k < 8 && !same; k++) { a = await sig(A); b = await sig(B); same = a.m === b.m && a.z === b.z; if (!same) await A.waitForTimeout(100); }
      check(same, 'Zustände gleich (' + what + ')');
    };
    let moves = 0;
    const stats = {};
    const t0 = Date.now();
    while (moves < 24 && Date.now() - t0 < 60000) {
      for (const p of [A, B]) if (await mine(p)) { const r = await step(p, stats).catch((e) => { fail('Mock-Zug: ' + e.message.split('\n')[0]); return null; }); if (r) moves++; await p.waitForTimeout(40); }
      await A.waitForTimeout(30);
      if (moves % 6 === 0) await cmp('Zug ' + moves);
    }
    await A.waitForTimeout(300);
    check(moves >= 24, 'Mock: Züge gespielt');
    await cmp('nach Zügen');
    check(await B.locator('[data-act=again]').count() === 0, 'Gast hat keinen Neustart');
    check((await A.locator('details.wn-oth').count()) === 1 && (await B.locator('details.wn-oth').count()) === 1, 'ein Mitspieler-Gebiet je Seite');
    check(/Ben/.test(await A.locator('details.wn-oth summary').innerText()) && /Anna/.test(await B.locator('details.wn-oth summary').innerText()), 'Namen der Mitspieler');
    await A.locator('details.wn-oth summary').click();
    await A.waitForTimeout(100);
    check(await A.locator('details.wn-oth .wn-scroll').count() === 1, 'Mitspieler-Gebiet lässt sich aufklappen');
    await shot(A, 'mock-host', true); await shot(B, 'mock-gast');
    const endT = Date.now();
    while (Date.now() - endT < 150000 && !((await isOver(A)) && (await isOver(B)))) {
      let acted = false;
      for (const p of [A, B]) if (!(await isOver(p)) && (await mine(p))) { await step(p, stats).catch((e) => fail('Mock-Zug: ' + e.message.split('\n')[0])); acted = true; await p.waitForTimeout(10); }
      if (!acted) await A.waitForTimeout(30);
    }
    check((await isOver(A)) && (await isOver(B)), 'Mock-Partie bis zum Ende');
    if (await isOver(B)) {
      check(await B.locator('[data-act=again]').count() === 0 && await A.locator('[data-act=again]').count() === 1, 'Neustart nur beim Gastgeber');
      const ta = await A.locator('.wn-final').allInnerTexts(), tb = await B.locator('.wn-final').allInnerTexts();
      check(JSON.stringify(ta).replace(/ \(du\)/g, '') === JSON.stringify(tb).replace(/ \(du\)/g, ''), 'Abrechnung bei Host und Gast gleich');
      const ra = await A.locator('.ranking').innerText(), rb = await B.locator('.ranking').innerText();
      check(ra.replace(/ \(du\)/g, '') === rb.replace(/ \(du\)/g, ''), 'Rangliste gleich');
      const ma = await A.locator('.wn-mini-box').evaluateAll((e) => e.map((x) => x.innerHTML)), mb = await B.locator('.wn-mini-box').evaluateAll((e) => e.map((x) => x.innerHTML));
      check(ma.length === 2 && JSON.stringify(ma) === JSON.stringify(mb), 'Gebiete am Ende identisch');
      console.log('Mock: Teilzüge', moves, '| Rangliste:', ra.replace(/\n+/g, ' | '));
      await shot(B, 'mock-gast-over', true);
    }
    await ctx.close();
  }

  // ---------- (d) Solo ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await fast(ctx);
    const p = await ctx.newPage(); watch(p, 'S');
    await p.goto(URL0);
    await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await p.goto(URL0);
    await p.fill('#name', 'Gerda');
    await p.click('[data-act=solo]');
    await p.waitForSelector('#board');
    check(await p.locator('details.wn-oth').count() === 0, 'Solo: keine Mitspieler-Gebiete');
    check(/Allein spielen/.test(await p.locator('header.top').innerText()), 'Solo: Kopfzeile');
    const stats = {};
    const ok = await playToEnd(p, 120000, stats);
    check(ok, 'Solo bis zum Ende');
    if (ok) {
      const h1 = await p.locator('.wn-over h1').innerText();
      check(/Geschafft|Bestleistung/.test(h1) && await p.locator('.ranking li').count() === 1, 'Solo-Ergebnis: ' + h1);
      check(/nur bei mehreren/.test(await p.locator('.wn-final').innerText()), 'Solo: kein Bonus erklärt');
      console.log('Solo:', h1.replace(/\n/g, ' '), JSON.stringify(stats));
      await shot(p, 'solo-over', true);
    }
    await ctx.close();
  }

  await browser.close();
  console.log(errors.length ? `FEHLER: ${errors.length}` : 'ALLES OK');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
