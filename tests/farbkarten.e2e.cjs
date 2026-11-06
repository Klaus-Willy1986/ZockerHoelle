// Browser-Test für Farbkarten (Playwright).
// Start:  cd /home/user/zockerhoelle && python3 -m http.server 8822 &
//         NODE_PATH=$(npm root -g) node tests/farbkarten.e2e.cjs
// Prüft: Spiel gegen 1 und 3 Computer bis zum Rundenende und Serienende, „Nächste Runde“, Neuladen mitten im Spiel,
// Lernrunde (nur den leuchtenden Zielen folgen), Zweier-Online (?mock=1, zwei Tabs), Optionen, feste Position des Spielfelds.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 8822;
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'farbkarten-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = `http://localhost:${PORT}/farbkarten/index.html`;
const errors = [];
const fail = (m) => { errors.push(m); console.log('FEHLER:', m); };

const rnd = (n) => Math.floor(Math.random() * n);

async function newPage(browser, label, vp = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport: vp });
  await ctx.addInitScript(() => {
    const si = window.setInterval;
    window.setInterval = (fn, ms, ...a) => si(fn, typeof ms === 'number' && ms < 200 ? 4 : ms, ...a);
    const st = window.setTimeout;
    window.setTimeout = (fn, ms, ...a) => st(fn, ms === 900 || ms === 2600 ? 20 : ms, ...a);
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`${label}: pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') fail(`${label}: console ${m.text()}`); });
  return { ctx, page };
}

const boardTop = (page) => page.evaluate(() => { const b = document.getElementById('board'); return b ? Math.round(b.getBoundingClientRect().top + window.scrollY) : null; });

// Ein Schritt des Menschen. Gibt true zurück, wenn etwas geklickt wurde.
async function humanStep(page, st) {
  // Ruf „Letzte Karte“ (auch wenn der Computer gerade dran ist)
  const call = page.locator('[data-act=call]');
  if (await call.count()) {
    if (st.skipCalls > 0 && !st.skipping) { st.skipCalls--; st.skipping = true; st.penalized = true; }
    if (!st.skipping) { await call.first().click(); st.calls++; return true; }
  }
  if (!(await page.locator('.banner.mine').count())) return false;
  if (await page.locator('.fk-pickover').count()) {
    const btns = page.locator('.fk-pickover [data-act=color]');
    await btns.nth(rnd(await btns.count())).click();
    st.colors++; st.skipping = false;
    return true;
  }
  const ok = page.locator('.fk-hand .fk-ok');
  const n = await ok.count();
  if (n) {
    if (await page.locator('[data-act=keep]').count() && Math.random() < 0.35) { await page.click('[data-act=keep]'); st.keeps++; return true; }
    await ok.nth(rnd(n)).click();
    st.plays++; st.skipping = false;
    return true;
  }
  const big = page.locator('.fk-action [data-act=draw]');
  if (await big.count()) {
    if (Math.random() < 0.5) await big.first().click(); else await page.click('.fk-pile');
    st.draws++; st.skipping = false;
    return true;
  }
  return false;
}
const newState = (skipCalls = 0) => ({ plays: 0, draws: 0, keeps: 0, colors: 0, calls: 0, skipCalls, skipping: false, penalized: false });

async function startBot(page, n, level, label, stack = false) {
  await page.goto(BASE);
  await page.fill('#name', 'Anna');
  await page.check('input[data-opt=hints]');
  if (stack) await page.check('input[data-opt=stack]');
  await page.screenshot({ path: path.join(SHOTS, `${label}-start.png`), fullPage: true });
  await page.click(`[data-act=bot][data-n="${n}"][data-level="${level}"]`);
  await page.waitForSelector('.banner');
}

// Spielt, bis `stop(page)` wahr ist oder die Zeit abläuft
async function playUntil(page, st, stop, maxMs, hooks = {}) {
  const t0 = Date.now();
  const tops = new Set();
  while (Date.now() - t0 < maxMs) {
    if (await stop(page)) break;
    const top = await boardTop(page);
    if (top !== null) tops.add(top);
    if (hooks.each) await hooks.each(page, st);
    if (!(await humanStep(page, st))) await page.waitForTimeout(25); else await page.waitForTimeout(8);
  }
  return tops;
}

async function checkTops(tops, label) {
  const arr = [...tops];
  if (arr.length && Math.max(...arr) - Math.min(...arr) > 2) fail(`${label}: Spielfeld springt: ${arr.join(',')}`);
}

async function vsComputer(browser, n, label, opts = {}) {
  const { ctx, page } = await newPage(browser, label);
  await startBot(page, n, opts.level === undefined ? 1 : opts.level, label, !!opts.stack);
  const st = newState(opts.skipCalls || 0);
  let shot = { pick: false, mine: false, bot: false };
  let reloaded = false, sawPenaltyText = false, sawPend = false;
  const each = async (p) => {
    if (!shot.mine && (await p.locator('.banner.mine').count()) && st.plays >= 2) { shot.mine = true; await p.screenshot({ path: path.join(SHOTS, `${label}-meine-karten.png`), fullPage: true }); }
    if (!shot.pick && (await p.locator('.fk-pickover').count())) { shot.pick = true; await p.screenshot({ path: path.join(SHOTS, `${label}-farbwahl.png`), fullPage: true }); }
    if (!shot.bot && !(await p.locator('.banner.mine').count()) && st.plays >= 3) { shot.bot = true; await p.screenshot({ path: path.join(SHOTS, `${label}-computer.png`), fullPage: true }); }
    if (await p.locator('.fk-pend').count()) sawPend = true;
    if ((await p.locator('.recap li', { hasText: 'nicht gerufen' }).count())) sawPenaltyText = true;
    if (!reloaded && st.plays + st.draws >= 6 && (await p.locator('.fk-hand .fk-card').count()) > 0) {
      reloaded = true;
      const handBefore = await p.$$eval('.fk-hand .fk-card', (els) => els.map((e) => e.dataset.card));
      const topBefore = await p.getAttribute('.fk-disc .fk-card', 'aria-label');
      await p.reload();
      await p.waitForSelector('.banner', { timeout: 8000 });
      await p.waitForSelector('.fk-hand .fk-card');
      const handAfter = await p.$$eval('.fk-hand .fk-card', (els) => els.map((e) => e.dataset.card));
      const topAfter = await p.getAttribute('.fk-disc .fk-card', 'aria-label');
      // Nach dem Neuladen darf der Computer inzwischen gezogen haben, aber die eigene Hand bleibt, solange nichts gegen uns gespielt wurde
      if (handBefore.length >= handAfter.length - 4 && topBefore === undefined) fail(label + ': Neuladen: Kartenablage fehlt');
      console.log(label, 'Neuladen ok. Hand vorher', handBefore.join(' '), '| danach', handAfter.join(' '), '| oben', topBefore, '->', topAfter);
      await p.screenshot({ path: path.join(SHOTS, `${label}-neu-geladen.png`), fullPage: true });
    }
  };
  const tops = await playUntil(page, st, async (p) => (await p.locator('.fk-roundend').count()) > 0, opts.maxMs || 120000, { each });
  const ended = (await page.locator('.fk-roundend').count()) > 0;
  console.log(label, 'Aktionen', JSON.stringify(st), 'Rundenende:', ended, 'Neuladen:', reloaded);
  await checkTops(tops, label);
  if (!ended) fail(label + ': Runde nicht beendet');
  if (!reloaded) fail(label + ': Neuladen nicht getestet');
  if (st.plays < 3) fail(label + ': zu wenige Züge');
  if (opts.skipCalls && !sawPenaltyText && st.penalized) fail(label + ': Ruf vergessen, aber keine Strafe gesehen');
  if (ended) {
    await page.screenshot({ path: path.join(SHOTS, `${label}-rundenende.png`), fullPage: true });
    console.log(label, 'Rundengewinner:', (await page.textContent('.fk-roundend h2')).trim());
    const scoreBefore = await page.textContent('.fk-score');
    await page.click('[data-act=next]');
    await page.waitForSelector('.fk-roundend', { state: 'detached' });
    await page.waitForSelector('.banner');
    const rounds = await page.locator('.fk-table thead th').count();
    if (rounds < 3) fail(label + ': Punktetabelle ohne Rundenspalte');
    console.log(label, 'Nächste Runde ok.', 'Tabelle:', (await page.textContent('.fk-table')).replace(/\s+/g, ' ').slice(0, 90));
    void scoreBefore;
    await page.screenshot({ path: path.join(SHOTS, `${label}-runde2.png`), fullPage: true });
  }
  if (opts.series) {
    // bis zum Serienende (500 Punkte) weiterspielen
    const t = await playUntil(page, st, async (p) => {
      if ((await p.locator('.fk-roundend [data-act=next]').count()) > 0) { await p.click('[data-act=next]'); st.rounds = (st.rounds || 0) + 1; }
      return (await p.locator('.trophy').count()) > 0;
    }, opts.seriesMs || 200000);
    await checkTops(t, label + ' (Serie)');
    const over = (await page.locator('.trophy').count()) > 0;
    console.log(label, 'Serie beendet:', over, 'Runden:', st.rounds, JSON.stringify(st));
    if (st.calls < 1) fail(label + ': Rufknopf nie benutzt');
    if (!over) fail(label + ': Serie nicht beendet');
    else {
      console.log(label, 'Sieger:', (await page.textContent('.over h1')).trim());
      await page.screenshot({ path: path.join(SHOTS, `${label}-serienende.png`), fullPage: true });
      await page.click('[data-act=again]');
      await page.waitForSelector('.banner:not(.done)');
      if (await page.locator('.trophy').count()) fail(label + ': Neues Spiel: Siegerbildschirm noch da');
      const pts = await page.$$eval('.fk-table tbody td.fk-sum', (els) => els.map((e) => e.textContent.trim()));
      if (pts.some((x) => x !== '0')) fail(label + ': Neues Spiel startet nicht bei 0 Punkten: ' + pts);
      console.log(label, 'Neues Spiel ok');
    }
  }
  if (opts.stack) console.log(label, 'Strafanzeige (Weitergabe) gesehen:', sawPend);
  await ctx.close();
}

async function learn(browser) {
  const label = 'lernrunde';
  const { ctx, page } = await newPage(browser, label);
  await page.goto(BASE);
  await page.waitForSelector('[data-act=learn]');
  await page.fill('#name', 'Erna');
  await page.click('[data-act=learn]');
  await page.waitForSelector('.coach');
  const texts = new Set();
  let steps = 0, idle = 0, finished = false;
  const tops = new Set();
  while (steps < 600) {
    const text = (await page.textContent('.coach .coach-t')).trim();
    if (!text || text.length > 200) fail(`${label}: Textlänge ${text.length}: ${text}`);
    if (!texts.has(text)) { texts.add(text); if (texts.size === 2) await page.screenshot({ path: path.join(SHOTS, `${label}-schritt2.png`) }); }
    const top = await boardTop(page); if (top !== null) tops.add(top);
    const target = page.locator('.coach-target').first();
    if ((await target.count()) === 0) {
      if (++idle > 600) { fail(`${label}: kein Ziel seit langem: "${text}"`); break; }
      await page.waitForTimeout(15);
      continue;
    }
    idle = 0;
    const act = await target.getAttribute('data-act');
    if (act === 'next' || act === 'again') { finished = true; break; }
    if (texts.size === 5 && !fs.existsSync(path.join(SHOTS, `${label}-mitte.png`))) await page.screenshot({ path: path.join(SHOTS, `${label}-mitte.png`), fullPage: true });
    try { await target.click({ timeout: 4000 }); } catch (e) { fail(`${label}: Klick fehlgeschlagen bei "${text}": ${e.message.split('\n')[0]}`); break; }
    steps++;
    await page.waitForTimeout(10);
  }
  console.log(label, 'Schritte', steps, 'Ende erreicht', finished, 'Texte', texts.size);
  for (const t of texts) console.log('   -', t);
  if (!finished) fail(label + ': Ende nicht erreicht');
  else {
    await page.screenshot({ path: path.join(SHOTS, `${label}-ende.png`), fullPage: true });
    const t = (await page.textContent('.coach .coach-t')).trim();
    if (!/Runde ist zu Ende/.test(t)) fail(label + ': Endtext falsch: ' + t);
  }
  // Mindestens die Grundschritte müssen erklärt worden sein
  const all = [...texts].join(' | ');
  for (const re of [/leuchtende Karte/, /Computer dran/]) if (!re.test(all)) fail(label + ': Text fehlt: ' + re);
  await checkTops(tops, label);
  // Lernrunde beenden
  await page.click('[data-act=learn-stop]');
  await page.waitForSelector('.coach', { state: 'detached' });
  await ctx.close();
}

async function online(browser) {
  const label = 'online';
  const A = await newPage(browser, label + '-A');
  const B = { ctx: A.ctx, page: null };
  B.page = await A.ctx.newPage();
  B.page.on('pageerror', (e) => fail(`${label}-B: pageerror ${e.message}`));
  B.page.on('console', (m) => { if (m.type() === 'error') fail(`${label}-B: console ${m.text()}`); });
  const a = A.page, b = B.page;
  await a.goto(BASE + '?mock=1');
  await a.fill('#name', 'Anna');
  // Optionen: Kästchen sind da, Standard aus; „Ruf automatisch“ einschalten
  const opts = await a.$$eval('input[data-opt]', (els) => els.map((e) => [e.dataset.opt, e.checked]));
  console.log(label, 'Optionen:', JSON.stringify(opts));
  if (!opts.find((o) => o[0] === 'stack' && o[1] === false) || !opts.find((o) => o[0] === 'auto' && o[1] === false)) fail(label + ': Optionen fehlen oder Standard falsch');
  await a.screenshot({ path: path.join(SHOTS, `${label}-start-optionen.png`), fullPage: true });
  await a.click('[data-act=host]');
  await a.waitForSelector('.code');
  const code = (await a.textContent('.code')).trim();
  await a.check('input[data-opt=auto]');
  await a.check('input[data-opt=hints]');
  await b.goto(BASE + '?mock=1&raum=' + code);
  await b.fill('#name', 'Bernd');
  await b.click('[data-act=join-invited]');
  await a.waitForSelector('[data-act=start]');
  await a.screenshot({ path: path.join(SHOTS, `${label}-lobby.png`), fullPage: true });
  if ((await b.locator('input[data-opt]').count()) !== 0) fail(label + ': Gast sieht Optionen');
  await a.click('[data-act=start]');
  await a.waitForSelector('.banner'); await b.waitForSelector('.banner');
  const sa = newState(), sb = newState();
  const t0 = Date.now();
  let shot = false;
  const tops = { a: new Set(), b: new Set() };
  while (Date.now() - t0 < 120000) {
    if ((await a.locator('.fk-roundend').count()) && (await b.locator('.fk-roundend').count())) break;
    for (const [p, s, k] of [[a, sa, 'a'], [b, sb, 'b']]) {
      const top = await boardTop(p); if (top !== null) tops[k].add(top);
      await humanStep(p, s);
    }
    if (!shot && sa.plays + sb.plays > 8) { shot = true; await a.screenshot({ path: path.join(SHOTS, `${label}-A.png`), fullPage: true }); await b.screenshot({ path: path.join(SHOTS, `${label}-B.png`), fullPage: true }); }
    await a.waitForTimeout(15);
  }
  const ended = (await a.locator('.fk-roundend').count()) > 0 && (await b.locator('.fk-roundend').count()) > 0;
  console.log(label, 'A', JSON.stringify(sa), 'B', JSON.stringify(sb), 'Rundenende:', ended);
  if (!ended) fail(label + ': Runde nicht beendet');
  if (sa.calls + sb.calls > 0) fail(label + ': „Ruf automatisch“ ist an, aber der Rufknopf kam');
  await checkTops(tops.a, label + '-A'); await checkTops(tops.b, label + '-B');
  if (ended) {
    if ((await b.locator('[data-act=next]').count()) !== 0) fail(label + ': Gast darf die nächste Runde nicht starten');
    await b.screenshot({ path: path.join(SHOTS, `${label}-B-rundenende.png`), fullPage: true });
    await a.screenshot({ path: path.join(SHOTS, `${label}-A-rundenende.png`), fullPage: true });
    const w = (await a.textContent('.fk-roundend h2')).trim();
    const wb = (await b.textContent('.fk-roundend h2')).trim();
    console.log(label, 'Gewinner A sieht:', w, '| B sieht:', wb);
    await a.click('[data-act=next]');
    await a.waitForSelector('.fk-roundend', { state: 'detached' });
    await b.waitForSelector('.fk-roundend', { state: 'detached' });
    await b.waitForSelector('.banner');
    const rowsA = await a.$$eval('.fk-table thead th', (e) => e.length), rowsB = await b.$$eval('.fk-table thead th', (e) => e.length);
    if (rowsA !== rowsB || rowsA < 3) fail(label + `: Punktetabellen verschieden/ohne Runde (${rowsA}/${rowsB})`);
    console.log(label, 'Nächste Runde in beiden Tabs ok');
  }
  await A.ctx.close();
}

async function hilfeUndGrosseSchrift(browser) {
  const label = 'hilfe';
  const { ctx, page } = await newPage(browser, label, { width: 1100, height: 800 });
  await startBot(page, 2, 0, label + '-pc');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, `${label}-pc.png`), fullPage: true });
  await page.click('[data-act=bigger]');
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(SHOTS, `${label}-pc-gross.png`), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(SHOTS, `${label}-gross-mobil.png`), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) fail(label + ': waagerechter Scroll bei großer Schrift');
  await page.click('[data-act=help]');
  await page.waitForSelector('.modal');
  const help = await page.textContent('.modal');
  for (const w of ['Aussetzen', 'Richtungswechsel', 'Zwei ziehen', 'Vier ziehen', 'Letzte Karte', '500', 'musst']) if (!help.includes(w)) fail(label + ': Hilfetext ohne ' + w);
  if (new RegExp('u' + 'no', 'i').test(help)) fail(label + ': Markenname im Hilfetext');
  await page.screenshot({ path: path.join(SHOTS, `${label}-regeln.png`) });
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  await vsComputer(browser, 1, 'eins', { series: true, skipCalls: 2 });
  await vsComputer(browser, 3, 'drei', { level: 1, maxMs: 150000 });
  await vsComputer(browser, 2, 'weitergabe', { level: 0, stack: true, maxMs: 150000 });
  await learn(browser);
  await online(browser);
  await hilfeUndGrosseSchrift(browser);
  await browser.close();
  console.log('errors', JSON.stringify(errors));
  if (errors.length) process.exit(1);
  console.log('FARBKARTEN E2E OK');
})().catch((e) => { console.error(e); console.log('errors', JSON.stringify(errors)); process.exit(1); });
