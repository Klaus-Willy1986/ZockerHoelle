// Durchspieltest: NODE_PATH=$(npm root -g) node tests/pasch.e2e.cjs  (Server auf Port 8771 nötig)
const { chromium } = require('playwright');
const path = require('path');
const PORT = process.env.PORT || 8771;
const SHOTS = process.env.SHOTS || '/tmp/claude-0/-home-user/072b0539-c7e6-5aa0-940c-0f332ae5edb3/scratchpad';
const base = `http://localhost:${PORT}/pasch/index.html?mock=1`;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const watch = (p, n) => {
    p.on('pageerror', (e) => errors.push(n + ' pageerror ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(n + ' console ' + m.text()); });
  };
  const A = await ctx.newPage(); watch(A, 'A');
  await A.goto(base);
  await A.fill('input', 'Anna');
  await A.click('[data-act=host]');
  await A.waitForSelector('.code');
  const code = (await A.textContent('.code')).trim();
  const B = await ctx.newPage(); watch(B, 'B');
  await B.goto(base + '&raum=' + code);
  await B.fill('input', 'Bernd');
  await B.click('[data-act=join-invited]');
  await A.waitForSelector('[data-act=start]:not([disabled])');
  await A.click('[data-act=start]');

  let shot = 0;
  const snap = async (p, name) => p.screenshot({ path: path.join(SHOTS, `pasch_${name}.png`), fullPage: true });
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  async function takeTurn(me, other, turnNo) {
    await me.click('[data-act=roll]');
    await me.waitForSelector('[data-act=toggle]');
    await me.waitForFunction(() => !document.body.innerText.includes('rollen …'));
    if (turnNo === 0) { await snap(me, 'mine_roll1'); await snap(other, 'other_roll1'); }
    const extra = Math.floor(rnd() * 3);
    for (let k = 0; k < extra; k++) {
      if (!(await me.$('[data-act=toggle]'))) break;
      for (let i = 0; i < 5; i++) if (rnd() < 0.5) await me.click(`[data-act=toggle][data-i="${i}"]`);
      if (await me.$('[data-act=reroll][disabled]')) await me.click('[data-act=toggle][data-i="0"]');
      if (turnNo === 1 && k === 0) await snap(me, 'mine_keep');
      await me.click('[data-act=reroll]');
      await me.waitForFunction(() => !document.body.innerText.includes('rollen …'));
    }
    const cats = await me.$$eval('[data-act=pick]', (els) => els.map((e) => e.dataset.cat));
    if (!cats.length) throw new Error('keine freien Felder');
    const cat = cats[Math.floor(rnd() * cats.length)];
    await me.click(`[data-act=pick][data-cat=${cat}]`);
    if (turnNo === 2) await snap(me, 'mine_confirm');
    await me.click('[data-act=pick-no]');
    await me.click(`[data-act=pick][data-cat=${cat}]`);
    await me.click('[data-act=pick-yes]');
  }

  let turns = 0;
  for (let guard = 0; guard < 200; guard++) {
    if (await A.$('.trophy')) break;
    const mine = (await A.$('.banner.mine')) ? A : (await B.$('.banner.mine')) ? B : null;
    if (!mine) { await A.waitForTimeout(150); continue; }
    const other = mine === A ? B : A;
    await takeTurn(mine, other, turns);
    turns++;
    // Warten, bis der Zug bei beiden angekommen ist
    await A.waitForTimeout(250);
  }
  await A.waitForSelector('.trophy'); await B.waitForSelector('.trophy');
  console.log('Züge:', turns);
  console.log('Sieger:', (await A.textContent('.over h1')).trim());
  console.log('Rangliste:', (await A.$$eval('.ranking .rn, .ranking .rt', (e) => e.map((x) => x.textContent))).join(' | '));
  await snap(A, 'over_host'); await snap(B, 'over_guest');
  if (await B.$('[data-act=again]')) errors.push('Gast sieht again-Knopf');
  await A.click('[data-act=again]');
  await A.waitForSelector('.banner:not(.done)'); await B.waitForSelector('.banner:not(.done)'); await A.waitForSelector('[data-act=roll], .banner:not(.mine)');
  console.log('Neustart ok:', !(await A.$('.trophy')) && !(await B.$('.trophy')));
  await A.click('[data-act=help]');
  await A.waitForSelector('.modal');
  await A.screenshot({ path: path.join(SHOTS, 'pasch_help.png') });
  console.log('errors', errors);
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('FEHLER', e); process.exit(2); });
