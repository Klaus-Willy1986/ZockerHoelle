// Browser-Test "Wenig ist mehr": NODE_PATH=$(npm root -g) node tests/wenig.e2e.cjs
// Voraussetzung: Server auf Port 8861  (cd /home/user/zockerhoelle && python3 -m http.server 8861)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const PORT = process.env.PORT || 8861;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = `http://localhost:${PORT}/wenig/index.html`;
const errors = [];
const log = (...a) => console.log(...a);

async function newPage(browser, label, { w = 390, h = 844, fast = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  if (fast) {
    await ctx.addInitScript(() => {
      const si = window.setInterval;
      window.setInterval = (fn, ms, ...a) => si(fn, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
      const st = window.setTimeout;
      window.setTimeout = (fn, ms, ...a) => st(fn, ms === 900 ? 20 : ms, ...a);
    });
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label} console ${m.text()}`); });
  page.on('dialog', (d) => d.accept());
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, 'wm_' + name + '.png'), fullPage: true });
const shotDone = new Set();
async function snapOnce(page, name) { if (shotDone.has(name)) return; shotDone.add(name); await shot(page, 'zustand_' + name); }

// ---------- Messungen ----------
const gridPos = (page) => page.evaluate(() => {
  const el = document.querySelector('.wm-mine .wm-grid'); if (!el) return null;
  const r = el.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) };
});
const hScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const smallButtons = (page) => page.evaluate(() => {
  const bad = [];
  document.querySelectorAll('button, a.btn, [data-act]').forEach((b) => {
    const r = b.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (b.matches('.wm-mini, .wm-mini *')) return;
    const cs = getComputedStyle(b);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    if (r.height < 47.5 || r.width < 47.5) bad.push(`${b.tagName}.${String(b.className).split(' ').slice(0, 2).join('.')} "${(b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
  });
  return bad;
});
async function layoutCheck(page, label, seen) {
  const hs = await hScroll(page);
  if (hs > 0) errors.push(`${label}: horizontaler Seitenscroll (${hs}px)`);
  const sb = await smallButtons(page);
  for (const b of sb) { const k = label + b; if (!seen.has(k)) { seen.add(k); errors.push(`${label}: Knopf kleiner als 48px: ${b}`); } }
}

// ---------- Mensch (zufällige erlaubte Züge, nur über die Oberfläche) ----------
async function humanStep(page, st) {
  const has = async (sel) => (await page.locator(sel).count()) > 0;
  try {
    if (await has('.wm-over')) return null;
    if (!(await has('.banner.mine'))) return null;
    const cells = page.locator('.wm-mine [data-act=cell]');
    const clickCell = async (kind) => {
      const n = await cells.count();
      if (!n) return null;
      await cells.nth(Math.floor(Math.random() * n)).click({ timeout: 3000 });
      st[kind]++; return kind;
    };
    if (await has('[data-act=put]')) {
      await snapOnce(page, 'gezogen');
      if (Math.random() < 0.4) { await page.click('[data-act=put]', { timeout: 3000 }); st.put++; return 'put'; }
      return clickCell('swapDrawn');
    }
    if (await has('[data-act=take-cancel]')) { await snapOnce(page, 'genommen'); return clickCell('swapTake'); }
    if (await has('.wm-center [data-act=draw]')) {
      if (Math.random() < 0.5) { await page.click('.wm-center [data-act=draw]', { timeout: 3000 }); st.draw++; return 'draw'; }
      await page.click('.wm-center [data-act=take]', { timeout: 3000 }); st.take++; return 'take';
    }
    const kind = (await has('.banner.mine')) && /Decke (zwei|noch)/.test(await page.locator('.banner').innerText()) ? 'reveal' : 'flip';
    if (kind === 'flip') await snapOnce(page, 'aufdecken');
    else await snapOnce(page, 'start-aufdecken');
    return clickCell(kind);
  } catch (e) {
    if (/detached|not attached|intercepts|Timeout/.test(e.message)) return null; // Oberfläche hat sich gerade neu gezeichnet
    throw e;
  }
}
const newStats = () => ({ reveal: 0, draw: 0, take: 0, put: 0, swapDrawn: 0, swapTake: 0, flip: 0 });
const readHost = (page) => page.evaluate(() => {
  try { const h = JSON.parse(sessionStorage.getItem('zh.wm.hostState') || localStorage.getItem('zh.wm.hostState')); return h && h.game ? h.game : null; } catch { return null; }
});

