// Durchspieltest Haus & Hof im Browser.
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8931 &  dann  NODE_PATH=$(npm root -g) node tests/haus.e2e.cjs
//   (a) gegen Computer (Mittel) eine ganze Kurzspiel-Partie (?rounds=8), mit Bauen und Auktion, (b) Lernrunde,
//   (c) Host + Gast über Mock-Netz, (d) 3 Personen, (e) Layout 390x844, Desktop-Quadrat
const { chromium } = require('playwright');
const path = require('path');
const PORT = process.env.PORT || 8931;
const URL0 = `http://localhost:${PORT}/haus/index.html`;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
const errors = [];
const fail = (m) => { console.log('FEHLER:', m); errors.push(m); };
const check = (c, m) => { if (!c) fail(m); };
const shot = (p, n, full = false) => p.screenshot({ path: path.join(SHOTS, `hh-${n}.png`), fullPage: full });

function watch(p, n) {
  p.on('pageerror', (e) => fail(`${n} pageerror ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') fail(`${n} console ${m.text()}`); });
  p.on('dialog', (d) => d.accept());
}
const fast = (ctx) => ctx.addInitScript(() => {
  const st = window.setTimeout.bind(window);
  window.setTimeout = (f, t, ...a) => st(f, t >= 700 && t <= 1000 ? 5 : t, ...a);
});
const mine = async (p) => /Du bist|Du entscheidest|Du musst|Pasch! Du/.test(await p.locator('.banner').first().innerText().catch(() => ''));
const isOver = async (p) => (await p.locator('.hh-over').count()) > 0;
const click = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (e && !e.disabled) { e.click(); return true; } return false; }, sel);
const has = (p, sel) => p.locator(sel).count();

// Ein Zug-Schritt des Klick-Bots
async function step(p, st = {}) {
  if (await has(p, '[data-act=roll]')) { await click(p, '[data-act=roll]'); st.roll = (st.roll || 0) + 1; return 'roll'; }
  if (await has(p, '[data-act=buy]')) {
    st.buyPhase = (st.buyPhase || 0) + 1;
    if (Math.random() < 0.55) { await click(p, '[data-act=buy]'); st.buy = (st.buy || 0) + 1; } else { await click(p, '[data-act=decline]'); st.decline = (st.decline || 0) + 1; }
    return 'buy';
  }
  if (await has(p, '[data-act=bid]')) {
    st.auction = (st.auction || 0) + 1;
    if (Math.random() < 0.5 && (await click(p, '[data-act=bid]:not([disabled])'))) st.bid = (st.bid || 0) + 1; else await click(p, '[data-act=pass_bid]');
    return 'auction';
  }
  if (await has(p, '[data-act=declare_bankrupt]')) {
    st.raise = (st.raise || 0) + 1;
    if (await click(p, '[data-act=sell]:not([disabled])')) return 'raise';
    if (await click(p, '[data-act=mortgage]:not([disabled])')) return 'raise';
    await click(p, '[data-act=declare_bankrupt]'); st.bankrupt = (st.bankrupt || 0) + 1; return 'raise';
  }
  if (await has(p, '[data-act=end]')) {
    if ((await has(p, '[data-act=build]:not([disabled])')) && Math.random() < 0.6) { await click(p, '[data-act=build]:not([disabled])'); st.build = (st.build || 0) + 1; return 'build'; }
    if ((await has(p, '[data-act=sell]:not([disabled])')) && Math.random() < 0.1) { await click(p, '[data-act=sell]:not([disabled])'); st.sell = (st.sell || 0) + 1; return 'sell'; }
    if ((await has(p, '[data-act=mortgage]:not([disabled])')) && Math.random() < 0.12) { await click(p, '[data-act=mortgage]:not([disabled])'); st.mort = (st.mort || 0) + 1; return 'mort'; }
    if ((await has(p, '[data-act=unmortgage]:not([disabled])')) && Math.random() < 0.5) { await click(p, '[data-act=unmortgage]:not([disabled])'); st.unmort = (st.unmort || 0) + 1; return 'unmort'; }
    await click(p, '[data-act=end]'); st.end = (st.end || 0) + 1; return 'end';
  }
  return null;
}

async function measure(p) {
  return p.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top + scrollY), Math.round(b.width), Math.round(b.height)]; };
    const small = [...document.querySelectorAll('#app .btn:not([disabled])')].filter((b) => b.offsetParent && !b.closest('.topbtns') && b.getBoundingClientRect().height < 48).map((b) => b.textContent.trim());
    return { banner: r('.banner'), dice: r('#dice'), board: r('#board'), action: r('.hh-action'), hscroll: document.documentElement.scrollWidth > innerWidth + 1, small };
  });
}

(async () => {
  const browser = await chromium.launch();

  // ---------- (a) gegen 1 Computer (Mittel), Kurzspiel mit 8 Runden; (e) Layout ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await fast(ctx);
    const p = await ctx.newPage(); watch(p, 'A');
    const U = URL0 + '?rounds=8';
    await p.goto(U);
    await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await p.goto(U);
    await p.fill('#name', 'Gerda');
    await shot(p, 'start', true);
    check((await has(p, '[data-act=bot]')) === 6, 'sechs Computer-Knöpfe (1-3 x Leicht/Mittel)');
    check((await has(p, '[data-opt=short]:checked')) === 1 && (await has(p, '[data-opt=auction]:checked')) === 1, 'Optionen standardmäßig an');
    await p.click('[data-act=help]');
    const help = await p.locator('.modal').innerText();
    check(/Hexenturm/.test(help) && /Hypothek/.test(help) && /Versteigerung/.test(help) && /Kurzspiel/.test(help) && !/Monopoly/i.test(help), 'Hilfetext');
    await p.click('.modal [data-act=help-close]');
    await p.fill('#name', 'Gerda');
    await p.click('[data-act=bot][data-n="1"][data-level="1"]');
    await p.waitForSelector('#board');
    check((await has(p, '#board .hh-sq')) === 40, 'Streifen hat 40 Felder');
    await shot(p, 'strip');
    await p.click('[data-act=tog][data-k=board]');
    await p.waitForSelector('.hh-mini');
    check((await has(p, '.hh-mini .hh-mc')) === 40, 'Gesamtübersicht 40 Felder');
    await p.click('.hh-mc[data-sq="39"]');
    await p.evaluate(() => document.querySelector('.hh-mini').scrollIntoView({ block: 'center' }));
    await shot(p, 'mini');
    await p.click('[data-act=tog][data-k=board]');
    // Besitz vorbereiten, damit sicher gebaut werden kann (Test-Eingriff in den gespeicherten Zustand)
    await p.evaluate(() => {
      const k = 'zh.hh.hostState';
      const hs = JSON.parse(localStorage.getItem(k));
      const me = hs.game.players[0].id;
      hs.game.owners[1] = me; hs.game.owners[3] = me;
      localStorage.setItem(k, JSON.stringify(hs));
    });
    await p.reload();
    await p.waitForSelector('#board');
    const stats = {};
    const lay = [];
    const seenShots = {};
    let turn = 0, over = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 170000) {
      if (await isOver(p)) { over = true; break; }
      if (await mine(p)) {
        if (turn % 3 === 0) lay.push(await measure(p));
        if (!seenShots.buy && await has(p, '[data-act=buy]')) { seenShots.buy = 1; await shot(p, 'buy'); }
        if (!seenShots.auction && await has(p, '[data-act=bid]')) { seenShots.auction = 1; await shot(p, 'auction'); lay.push(await measure(p)); }
        if (!seenShots.manage && await has(p, '[data-act=build]:not([disabled])')) {
          seenShots.manage = 1;
          await p.evaluate(() => document.querySelector('.hh-manage').scrollIntoView({ block: 'start' }));
          await shot(p, 'manage');
          await p.evaluate(() => scrollTo(0, 0));
        }
        await step(p, stats).catch((e) => fail('Zug: ' + e.message));
        turn++;
        await p.waitForTimeout(15);
      } else await p.waitForTimeout(40);
    }
    check(over, 'Partie bis zur Siegerehrung (Zeitlimit)');
    console.log('Schritte:', JSON.stringify(stats));
    check(stats.build >= 1, 'mindestens einmal gebaut');
    check(stats.auction >= 1, 'mindestens eine Auktion bedient');
    if (over) {
      await p.waitForSelector('.trophy');
      const h1 = (await p.locator('.hh-over h1').innerText()).replace(/\n/g, ' ');
      const txt = await p.locator('.hh-over').innerText();
      console.log('Ende:', h1, '|', txt.split('\n').slice(2, 4).join(' / '));
      check((await has(p, '.ranking li')) === 2, 'Rangliste 2 Zeilen');
      check(/Kurzspiel ist nach 8 Runden zu Ende|bankrott/.test(txt), 'Hinweis zum Spielende');
      check((await has(p, '[data-act=again]')) === 1, 'Neustart-Knopf');
      await p.waitForTimeout(500);
      await shot(p, 'over', true);
      await p.click('[data-act=again]');
      await p.waitForSelector('#board');
      check(!(await isOver(p)), 'Neues Spiel startet');
    }
    const uniq = (k) => new Set(lay.map((m) => (k === 'action' ? m[k].slice(0, 3) : m[k]).join(','))).size; // Aktionsbereich: Lage fest, Höhe darf mit der Knopfzahl wachsen
    console.log('  Aktion-Boxen', JSON.stringify([...new Set(lay.map((m) => m.action.join(',')))]), 'Brett', JSON.stringify([...new Set(lay.map((m) => m.board.join(',')))]));
    console.log('Layout: Messungen', lay.length, '| Banner', uniq('banner'), 'Würfel', uniq('dice'), 'Brett', uniq('board'), 'Aktion', uniq('action'));
    check(uniq('banner') === 1 && uniq('dice') === 1 && uniq('board') === 1 && uniq('action') === 1, 'Layout springt');
    check(!lay.some((m) => m.hscroll), 'horizontaler Seiten-Scroll');
    const small = [...new Set(lay.flatMap((m) => m.small))];
    check(small.length === 0, 'Knöpfe unter 48px: ' + small.join(', '));
    await ctx.close();
  }

  // ---------- Desktop-Quadrat ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    await fast(ctx);
    const p = await ctx.newPage(); watch(p, 'D');
    await p.goto(URL0);
    await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* egal */ } });
    await p.goto(URL0);
    await p.fill('#name', 'Gerda');
    await p.click('[data-act=bot][data-n="2"][data-level="1"]');
    await p.waitForSelector('.hh-sqboard');
    const st = {};
    for (let i = 0; i < 60 && !(await isOver(p)); i++) { if (await mine(p)) { if (i > 12 && await has(p, '[data-act=roll]')) break; await step(p, st); } await p.waitForTimeout(40); }
    check((await has(p, '.hh-sqboard .hh-sq')) === 40 && (await has(p, '.hh-center [data-act]')) > 0, 'Desktop-Quadrat mit Aktionen in der Mitte');
    check((await has(p, '#board')) === 1, 'genau ein #board');
    const hs = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    check(!hs, 'Desktop: horizontaler Scroll');
    await shot(p, 'desktop');
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
    let human = 0, shots = 0, over = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 170000) {
      if (await has(p, '.trophy')) { over = true; break; }
      const snap = await p.evaluate(() => ({ mine: /Du bist|Du entscheidest|Du musst|Pasch! Du/.test((document.querySelector('.banner') || { innerText: '' }).innerText), txt: (document.querySelector('.coach .coach-t') || { innerText: '' }).innerText.trim(), targets: document.querySelectorAll('.coach-target').length }));
      if (snap.mine) {
        check(snap.targets > 0 || /Du kannst noch verwalten|Dein Zug/.test(snap.txt), 'Mensch dran, aber kein Ziel: ' + snap.txt);
        human++;
        if (!texts.has(snap.txt)) { texts.add(snap.txt); if (shots < 5) await shot(p, `lern-${++shots}`); }
        await p.evaluate(() => { const t = document.querySelector('.coach-target:not([disabled])'); if (t) t.click(); });
        await p.waitForTimeout(15);
      } else await p.waitForTimeout(40);
    }
    console.log('Lernrunde: Menschen-Schritte', human, 'Ende', over, 'verschiedene Texte', texts.size);
    console.log([...texts].map((t) => ' - ' + t).join('\n'));
    check(over && human >= 10 && texts.size >= 6, 'Lernrunde kommt durch');
    if (over) check(/zu Ende/.test(await p.innerText('.coach .coach-t')), 'Ende-Text');
    await ctx.close();
  }

  // ---------- (c) Host + Gast, (d) drei Personen ----------
  for (const n of [2, 3]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const pages = [];
    for (let i = 0; i < n; i++) { const p = await ctx.newPage(); watch(p, 'M' + i); pages.push(p); }
    const M = URL0 + '?mock=1&rounds=5';
    const [H, ...G] = pages;
    await H.goto(M);
    await H.fill('#name', 'Anna');
    await H.click('[data-act=host]');
    await H.waitForSelector('.code');
    const code = (await H.locator('.code').innerText()).trim();
    for (let i = 0; i < G.length; i++) {
      await G[i].goto(M + '&raum=' + code);
      await G[i].fill('#name', 'Gast' + (i + 1));
      await G[i].click('[data-act=join-invited]');
    }
    await H.waitForFunction((k) => document.querySelectorAll('.players li').length >= k, n);
    check((await has(H, '[data-opt=short]')) === 1, 'Optionen in der Lobby');
    await H.click('[data-act=start]');
    for (const p of pages) await p.waitForSelector('#board');
    let notTurnAuction = 0, notTurnRaise = 0;
    const st = {};
    const t0 = Date.now();
    let diff = 0, compared = 0;
    while (Date.now() - t0 < 150000 && !(await Promise.all(pages.map(isOver))).every(Boolean)) {
      let acted = false;
      for (const p of pages) {
        if (await isOver(p)) continue;
        const turnIsMe = await p.evaluate(() => !!document.querySelector('.hh-pl.turn b') && /\(du\)/.test(document.querySelector('.hh-pl.turn b').textContent));
        if (!turnIsMe && (await has(p, '[data-act=bid]'))) notTurnAuction++;
        if (!turnIsMe && (await has(p, '[data-act=declare_bankrupt]'))) notTurnRaise++;
        if (await mine(p)) { await step(p, st).catch((e) => fail('Mock-Zug: ' + e.message)); acted = true; await p.waitForTimeout(10); }
      }
      if (Math.random() < 0.2) {
        await H.waitForTimeout(60);
        const sig = (p) => p.evaluate(() => JSON.stringify([[...document.querySelectorAll('.hh-pl-c b')].map((e) => e.textContent), [...document.querySelectorAll('#board .hh-sq')].map((e) => e.getAttribute('aria-label')), [...document.querySelectorAll('.hh-recap li')].map((e) => e.textContent)]));
        const a = await sig(H); const b = await sig(G[0]);
        compared++; if (a !== b) { await H.waitForTimeout(150); if ((await sig(H)) !== (await sig(G[0]))) diff++; }
      }
      if (!acted) await H.waitForTimeout(30);
    }
    const allOver = (await Promise.all(pages.map(isOver))).every(Boolean);
    check(allOver, `${n} Personen: Partie bis zum Ende`);
    console.log(`${n} Personen: Schritte ${JSON.stringify(st)} | Vergleiche ${compared}, Abweichungen ${diff} | Auktion nicht am Zug sichtbar ${notTurnAuction}, Raise nicht am Zug ${notTurnRaise}`);
    check(diff === 0, 'Host und Gast zeigen verschiedene Zustände');
    check(notTurnAuction > 0, `${n} Personen: Auktion für Nicht-am-Zug-Person nicht gesehen`);
    if (allOver) {
      const h = (p) => p.locator('.hh-over h1').innerText();
      const hs = await Promise.all(pages.map(h));
      console.log('  Ergebnis-Titel:', hs.map((x) => x.replace(/\n/g, ' ')).join(' | '));
      check((await has(H, '[data-act=again]')) === 1 && (await has(G[0], '[data-act=again]')) === 0, 'Neustart nur beim Gastgeber');
      if (n === 2) { await shot(H, 'mock-host-over', true); await shot(G[0], 'mock-gast-over'); }
      const rk = await H.locator('.ranking li').count();
      check(rk === n, 'Rangliste hat ' + n + ' Zeilen');
    }
    await ctx.close();
  }

  await browser.close();
  console.log(errors.length ? `FEHLER: ${errors.length}` : 'ALLES OK');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
