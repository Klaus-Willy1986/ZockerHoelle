// Playwright-Test für Zehntausend (Test-Modus ?mock=1).
// Start: cd /home/user/zockerhoelle && python3 -m http.server 8968 &
//        NODE_PATH=$(npm root -g) node tests/zehntausend.e2e.cjs
// Prüft: (a) Partie gegen Computer und Solo bis zum Ende, (b) Lernrunde kommt durch,
// (c) Gastgeber + Gast: gleiche Zustände, (d) Layout 390×844, Konsole fehlerfrei.
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const PORT = process.env.PORT || 8968;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
const base = `http://localhost:${PORT}/zehntausend/index.html?mock=1`;
const errors = [];
const log = (...a) => console.log(...a);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `zt_e2e_${name}.png`) });

let Z;
const speedup = (ctx) => ctx.addInitScript(() => {
  const si = window.setInterval;
  window.setInterval = (fn, ms, ...a) => si(fn, ms < 200 ? 4 : ms, ...a);
  const st = window.setTimeout;
  window.setTimeout = (fn, ms, ...a) => st(fn, ms === 900 ? 20 : ms, ...a);
});
function watch(page, name) {
  page.on('pageerror', (e) => errors.push(`${name} pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console ${m.text()}`); });
}
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const OPTS = { pairs: true, entry: true, short: true };

// ---------- ein Zug-Schritt als Mensch; gibt true zurück, wenn etwas getan wurde ----------
async function diceOf(page) {
  return page.$$eval('[data-act=toggle]', (els) => els.map((e) => Number((e.getAttribute('aria-label').match(/: (\d)/) || [])[1])));
}
async function humanStep(page, st, bankP = 0.6) {
  if (await page.locator('.zt-spin').count()) return false;
  if (await page.locator('[data-act=next]').count()) { await page.click('[data-act=next]'); st.turns++; return true; }
  const rollBtn = page.locator('[data-act=roll]');
  if (await page.locator('[data-act=toggle]').count()) {
    const dice = await diceOf(page);
    const best = Z.bestSubset(dice, OPTS);
    if (!best) throw new Error('Wurf ohne Wertung ist im Zustand pick: ' + dice);
    // einmal eine ungültige Auswahl ausprobieren: Knopf muss deaktiviert sein
    if (!st.triedBad) {
      const bad = dice.findIndex((v) => Z.scoreExact([v], OPTS) === 0);
      if (bad >= 0) {
        st.triedBad = true;
        await page.click(`[data-act=toggle][data-i="${bad}"]`);
        if (!(await page.locator('[data-act=keep][disabled]').count())) errors.push('Knopf bei ungültiger Auswahl nicht deaktiviert');
        const t = await page.locator('[data-act=keep]').textContent();
        if (!/0 Punkte/.test(t)) errors.push('Knopftext bei ungültiger Auswahl: ' + t);
        await page.click(`[data-act=toggle][data-i="${bad}"]`);
        if (!/antippen/.test(await page.locator('[data-act=keep]').textContent())) errors.push('Knopf ohne Auswahl zeigt Punkte');
      }
    }
    for (const i of best.idx) await page.click(`[data-act=toggle][data-i="${i}"]`);
    const label = await page.locator('[data-act=keep]').textContent();
    if (!label.replace(/\./g, '').includes(`${best.pts} Punkte`)) errors.push(`Knopf zeigt "${label}", erwartet ${best.pts}`);
    if (await page.locator('[data-act=keep][disabled]').count()) errors.push('Knopf bei gültiger Auswahl deaktiviert');
    await page.click('[data-act=keep]');
    st.keeps++;
    return true;
  }
  if (await rollBtn.count()) {
    const bank = page.locator('[data-act=bank]:not([disabled])');
    if (await bank.count() && rnd() < bankP) { await bank.click(); st.banks++; return true; }
    await rollBtn.click(); st.rolls++;
    return true;
  }
  return false;
}