// Spielt, bis `until(page)` wahr ist. pos = Referenzposition des Rasters.
async function playUntil(page, label, until, { maxMs = 180000, reloadAt = -1, st = newStats(), ref } = {}) {
  const t0 = Date.now(); let acts = 0; let reloaded = false; let lastAct = Date.now(); const seen = new Set();
  while (Date.now() - t0 < maxMs) {
    if (await until(page)) return { acts, st, ok: true, ref };
    const gp = await gridPos(page);
    if (gp) {
      if (!ref) ref = gp;
      else if (Math.abs(gp.top - ref.top) > 1 || Math.abs(gp.left - ref.left) > 1 || Math.abs(gp.h - ref.h) > 1 || Math.abs(gp.w - ref.w) > 1) { errors.push(`${label}: Raster springt ${JSON.stringify(ref)} -> ${JSON.stringify(gp)}`); ref = gp; }
      if (acts % 5 === 0) await layoutCheck(page, label, seen);
    }
    if (reloadAt >= 0 && !reloaded && acts >= reloadAt) {
      reloaded = true;
      await page.reload();
      await page.waitForSelector('.banner', { timeout: 8000 });
      log(label, 'Neuladen ok');
      continue;
    }
    const r = await humanStep(page, st);
    if (r) { acts++; lastAct = Date.now(); await page.waitForTimeout(12); } else await page.waitForTimeout(25);
    if (Date.now() - lastAct > 20000) { errors.push(`${label}: Spiel hängt`); await shot(page, label + '_haengt'); return { acts, st, ok: false, ref }; }
  }
  return { acts, st, ok: false, ref };
}
const roundOver = async (page) => (await page.locator('.wm-over').count()) > 0;

