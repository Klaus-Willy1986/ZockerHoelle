// Durchspieltest: NODE_PATH=$(npm root -g) node tests/farben.e2e.cjs [2|3|s]  (Server auf Port 8776 nötig)
const { chromium } = require('playwright');
const path = require('path');
const PORT = process.env.PORT || 8776;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
const base = `http://localhost:${PORT}/farben/index.html`;

let seed = 11;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const errors = [];
const watch = (p, n) => {
  p.on('pageerror', (e) => errors.push(n + ' pageerror ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(n + ' console ' + m.text()); });
  p.on('dialog', (d) => d.accept());
};
const shots = new Set();
async function snap(p, name) {
  if (shots.has(name)) return;
  shots.add(name);
  await p.screenshot({ path: path.join(SHOTS, `fw_${name}.png`), fullPage: true });
}

// Eine Person wählt Würfel und Felder (zielstrebig: große Zahlen bevorzugt). Gibt true zurück, wenn etwas getan wurde.
async function step(page, tag, stats) {
  if (await page.$('.trophy')) return false;
  if (await page.$('[data-act=roll]')) {
    await page.click('[data-act=roll]');
    await page.waitForSelector('[data-act=roll]', { state: 'detached' }).catch(() => {});
    return true;
  }
  if (!(await page.$('[data-act=die]'))) return false;
  for (let attempt = 0; attempt < 8; attempt++) {
    const cdice = await page.$$eval('[data-act=die][data-kind=c]:not([disabled])', (e) => e.map((x) => ({ i: x.dataset.i, joker: x.getAttribute('aria-label').includes('Joker') })));
    const ndice = await page.$$eval('[data-act=die][data-kind=n]:not([disabled])', (e) => e.map((x) => ({ i: x.dataset.i, joker: x.getAttribute('aria-label').includes('Joker'), v: Number((x.getAttribute('aria-label').match(/Zahlenwürfel (\d)/) || [0, 0])[1]) })));
    if (!cdice.length || !ndice.length) break;
    const normal = cdice.filter((d) => !d.joker);
    const c = normal.length && rnd() < 0.8 ? normal[Math.floor(rnd() * normal.length)] : cdice[Math.floor(rnd() * cdice.length)];
    await page.click(`[data-act=die][data-kind=c][data-i="${c.i}"]`);
    if (await page.$('.fw-ask')) {
      const opts = await page.$$eval('[data-act=joker-pick]:not([disabled])', (e) => e.map((x) => x.dataset.v));
      if (!opts.length) { await page.click('[data-act=joker-cancel]'); continue; }
      if (stats) stats.jokers++;
      await snap(page, `${tag}_joker`);
      await page.click(`[data-act=joker-pick][data-v="${opts[Math.floor(rnd() * opts.length)]}"]`);
    }
    const sorted = [...ndice].sort((a, b) => (b.joker ? 5 : b.v) - (a.joker ? 5 : a.v));
    const n = sorted.find((d) => !d.joker) && rnd() < 0.85 ? sorted.find((d) => !d.joker) : sorted[0];
    const nBtn = await page.$(`[data-act=die][data-kind=n][data-i="${n.i}"]:not([disabled])`);
    if (!nBtn) { await page.click(`[data-act=die][data-kind=c][data-i="${c.i}"]`); continue; }
    await nBtn.click();
    if (await page.$('.fw-ask')) {
      const opts = await page.$$eval('[data-act=joker-pick]:not([disabled])', (e) => e.map((x) => Number(x.dataset.v)));
      if (!opts.length) { await page.click('[data-act=joker-cancel]'); await page.click(`[data-act=die][data-kind=c][data-i="${c.i}"]`); continue; }
      await page.click(`[data-act=joker-pick][data-v="${Math.max(...opts)}"]`);
    }
    if (await page.$('.confirm.bad')) {
      await snap(page, `${tag}_nothing`);
      await page.click('[data-act=reset-dice]');
      continue;
    }
    await snap(page, `${tag}_cells`);
    let first = true;
    for (let k = 0; k < 8 && !(await page.$('[data-act=confirm]')); k++) {
      const opts = await page.$$('.fw-cell.opt');
      if (!opts.length) throw new Error(tag + ': keine erlaubten Felder, aber keine Bestätigung');
      await opts[Math.floor(rnd() * opts.length)].click();
      if (first) {
        first = false;
        // Auswahl wieder abwählen und neu wählen (Test der Rücknahme)
        if (rnd() < 0.3 && (await page.$('.fw-cell.sel'))) await page.click('.fw-cell.sel');
      }
    }
    if (!(await page.$('[data-act=confirm]'))) throw new Error(tag + ': keine Bestätigung');
    await snap(page, `${tag}_confirm`);
    await page.click('[data-act=confirm]');
    return true;
  }
  // nichts Passendes gefunden: passen
  if (await page.$('[data-act=pass]')) {
    await page.click('[data-act=pass]');
    if (rnd() < 0.5) { await snap(page, `${tag}_pass`); await page.click('[data-act=pass-no]'); await page.click('[data-act=pass]'); }
    await page.click('[data-act=pass-yes]');
    return true;
  }
  return false;
}

async function playAll(pages, tag, stats) {
  let idle = 0;
  for (let guard = 0; guard < 4000; guard++) {
    if (await pages[0].$('.trophy')) break;
    let did = false;
    for (const p of pages) { if (await step(p, tag, stats)) did = true; }
    if (!did) { await pages[0].waitForTimeout(120); if (++idle > 200) throw new Error(tag + ': hängt'); } else idle = 0;
    if (guard % 40 === 0) { await pages[0].waitForTimeout(80); if (process.env.VERBOSE) console.log(tag, 'Runde', guard, (await pages[0].textContent('.banner').catch(() => '')).trim()); }
  }
}

async function multi(browser, n, vp, tag) {
  const ctx = await browser.newContext({ viewport: vp });
  const names = ['Anna', 'Bernd', 'Clara', 'Dieter'].slice(0, n);
  const pages = [];
  const A = await ctx.newPage(); watch(A, tag + 'A');
  await A.goto(base + '?mock=1');
  await A.fill('input', names[0]);
  await A.click('[data-act=host]');
  await A.waitForSelector('.code');
  const code = (await A.textContent('.code')).trim();
  pages.push(A);
  for (let i = 1; i < n; i++) {
    const P = await ctx.newPage(); watch(P, tag + i);
    await P.goto(base + '?mock=1&raum=' + code);
    await P.fill('input', names[i]);
    await P.click('[data-act=join-invited]');
    pages.push(P);
  }
  await A.waitForSelector('[data-act=start]');
  await A.click('[data-act=start]');
  await A.waitForSelector('.banner');
  await snap(A, `${tag}_start`);
  await snap(pages[1], `${tag}_start_guest`);
  const stats = { jokers: 0 };
  await playAll(pages, tag, stats);
  for (const p of pages) await p.waitForSelector('.trophy');
  console.log(tag, 'Sieger:', (await A.textContent('.over h1')).trim());
  console.log(tag, 'Rangliste:', (await A.$$eval('.ranking .rn, .ranking .rt', (e) => e.map((x) => x.textContent))).join(' | '));
  console.log(tag, 'Joker-Einsätze im Test:', stats.jokers);
  await snap(A, `${tag}_over`); await snap(pages[1], `${tag}_over_guest`);
  if (await pages[1].$('[data-act=again]')) errors.push(tag + ' Gast sieht again-Knopf');
  await A.click('[data-act=again]');
  await A.waitForSelector('.trophy', { state: 'detached' });
  for (const p of pages) await p.waitForSelector('.banner:not(.done)');
  console.log(tag, 'Neustart ok');
  await A.click('[data-act=help]');
  await A.waitForSelector('.modal');
  await snap(A, `${tag}_help`);
  await A.click('.modal [data-act=help-close]');
  await ctx.close();
}

async function solo(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const A = await ctx.newPage(); watch(A, 'solo');
  await A.goto(base);
  await A.fill('input', 'Anna');
  await snap(A, 'solo_start');
  await A.click('[data-act=solo]');
  await A.waitForSelector('[data-act=roll]');
  await snap(A, 'solo_roll');
  const stats = { jokers: 0 };
  await playAll([A], 'solo', stats);
  await A.waitForSelector('.trophy');
  console.log('solo Ergebnis:', (await A.textContent('.over')).replace(/\s+/g, ' ').slice(0, 260));
  await snap(A, 'solo_over');
  console.log('Bestleistung gespeichert:', await A.evaluate(() => localStorage.getItem('zh.fw_best')));
  await A.click('[data-act=again]');
  await A.waitForSelector('[data-act=roll]');
  console.log('solo Neustart ok');
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  const only = process.argv[2];
  if (!only || only === '2') await multi(browser, 2, { width: 390, height: 844 }, '2p');
  if (!only || only === '3') await multi(browser, 3, { width: 1280, height: 900 }, '3p');
  if (!only || only === 's') await solo(browser);
  console.log('errors', errors);
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FEHLER', e); process.exit(2); });