const overSel = '.trophy';

async function playToEnd(page, label, maxMs, { onTick, mineSel = '.banner.mine' } = {}) {
  const st = { turns: 0, keeps: 0, banks: 0, rolls: 0 };
  const t0 = Date.now();
  let n = 0;
  while (Date.now() - t0 < maxMs) {
    if (await page.locator(overSel).count()) break;
    if (onTick) await onTick(st, n);
    n++;
    if (await page.locator(mineSel).count()) {
      if (await humanStep(page, st)) { await page.waitForTimeout(8); continue; }
    }
    await page.waitForTimeout(20);
  }
  const over = (await page.locator(overSel).count()) > 0;
  log(label, JSON.stringify(st), 'Ende:', over, 'Dauer', Date.now() - t0, 'ms');
  if (!over) errors.push(`${label}: Spiel nicht zu Ende gekommen`);
  return st;
}

// ---------- Layout-Messung ----------
async function measure(page) {
  return page.evaluate(() => {
    const b = document.getElementById('board');
    const a = document.querySelector('.zt-action');
    const r = b && b.getBoundingClientRect();
    const btns = [...document.querySelectorAll('#app [data-act]')].filter((e) => e.offsetParent && !e.classList.contains('mini') && e.tagName === 'BUTTON' && !e.closest('.zt-grid'))
      .map((e) => ({ act: e.dataset.act, h: Math.round(e.getBoundingClientRect().height), t: e.textContent.trim().slice(0, 30) }));
    const dice = [...document.querySelectorAll('.zt-grid .zt-die')].map((e) => Math.round(e.getBoundingClientRect().height));
    return {
      sw: document.documentElement.scrollWidth, iw: window.innerWidth,
      bt: b ? Math.round(r.top + window.scrollY) : null, bh: b ? Math.round(r.height) : null,
      ah: a ? Math.round(a.getBoundingClientRect().height) : null,
      btns, dice,
    };
  });
}