async function startBot(browser, n, level, label, query = '', vp) {
  const { ctx, page } = await newPage(browser, label, vp);
  await page.goto(BASE + query);
  await page.fill('#name', 'Anna');
  await page.click(`[data-act=bot][data-n="${n}"][data-level="${level}"]`);
  await page.waitForSelector('#board');
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch();

  // ---------- Startseite, Layout 390 ----------
  {
    const { ctx, page } = await newPage(browser, 'start');
    await page.goto(BASE);
    await page.fill('#name', 'Anna');
    await shot(page, 'start');
    const seen = new Set();
    await layoutCheck(page, 'start', seen);
    if (!(await page.locator('[data-opt=double]').isChecked())) errors.push('Verdoppelung ist nicht standardmäßig an');
    if (!(await page.locator('[data-act=learn]').count())) errors.push('Lernrunde-Knopf fehlt');
    if ((await page.locator('[data-act=bot]').count()) !== 6) errors.push('Computer-Knöpfe: 1-3 x Leicht/Mittel erwartet');
    const html = await page.content();
    if (/skyjo/i.test(html)) errors.push('Markenname im HTML');
    await page.click('[data-act=help]');
    await page.waitForSelector('.modal');
    await shot(page, 'hilfe');
    await layoutCheck(page, 'hilfe', seen);
    const help = await page.locator('.modal').innerText();
    for (const w of ['150 Karten', 'Verdoppelung', '100 Punkte', 'Ablage', 'Stapel', 'Spalte', 'letzten Zug']) if (!help.includes(w)) errors.push('Hilfe ohne ' + w);
    await ctx.close();
  }

  // ---------- (a) Gegen 2 Computer (Mittel): bis Rundenende, Neuladen, weiter bis Spielende ----------
  {
    const { ctx, page } = await startBot(browser, 2, 1, 'zwei');
    await shot(page, 'zwei_start');
    const hb = await page.locator('.banner').innerText();
    log('Banner Start:', hb.replace(/\s+/g, ' '));
    // Beide Computer decken von selbst zwei Karten auf, sobald ich meine zwei aufgedeckt habe
    const st = newStats();
    let ref;
    let r = await playUntil(page, 'zwei-r1', roundOver, { reloadAt: 12, st, ref });
    ref = r.ref;
    // Zufällig sehr schlecht spielender Mensch kann das Spiel schon in Runde 1 beenden (z. B. verdoppelt): dann neues Spiel
    for (let k = 0; k < 6 && r.ok; k++) {
      const gq = await readHost(page);
      if (gq.phase !== 'over') break;
      log('Spiel endete schon in Runde 1 (Zufallsspieler), neues Spiel');
      await page.click('[data-act=again]');
      await page.waitForSelector('#board .wm-grid');
      r = await playUntil(page, 'zwei-r1b', roundOver, { st, ref });
      ref = r.ref;
    }
    if (!r.ok) errors.push('zwei: Runde 1 nicht beendet');
    else {
      log('Runde 1:', JSON.stringify(r.st), 'Aktionen', r.acts);
      log('Titel:', (await page.textContent('.wm-over h1')).trim());
      log('Tabelle:', (await page.$$eval('.wm-table tbody tr', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ')))).join(' | '));
      log('Verdoppelung:', (await page.textContent('.wm-dbl')).trim());
      await shot(page, 'zwei_rundenende');
      await layoutCheck(page, 'zwei-rundenende', new Set());
      const g1 = await readHost(page);
      if (g1.phase !== 'round' && g1.phase !== 'over') errors.push('Phase nach Runde 1: ' + g1.phase);
      // Rechnung stimmt?
      const tot = g1.players.map((p) => p.total);
      const exp = g1.players.map((p) => g1.result.pts[p.id]);
      if (JSON.stringify(tot) !== JSON.stringify(exp)) errors.push('Gesamt != Rundenpunkte in Runde 1');
      if (g1.phase === 'round') {
        const nextBtn = await page.locator('[data-act=next]').count();
        if (!nextBtn) errors.push('Nächste-Runde-Knopf fehlt');
        await page.click('[data-act=next]');
        await page.waitForSelector('#board .wm-grid');
        const g2 = await readHost(page);
        if (g2.round !== 2 || g2.phase !== 'reveal') errors.push('Runde 2 erwartet: ' + g2.round + '/' + g2.phase);
        if (JSON.stringify(g2.players.map((p) => p.total)) !== JSON.stringify(tot)) errors.push('Gesamtstand nicht erhalten');
        if (g2.starter !== (g1.starter + 1) % 3) errors.push('Startperson rotiert nicht');
        log('Runde 2 gestartet, Startperson', g2.players[g2.starter].name);
        await shot(page, 'zwei_runde2_start');
      }
    }
    // weiter bis zum Spielende
    const over = async (p) => { const g = await readHost(p); return !!g && g.phase === 'over' && (await p.locator('.wm-over').count()) > 0; };
    const roundN = async () => (await readHost(page)).round;
    let guard = 0;
    for (;;) {
      const g = await readHost(page);
      if (g && g.phase === 'over') break;
      if (g && g.phase === 'round') { await page.click('[data-act=next]'); await page.waitForSelector('#board .wm-grid'); continue; }
      const rr = await playUntil(page, 'zwei-weiter', async (p) => { const gg = await readHost(p); return !!gg && (gg.phase === 'round' || gg.phase === 'over'); }, { maxMs: 120000, st, ref });
      ref = rr.ref;
      if (!rr.ok) { errors.push('zwei: Runde hängt'); break; }
      if (++guard > 12) { errors.push('zwei: Spiel endet nicht'); break; }
    }
    const gE = await readHost(page);
    if (gE && gE.phase === 'over') {
      await page.waitForSelector('.wm-over');
      log('Spielende nach Runde', gE.round, 'Gesamt:', gE.players.map((p) => `${p.name} ${p.total}`).join(', '));
      log('Titel:', (await page.textContent('.wm-over h1')).trim());
      if (!gE.players.some((p) => p.total >= 100)) errors.push('Spielende ohne 100 Punkte');
      if (!(await page.locator('[data-act=again]').count())) errors.push('Neues Spiel fehlt');
      if (await page.locator('[data-act=next]').count()) errors.push('Nächste Runde am Spielende');
      await shot(page, 'zwei_spielende');
      if (gE.round < 2) errors.push('Spiel endete schon in Runde 1');
      await page.click('[data-act=again]');
      await page.waitForSelector('#board .wm-grid');
      const gN = await readHost(page);
      if (gN.round !== 1 || gN.players.some((p) => p.total !== 0)) errors.push('Neues Spiel setzt Stand nicht zurück');
      log('Neues Spiel ok');
    } else errors.push('zwei: kein Spielende erreicht');
    log('Gesamt Aktionen:', JSON.stringify(st));
    for (const k of ['draw', 'take', 'put', 'swapDrawn', 'swapTake', 'flip', 'reveal']) if (!st[k]) errors.push('Zugart nie ausprobiert: ' + k);
    await ctx.close();
  }

  // ---------- (a2) Spielende mit niedrigem Limit (Test-Hook ?limit=15), 3 Computer, Layout 390 ----------
  {
    const { ctx, page } = await startBot(browser, 3, 0, 'drei', '?limit=15');
    await shot(page, 'drei_start');
    const g0 = await readHost(page);
    if (g0.limit !== 15) errors.push('Limit-Hook wirkt nicht');
    const r = await playUntil(page, 'drei', async (p) => { const g = await readHost(p); return !!g && g.phase === 'over' && (await p.locator('.wm-over').count()) > 0; }, { maxMs: 150000 });
    log('3 Computer, Limit 15: Ende', r.ok, 'Aktionen', r.acts);
    if (!r.ok) errors.push('drei: Spielende nicht erreicht');
    else { await shot(page, 'drei_spielende'); log('Titel:', (await page.textContent('.wm-over h1')).trim()); }
    await ctx.close();
  }

  // ---------- (b) Lernrunde ----------
  {
    const { ctx, page } = await newPage(browser, 'lern');
    await page.goto(BASE);
    await page.waitForSelector('[data-act=learn]');
    await page.fill('#name', 'Erna');
    await page.click('[data-act=learn]');
    await page.waitForSelector('.coach');
    await shot(page, 'lern_start');
    const texts = new Set();
    let steps = 0; let idle = 0; let finished = false; const seen = new Set();
    while (steps < 800) {
      const text = (await page.textContent('.coach .coach-t')).trim();
      if (text.length === 0 || text.length > 260) errors.push(`lern: Textlänge ${text.length}`);
      if (/skyjo/i.test(text)) errors.push('lern: Markenname');
      if (!texts.has(text)) { texts.add(text); if (texts.size === 3) await shot(page, 'lern_mitte'); if (texts.size === 6) await shot(page, 'lern_mitte2'); }
      const targets = page.locator('.coach-target');
      const n = await targets.count();
      if (n === 0) {
        if (++idle > 400) { errors.push(`lern: kein Ziel seit langem: "${text}"`); break; }
        await page.waitForTimeout(15);
        continue;
      }
      idle = 0;
      const target = targets.nth(Math.floor(Math.random() * n));
      const act = await target.getAttribute('data-act');
      if (act === 'next') { finished = true; texts.add((await page.textContent('.coach .coach-t')).trim()); await shot(page, 'lern_ende'); await layoutCheck(page, 'lern-ende', seen); break; }
      try { await target.click({ timeout: 4000 }); } catch (e) { errors.push('lern: Klick fehlgeschlagen bei "' + text + '": ' + e.message.split('\n')[0]); break; }
      steps++;
    }
    log('Lernrunde: Schritte', steps, 'fertig', finished, 'Texte', texts.size);
    for (const t of texts) log('   -', t);
    if (!finished) errors.push('Lernrunde nicht bis zum Rundenende');
    const all = [...texts].join(' ');
    for (const re of [/zwei Karten auf/, /Ziel/, /Ablage/, /Stapel/, /Runde ist zu Ende/, /doppelt/]) if (!re.test(all)) errors.push('Lernrunde ohne ' + re);
    if (/beste|empfehl|solltest/i.test(all)) errors.push('Lernrunde gibt Empfehlung');
    await page.click('[data-act=next]');
    await page.waitForSelector('#board .wm-grid');
    await page.reload();
    await page.waitForSelector('.coach', { timeout: 5000 }).catch(() => errors.push('lern: nach Neuladen keine Lernrunde'));
    await page.click('[data-act=learn-stop]');
    await page.waitForTimeout(200);
    if (await page.locator('.coach').count()) errors.push('lern: Anleitung bleibt');
    await ctx.close();
  }

  // ---------- (c) Zwei im Netz (Mock): verdeckte Karten nie im DOM des Gastes, Zustände identisch ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(() => {
      const si = window.setInterval;
      window.setInterval = (fn, ms, ...a) => si(fn, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
    });
    const watch = (p, n) => { p.on('pageerror', (e) => errors.push(n + ' pageerror ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(n + ' console ' + m.text()); }); };
    const A = await ctx.newPage(); watch(A, 'A');
    await A.goto(BASE + '?mock=1');
    await A.fill('#name', 'Anna');
    await A.click('[data-act=host]');
    await A.waitForSelector('.code');
    const code = (await A.textContent('.code')).trim();
    if (!(await A.locator('[data-opt=double]').count())) errors.push('Option fehlt in der Lobby');
    const B = await ctx.newPage(); watch(B, 'B');
    await B.goto(BASE + '?mock=1&raum=' + code);
    await B.fill('#name', 'Bernd');
    await B.click('[data-act=join-invited]');
    await A.waitForSelector('[data-act=start]');
    await shot(A, 'netz_lobby');
    await A.click('[data-act=start]');
    await A.waitForSelector('#board .wm-grid'); await B.waitForSelector('#board .wm-grid');

    const fingerprint = (page) => page.evaluate(() => {
      const cellStr = (el) => (el.classList.contains('gone') ? '-' : el.classList.contains('down') ? '?' : (el.querySelector('.n') || {}).textContent.trim());
      const out = { players: {} };
      const myName = null;
      const mine = [...document.querySelectorAll('.wm-mine .wm-grid > *')].map(cellStr);
      out.mine = mine;
      document.querySelectorAll('.wm-opp').forEach((li) => { out.players[li.querySelector('.wm-nm').textContent.trim()] = [...li.querySelectorAll('.wm-mini > *')].map(cellStr); });
      const cols = document.querySelectorAll('.wm-center .wm-col');
      out.deck = cols[0].querySelector('.wm-count').textContent.trim();
      const top = cols[1].querySelector('.n');
      out.top = top ? top.textContent.trim() : null;
      out.handText = cols[2].innerText.trim();
      return out;
    });
    const leaks = [];
    const checkGuest = async (P, hostPage, who) => {
      const g = await readHost(hostPage);
      if (!g || !(await P.locator('.wm-center').count())) return;
      const host = g.players[0]; // Anna (Gastgeber) – ihre verdeckten Karten darf Bernd nie sehen
      const dom = await P.evaluate(() => [...document.querySelectorAll('.wm-opp')].map((li) => ({ name: li.querySelector('.wm-nm').textContent.trim(), cells: [...li.querySelectorAll('.wm-mini > *')].map((c) => ({ cls: c.className, txt: c.textContent.trim(), aria: c.getAttribute('aria-label') || '', html: c.outerHTML })) })));
      const row = dom.find((d) => d.name === 'Anna');
      if (!row || row.cells.length !== 12) { leaks.push('Mini-Raster fehlt'); return; }
      host.grid.forEach((c, i) => {
        const el = row.cells[i];
        if (c === null) { if (!/gone/.test(el.cls)) leaks.push('entfernte Spalte nicht als solche gezeigt'); return; }
        if (c.up) { if (el.txt !== (c.v < 0 ? '−' + -c.v : String(c.v))) leaks.push(`offene Karte falsch: ${el.txt} statt ${c.v}`); return; }
        if (el.txt !== '' || !/back/.test(el.cls) || /\d/.test(el.html.replace(/class="[^"]*"/g, '').replace(/aria-hidden="true"/g, ''))) leaks.push(`verdeckte Karte zeigt etwas: ${el.html}`);
      });
      // gezogene Karte des Gastgebers darf der Gast nicht sehen
      const hand = await P.evaluate(() => document.querySelectorAll('.wm-center .wm-col')[2].innerText);
      if (g.turn.stage === 'drawn' && g.active === 0 && /[\d−]/.test(hand.replace('Anna', ''))) leaks.push('gezogene Karte des Gastgebers sichtbar: ' + hand);
      // Auch nirgends im Text der Seite darf die Karte stehen: Hand-Bereich nur Beschriftung
      if (who === 'B') {
        const label = await P.evaluate(() => document.querySelector('.banner').innerText + ' ' + document.querySelector('.wm-action').innerText);
        if (g.turn.stage === 'drawn' && g.active === 0 && new RegExp(`(^|\\D)${g.turn.drawn < 0 ? '−' + -g.turn.drawn : g.turn.drawn}(\\D|$)`).test(label.replace(/\d+ Karten/g, ''))) {
          // Zahl könnte zufällig anderswo stehen (z. B. Punkte); nur melden, wenn sie in Banner/Aktion vorkommt
          leaks.push('gezogene Karte steht im Banner/Aktionstext: ' + label.replace(/\s+/g, ' '));
        }
      }
    };
    const ident = []; let identChecks = 0;
    const compare = async () => {
      for (let k = 0; k < 8; k++) {
        if (!(await A.locator('.wm-center').count()) || !(await B.locator('.wm-center').count())) return;
        const fa = await fingerprint(A); const fb = await fingerprint(B);
        const pubA = { me: fa.mine, other: fa.players.Bernd, deck: fa.deck, top: fa.top };
        const pubB = { me: fb.players.Anna, other: fb.mine, deck: fb.deck, top: fb.top };
        // Gastgeber-Raster wie der Gast es sieht: offene Karten gleich, verdeckte beide '?'
        if (JSON.stringify(pubA) === JSON.stringify({ ...pubB, me: pubB.me, other: pubB.other })) { identChecks++; return; }
        await A.waitForTimeout(60);
      }
      ident.push('Zustände verschieden');
    };
    const stA = newStats(); const stB = newStats();
    let acts = 0; const t0 = Date.now(); let posA, posB; let shotDone2 = false; let checks = 0;
    while (Date.now() - t0 < 150000) {
      if ((await A.locator('.wm-over').count()) && (await B.locator('.wm-over').count())) break;
      for (const [P, st, nm] of [[A, stA, 'A'], [B, stB, 'B']]) {
        const gp = await gridPos(P);
        const ref = nm === 'A' ? posA : posB;
        if (gp && ref && (Math.abs(gp.top - ref.top) > 1 || Math.abs(gp.h - ref.h) > 1)) errors.push(`netz ${nm}: Raster springt`);
        if (gp && !ref) { if (nm === 'A') posA = gp; else posB = gp; }
        if (await humanStep(P, st)) acts++;
      }
      if (acts % 3 === 0) { await checkGuest(B, A, 'B'); checks++; }
      if (acts % 7 === 0) await compare();
      if (!shotDone2 && stA.draw + stB.draw > 2) { shotDone2 = true; await shot(A, 'netz_A'); await shot(B, 'netz_B'); }
      await A.waitForTimeout(30);
    }
    log('Netz: Aktionen', acts, 'A', JSON.stringify(stA), 'B', JSON.stringify(stB), '| Leck-Prüfungen', checks, '| Vergleiche', identChecks);
    if (leaks.length) errors.push('Netz: Gast sieht verdeckte Information: ' + [...new Set(leaks)].slice(0, 5).join(' || '));
    if (ident.length) errors.push('Netz: ' + [...new Set(ident)].join(','));
    if (checks < 8 || identChecks < 3) errors.push('Netz: zu wenige Prüfungen');
    await A.waitForSelector('.wm-over'); await B.waitForSelector('.wm-over');
    log('Netz Titel:', (await A.textContent('.wm-over h1')).trim(), '|', (await B.textContent('.wm-over h1')).trim());
    await shot(A, 'netz_ende_host'); await shot(B, 'netz_ende_gast');
    if (await B.locator('[data-act=next]').count()) errors.push('Gast sieht Nächste-Runde-Knopf');
    if (await B.locator('[data-act=again]').count()) errors.push('Gast sieht Neues-Spiel-Knopf');
    // Rundenende-Tabellen gleich
    const ta = await A.$$eval('.wm-table tbody tr', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ').replace(' (du)', '')));
    const tb = await B.$$eval('.wm-table tbody tr', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ').replace(' (du)', '')));
    if (JSON.stringify(ta) !== JSON.stringify(tb)) errors.push('Netz: Tabellen verschieden ' + JSON.stringify([ta, tb]));
    const gA = await readHost(A);
    if (gA.phase === 'round') {
      await A.click('[data-act=next]');
      await A.waitForSelector('#board .wm-grid'); await B.waitForSelector('#board .wm-grid');
      const g2 = await readHost(A);
      if (g2.round !== 2) errors.push('Netz: Runde 2 erwartet');
      log('Netz Runde 2 ok');
    }
    await ctx.close();
  }

  // ---------- Desktop-Ansicht ----------
  {
    const { ctx, page } = await startBot(browser, 3, 0, 'pc', '', { w: 1280, h: 900 });
    await page.waitForTimeout(300);
    const cells = page.locator('.wm-mine [data-act=cell]');
    await cells.nth(2).click(); await cells.nth(7).click();
    await page.waitForTimeout(1500);
    await shot(page, 'pc_spiel');
    await ctx.close();
  }

  await browser.close();
  console.log('errors', JSON.stringify(errors, null, 1));
  if (errors.length) process.exit(1);
  console.log('WENIG E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors)); process.exit(1); });
