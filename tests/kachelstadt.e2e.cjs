// Durchspieltest Kachelstadt im Browser.
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8851 &  dann  NODE_PATH=$(npm root -g) node tests/kachelstadt.e2e.cjs
//   (a) allein gegen Computer (Mittel) bis zur Siegerehrung, (b) Lernrunde, (c) zwei Personen über Mock-Netz, (d) Layout 390x844
const { chromium } = require('playwright');
const path = require('path');
const PORT = process.env.PORT || 8851;
const URL0 = `http://localhost:${PORT}/kachelstadt/index.html`;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
const errors = [];
const fail = (m) => { console.log('FEHLER:', m); errors.push(m); };
const check = (c, m) => { if (!c) fail(m); };
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const shot = (p, n, full = false) => p.screenshot({ path: path.join(SHOTS, `ks-e2e-${n}.png`), fullPage: full });

function watch(p, n) {
  p.on('pageerror', (e) => fail(`${n} pageerror ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') fail(`${n} console ${m.text()}`); });
}
const fast = (ctx) => ctx.addInitScript(() => {
  const st = window.setTimeout.bind(window);
  window.setTimeout = (f, t, ...a) => st(f, t >= 700 && t <= 1000 ? 5 : t, ...a);
});
const mine = async (p) => /Du bist dran/.test(await p.locator('.banner').first().innerText().catch(() => ''));
const isOver = async (p) => (await p.locator('.ks-over').count()) > 0;
const tiles = (p) => p.evaluate(() => document.querySelectorAll('#board svg > g[transform] > rect[width="100"]').length);

// Ein Teilzug des Menschen (Plättchen oder Gefolgsmann); gibt 'place' | 'meeple' | null
async function step(p, stats = {}) {
  const phase = await p.evaluate(() => (document.querySelector('[data-act=cell]') ? 'place' : (document.querySelector('[data-act=mp-none]') ? 'meeple' : '')));
  if (phase === 'place') {
    if (Math.random() < 0.3 && (await p.locator('[data-act=rot]:not([disabled])').count())) { await p.click('[data-act=rot]'); stats.rot = (stats.rot || 0) + 1; }
    const alt = await p.locator('[data-act=cell][data-fit="0"]').count();
    const cells = p.locator(Math.random() < 0.25 && alt ? '[data-act=cell][data-fit="0"]' : '[data-act=cell]');
    const n = await cells.count();
    const c = cells.nth(Math.floor(Math.random() * n));
    const wasAlt = (await c.getAttribute('data-fit')) === '0';
    await c.click({ timeout: 4000 });
    if (wasAlt) { stats.alt = (stats.alt || 0) + 1; await p.waitForTimeout(30); if (!(await p.locator('.ks-hint').count()) && !(await isOver(p))) fail('Hinweis nach automatischer Drehung fehlt'); }
    return 'place';
  }
  if (phase === 'meeple') {
    const mk = p.locator('g[data-act=mp]');
    const n = await mk.count();
    if (n && Math.random() < 0.6) {
      if (Math.random() < 0.5) await mk.nth(Math.floor(Math.random() * n)).click({ timeout: 4000 });
      else await p.locator('button[data-act=mp]').nth(Math.floor(Math.random() * n)).click({ timeout: 4000 });
      stats.mp = (stats.mp || 0) + 1;
    } else await p.click('[data-act=mp-none]');
    return 'meeple';
  }
  return null;
}

async function playToEnd(p, limitMs, stats, other) {
  const t0 = Date.now();
  while (Date.now() - t0 < limitMs) {
    if (await isOver(p)) return true;
    if (await mine(p)) { await step(p, stats).catch((e) => fail('Zug: ' + e.message)); await p.waitForTimeout(15); } else await p.waitForTimeout(40);
  }
  return false;
}

(async () => {
  const browser = await chromium.launch();

  // ---------- (a) allein gegen 1 Computer (Mittel), (d) Layout ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await fast(ctx);
    const p = await ctx.newPage(); watch(p, 'A');
    await p.goto(URL0);
    await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await p.goto(URL0);
    await p.fill('#name', 'Gerda');
    await shot(p, 'start', true);
    check(await p.locator('[data-act=bot]').count() === 8, 'acht Computer-Knöpfe (1-4 x Leicht/Mittel)');
    await p.click('[data-act=help]');
    const help = await p.locator('.modal').innerText();
    check(/Ritter/.test(help) && /Kachelstadt/.test(help) && !/Carcassonne|Meeple/i.test(help), 'Hilfetext');
    await shot(p, 'help');
    await p.click('.modal [data-act=help-close]');
    await p.fill('#name', 'Gerda');
    await p.click('[data-act=bot][data-n="1"][data-level="1"]');
    await p.waitForSelector('#board');
    const stats = {};
    const lay = [];
    const measure = async () => p.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top + scrollY), Math.round(b.width), Math.round(b.height)]; };
      const small = [...document.querySelectorAll('#app .btn:not([disabled])')].filter((b) => b.offsetParent && !b.closest('.topbtns') && b.getBoundingClientRect().height < 48).map((b) => b.textContent.trim());
      return { prev: r('.ks-prev'), board: r('#board'), players: r('.ks-players'), banner: r('.banner'), hscroll: document.documentElement.scrollWidth > innerWidth + 1, small, ph: document.querySelector('[data-act=cell]') ? 'place' : (document.querySelector('[data-act=mp-none]') ? 'meeple' : '') };
    });
    let turn = 0;
    const t0 = Date.now();
    let over = false;
    while (Date.now() - t0 < 150000) {
      if (await isOver(p)) { over = true; break; }
      if (await mine(p)) {
        if (turn % 6 === 0) { const m = await measure(); lay.push(m); if (turn === 0) await shot(p, 'play-place'); }
        const ph = await step(p, stats).catch((e) => { fail('Zug: ' + e.message); return null; });
        if (ph === 'place') {
          await p.waitForTimeout(30);
          if (await p.locator('[data-act=mp-none]').count()) { const m = await measure(); lay.push(m); if (turn === 0) await shot(p, 'play-meeple'); }
          else turn++;
          const ph2 = await step(p, stats).catch((e) => { fail('Zug2: ' + e.message); return null; });
          turn++;
          if (!ph2) await p.waitForTimeout(20);
        }
        await p.waitForTimeout(15);
      } else await p.waitForTimeout(40);
    }
    check(over, 'Partie bis zur Siegerehrung (Zeitlimit)');
    if (over) {
      await p.waitForSelector('.trophy');
      const h1 = (await p.locator('.ks-over h1').innerText()).replace(/\n/g, ' ');
      const rk = await p.locator('.ranking li').count();
      console.log('Ende:', h1, '| Rangliste Zeilen', rk, '| Teilzüge', JSON.stringify(stats), '| Plättchen', await tiles(p));
      check(rk === 2, 'Rangliste 2 Zeilen');
      check(await p.locator('[data-act=again]').count() === 1, 'Neustart-Knopf');
      await p.waitForTimeout(600);
      await shot(p, 'over', true);
      await p.click('[data-act=again]');
      await p.waitForSelector('#board');
      check((await tiles(p)) === 1, 'Neues Spiel startet mit 1 Plättchen');
    }
    // Layout-Auswertung
    const prevs = new Set(lay.map((m) => m.prev.join(',')));
    const boards = new Set(lay.map((m) => m.board.join(',')));
    const banners = new Set(lay.map((m) => m.banner.join(',')));
    const plPlace = new Set(lay.filter((m) => m.ph === 'place').map((m) => m.players.join(',')));
    const plAll = new Set(lay.map((m) => m.players.join(',')));
    console.log('Layout: Messungen', lay.length, '| Vorschau-Boxen', prevs.size, '| Brett-Boxen', boards.size, '| Banner-Boxen', banners.size, '| Punktetafel (Plättchen-Phase)', plPlace.size, '| Punktetafel (alle)', plAll.size);
    console.log('  Vorschau', [...prevs][0], 'Brett', [...boards][0], 'Punkte', [...plPlace][0]);
    check(prevs.size === 1, 'Vorschau springt: ' + [...prevs].join(' | '));
    check(boards.size === 1, 'Brett springt: ' + [...boards].join(' | '));
    check(banners.size === 1, 'Banner springt');
    check(plPlace.size === 1, 'Punktetafel springt (Plättchen-Phase): ' + [...plPlace].join(' | '));
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
        if (!texts.has(snap.txt)) { texts.add(snap.txt); if (shots < 6) await shot(p, `lern-${++shots}`); }
        if (human === 6 && !reloaded) { reloaded = true; await p.reload(); await p.waitForSelector('.coach', { timeout: 8000 }); check(await p.locator('#board').count(), 'nach Neuladen wieder im Spiel'); continue; }
        await p.evaluate(() => (document.querySelector('.coach-target:not([data-act=rot])') || document.querySelector('.coach-target')).dispatchEvent(new MouseEvent('click', { bubbles: true })));
      } else {
        check(/Computer/.test(snap.txt), 'Computer-Text: ' + snap.txt);
        await p.waitForTimeout(30);
      }
    }
    console.log('Lernrunde: Menschen-Schritte', human, 'Ende', over, 'verschiedene Texte', texts.size);
    console.log([...texts].map((t) => ' - ' + t).join('\n'));
    check(human >= 10 && texts.size >= 5, 'Lernrunde kommt durch erste Schritte');
    if (![...texts].some((t) => /Wertung/.test(t))) console.log('Hinweis: in dieser Lernrunde kam keine Wertung vor');
    if (over) {
      check(/zu Ende/.test(await p.innerText('.coach .coach-t')), 'Ende-Text');
      await shot(p, 'lern-ende', true);
    }
    await ctx.close();
  }

  // ---------- (c) zwei Personen über Mock ----------
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
    let moves = 0;
    const t0 = Date.now();
    while (moves < 14 && Date.now() - t0 < 60000) {
      for (const p of [A, B]) if (await mine(p)) { const r = await step(p).catch((e) => { fail('Mock-Zug: ' + e.message); return null; }); if (r) moves++; await p.waitForTimeout(40); }
      await A.waitForTimeout(30);
    }
    await A.waitForTimeout(300);
    const ta = await tiles(A), tb = await tiles(B);
    console.log('Mock: Teilzüge', moves, '| Plättchen Host', ta, 'Gast', tb);
    check(moves >= 14, 'Mock: Züge gespielt');
    check(ta === tb && ta > 3, 'Gast sieht denselben Brettstand');
    const sa = await A.locator('.ks-pl-s b').allInnerTexts(); const sb = await B.locator('.ks-pl-s b').allInnerTexts();
    check(JSON.stringify(sa) === JSON.stringify(sb), 'gleiche Punktestände');
    check(await B.locator('[data-act=again]').count() === 0, 'Gast hat keinen Neustart');
    await shot(A, 'mock-host'); await shot(B, 'mock-gast');
    // Spiel bis zum Ende, Gast sieht Siegerehrung ohne Neustart-Knopf
    const stats = {};
    const endT = Date.now();
    while (Date.now() - endT < 120000 && !((await isOver(A)) && (await isOver(B)))) {
      let acted = false;
      for (const p of [A, B]) if (!(await isOver(p)) && (await mine(p))) { await step(p, stats).catch((e) => fail('Mock-Zug: ' + e.message)); acted = true; await p.waitForTimeout(10); }
      if (!acted) await A.waitForTimeout(30);
    }
    check((await isOver(A)) && (await isOver(B)), 'Mock-Partie bis zum Ende');
    if (await isOver(B)) { check(await B.locator('[data-act=again]').count() === 0 && await A.locator('[data-act=again]').count() === 1, 'Neustart nur beim Gastgeber'); await shot(B, 'mock-gast-over', true); }
    await ctx.close();
  }

  await browser.close();
  console.log(errors.length ? `FEHLER: ${errors.length}` : 'ALLES OK');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