(async () => {
  Z = await import(pathToFileURL(path.join(__dirname, '..', 'zehntausend', 'engine.js')).href);
  const browser = await chromium.launch();

  // ===== (a1) Alleinspiel (Rekordjagd bis 5000) + (d) Layout =====
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await speedup(ctx);
    const page = await ctx.newPage(); watch(page, 'solo');
    await page.goto(base);
    await page.fill('#name', 'Anna');
    await page.check('[data-opt=short]');
    await shot(page, 'start');
    await page.click('[data-act=solo]');
    await page.waitForSelector('[data-act=roll]');
    await shot(page, 'solo_start');
    const lay = []; let shots = 0;
    const st = await playToEnd(page, 'Solo', 150000, {
      onTick: async (s, n) => {
        if (n % 3 === 0 && !(await page.locator('.zt-spin').count())) {
          const m = await measure(page);
          lay.push(m);
          if (m.dice.length && shots < 2 && s.keeps >= 1 + shots * 3) { shots++; await shot(page, 'solo_pick' + shots); }
        }
      },
    });
    await shot(page, 'solo_over');
    const h1 = (await page.textContent('.over h1')).trim();
    log('Solo-Ergebnis:', h1, '|', (await page.textContent('.over .big')).trim());
    if (!/^Geschafft in \d+ Zügen?!$/.test(h1)) errors.push('Solo-Überschrift: ' + h1);
    const turns = Number(h1.match(/\d+/)[0]);
    if (turns !== st.turns + 1) errors.push(`Solo: Züge ${turns} ≠ gezählt ${st.turns + 1} (der letzte Zug endet mit dem Buchen)`);
    const stored = await page.evaluate(() => sessionStorage.getItem('zh.zt_best_short'));
    if (Number(stored) !== turns) errors.push('Bestleistung nicht gespeichert: ' + stored);
    // Layout auswerten
    const sw = lay.filter((m) => m.sw > m.iw);
    if (sw.length) errors.push(`horizontaler Scroll in ${sw.length} Messungen`);
    const small = lay.flatMap((m) => m.btns).filter((b) => b.h < 48);
    if (small.length) errors.push('Knöpfe unter 48 px: ' + JSON.stringify(small.slice(0, 3)));
    const tops = lay.map((m) => m.bt), hs = lay.map((m) => m.bh), ahs = lay.map((m) => m.ah);
    const spread = (a) => Math.max(...a) - Math.min(...a);
    log(`Layout: ${lay.length} Messungen; #board oben ${Math.min(...tops)}–${Math.max(...tops)} px, Höhe ${Math.min(...hs)}–${Math.max(...hs)} px; Aktionskarte ${Math.min(...ahs)}–${Math.max(...ahs)} px; Würfel ${Math.min(...lay.flatMap((m) => m.dice))} px; kleinster Knopf ${Math.min(...lay.flatMap((m) => m.btns.map((b) => b.h)))} px`);
    if (spread(tops) > 2) errors.push('Brett springt: ' + [...new Set(tops)]);
    if (spread(hs) > 1) errors.push('Brettgröße ändert sich: ' + [...new Set(hs)]);
    if (spread(ahs) > 2) errors.push('Aktionskarte ändert Höhe: ' + [...new Set(ahs)]);
    // Noch eine Runde
    await page.click('[data-act=again]');
    await page.waitForSelector('[data-act=roll]');
    await page.click('[data-act=help]');
    await page.waitForSelector('.modal');
    await shot(page, 'help');
    await ctx.close();
  }

  // ===== (a2) Partie gegen Computer (Mittel, 2 Computer) und Leicht =====
  for (const [n, level] of [[1, 1], [2, 0]]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await speedup(ctx);
    const page = await ctx.newPage(); watch(page, `bot${n}`);
    await page.goto(base);
    await page.fill('#name', 'Anna');
    await page.check('[data-opt=short]');
    await page.click(`[data-act=bot][data-n="${n}"][data-level="${level}"]`);
    await page.waitForSelector('.banner');
    let reloaded = false, seenBot = false;
    await playToEnd(page, `Computer×${n}`, 180000, {
      onTick: async (s, i) => {
        const banner = ((await page.locator('.banner').last().textContent().catch(() => '')) || '').trim();
        if (/Computer/.test(banner)) seenBot = true;
        if (!reloaded && seenBot && s.turns >= 3 && /Computer/.test(banner)) {
          reloaded = true;
          await shot(page, `bot${n}_turn`);
          await page.reload();
          await page.waitForSelector('.banner', { timeout: 8000 });
          await page.waitForSelector('.banner.mine', { timeout: 30000 });
          log('Neuladen mitten im Computerzug ok');
        }
      },
    });
    if (!seenBot) errors.push('Computer hat nie gespielt');
    const h1 = (await page.textContent('.over h1')).trim();
    log(`Computer×${n} Ergebnis:`, h1);
    await shot(page, `bot${n}_over`);
    await ctx.close();
  }

  // ===== (b) Lernrunde =====
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await speedup(ctx);
    const page = await ctx.newPage(); watch(page, 'lern');
    await page.goto(base);
    await page.waitForSelector('[data-act=learn]');
    await page.fill('#name', 'Erna');
    await page.click('[data-act=learn]');
    await page.waitForSelector('.coach');
    const texts = new Set();
    let noTarget = 0, ended = false, shots = 0;
    const st = { turns: 0, keeps: 0, banks: 0, rolls: 0 };
    const t0 = Date.now();
    while (Date.now() - t0 < 240000) {
      const text = (await page.textContent('.coach .coach-t')).trim();
      if (text.length === 0 || text.length > 240) errors.push(`Lernrunde Textlänge ${text.length}: ${text}`);
      if (!texts.has(text)) { texts.add(text); if (shots < 3 && texts.size % 3 === 0) { shots++; await shot(page, 'lern' + shots); } }
      if (await page.locator(overSel).count() || await page.locator('.coach-target[data-act=again]').count()) { ended = true; break; }
      if (await page.locator('.banner.mine').count() && !(await page.locator('.zt-spin').count())) {
        if (!(await page.locator('.coach-target').count()) && !/rollen/.test(text)) { noTarget++; }
        if (await humanStep(page, st, 0.6)) { await page.waitForTimeout(8); continue; }
      }
      await page.waitForTimeout(20);
    }
    const endText = (await page.textContent('.coach .coach-t')).trim();
    log('Lernrunde:', JSON.stringify(st), 'Ende:', ended, '| verschiedene Texte:', texts.size, '| Ziel fehlte kurz:', noTarget);
    for (const t of texts) log('   -', t);
    if (!ended) errors.push('Lernrunde nicht zu Ende gekommen');
    if (!/Lernrunde ist zu Ende/.test(endText)) errors.push('Lernrunde Endtext: ' + endText);
    const need = [/Würfeln/, /Punkte bringen/, /Eine 1 zählt/, /Jetzt hast du die Wahl/, /Einstiegshürde/, /Patzer|Weiter/];
    for (const re of need) if (![...texts].some((t) => re.test(t))) log('   (Hinweis: Text nicht gesehen:', re, ')');
    for (const re of [/Eine 1 zählt/, /Jetzt hast du die Wahl/, /Einstiegshürde/, /Mit dem Knopf legst du/]) {
      // ein Text darf in mehreren Zuständen nur vorkommen, wenn er unterschiedlich zusammengesetzt ist; die Erklärung selbst nur einmal
      const hits = [...texts].filter((t) => re.test(t));
      if (hits.length > 1) errors.push(`Erklärung mehrfach gezeigt (${re}): ${hits.length}`);
    }
    await shot(page, 'lern_ende');
    await ctx.close();
  }

  // ===== (c) Gastgeber + Gast =====
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await speedup(ctx);
    const A = await ctx.newPage(); watch(A, 'A');
    await A.goto(base);
    await A.fill('#name', 'Anna');
    await A.click('[data-act=host]');
    await A.waitForSelector('.code');
    const code = (await A.textContent('.code')).trim();
    await A.check('[data-opt=short]');
    const B = await ctx.newPage(); watch(B, 'B');
    await B.goto(base + '&raum=' + code);
    await B.fill('#name', 'Bernd');
    await B.click('[data-act=join-invited]');
    await A.waitForSelector('[data-act=start]:not([disabled])');
    await A.click('[data-act=start]');
    await A.waitForSelector('.banner'); await B.waitForSelector('.banner');
    await shot(B, 'guest_start');

    const norm = (s) => s.replace(/\(du\)/g, '').replace(/🎲/g, '').replace(/\s+/g, ' ').trim();
    const snapshot = (p) => p.evaluate(() => ({
      rows: [...document.querySelectorAll('.zt-prow')].map((e) => e.innerText),
      dice: [...document.querySelectorAll('.zt-grid .zt-die, .zt-aside .zt-die')].map((e) => (e.getAttribute('aria-label') || '').replace(/, (markiert|nicht markiert)/, '')),
      stat: (document.querySelector('.zt-stat') || {}).innerText || '',
      note: (document.querySelector('.zt-note') || {}).innerText || '',
      body: document.body.innerText,
    }));
    let compares = 0;
    const compare = async () => {
      for (let tries = 0; tries < 40; tries++) {
        if (await A.locator('.zt-spin').count() || await B.locator('.zt-spin').count()) { await A.waitForTimeout(25); continue; }
        const [a, b] = await Promise.all([snapshot(A), snapshot(B)]);
        if (a.body.includes('rollen …') || b.body.includes('rollen …')) { await A.waitForTimeout(25); continue; }
        const same = JSON.stringify([a.rows.map(norm), a.dice, a.stat, a.note]) === JSON.stringify([b.rows.map(norm), b.dice, b.stat, b.note]);
        if (same) { compares++; if (/NaN|undefined|null/.test(b.body)) errors.push('Gast sieht NaN/undefined/null'); return; }
        await A.waitForTimeout(25);
      }
      const [a, b] = await Promise.all([snapshot(A), snapshot(B)]);
      errors.push('Zustände von Gastgeber und Gast unterschiedlich: ' + JSON.stringify([a.rows, b.rows, a.dice, b.dice]).slice(0, 400));
    };
    const stA = { turns: 0, keeps: 0, banks: 0, rolls: 0 }, stB = { turns: 0, keeps: 0, banks: 0, rolls: 0 };
    let shots = 0;
    const t0 = Date.now();
    let last = 0;
    while (Date.now() - t0 < 240000) {
      if (await A.locator(overSel).count() && await B.locator(overSel).count()) break;
      const mineA = await A.locator('.banner.mine').count();
      const mineB = await B.locator('.banner.mine').count();
      if (mineA && mineB) errors.push('Beide sind gleichzeitig dran');
      const me = mineA ? A : mineB ? B : null;
      if (me) {
        const did = await humanStep(me, me === A ? stA : stB);
        if (did) {
          last++;
          if (last % 7 === 0) await compare();
          if (me === B && shots < 2 && (await B.locator('[data-act=toggle]').count())) { shots++; await shot(B, 'guest_pick' + shots); }
          await A.waitForTimeout(8);
          continue;
        }
      }
      await A.waitForTimeout(20);
    }
    const overA = await A.locator(overSel).count(), overB = await B.locator(overSel).count();
    log('Host+Gast:', JSON.stringify({ A: stA, B: stB }), 'Vergleiche ok:', compares, 'Ende:', !!(overA && overB));
    if (!(overA && overB)) errors.push('Host/Gast: Spiel nicht zu Ende');
    await A.waitForTimeout(100);
    const rankA = await A.$$eval('.ranking li', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ')));
    const rankB = await B.$$eval('.ranking li', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ')));
    log('Rangliste:', rankA.join(' | '));
    if (JSON.stringify(rankA.map(norm)) !== JSON.stringify(rankB.map(norm))) errors.push('Ranglisten unterschiedlich');
    log('Sieger:', (await A.textContent('.over h1')).trim(), '/', (await B.textContent('.over h1')).trim());
    await shot(A, 'host_over'); await shot(B, 'guest_over');
    if (await B.$('[data-act=again]')) errors.push('Gast sieht again-Knopf');
    await A.click('[data-act=again]');
    await A.waitForSelector('.banner:not(.done)'); await B.waitForSelector('.banner:not(.done)');
    if (await A.locator(overSel).count() || await B.locator(overSel).count()) errors.push('Neustart fehlgeschlagen');
    log('Neustart ok');
    await ctx.close();
  }

  // ===== (e) Bewegung reduzieren: keine Animation, Spiel läuft =====
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await speedup(ctx);
    const page = await ctx.newPage(); watch(page, 'reduced');
    await page.goto(base);
    await page.fill('#name', 'Anna');
    await page.click('[data-act=solo]');
    await page.waitForSelector('[data-act=roll]');
    let spin = 0; const st = { turns: 0, keeps: 0, banks: 0, rolls: 0 };
    for (let i = 0; i < 60; i++) {
      if (await page.locator('.zt-spin').count()) spin++;
      await humanStep(page, st);
      await page.waitForTimeout(10);
    }
    log('Weniger Bewegung: Schritte', JSON.stringify(st), 'Animationen gesehen:', spin);
    if (spin) errors.push('Animation trotz reduzierter Bewegung');
    if (st.keeps < 3) errors.push('Reduced-Motion-Spiel kam nicht voran');
    await ctx.close();
  }

  await browser.close();
  log('Fehler:', errors.length ? errors : 'keine');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FEHLER', e); process.exit(2); });
