// End-to-end smoke test: boots the real game in Chromium, starts a new game,
// visits every screen, crafts complete pieces through every stage by driving
// the minigames with real keyboard/pointer input, then reloads and verifies
// the finished items were persisted and reproduce identically.
//
//   npm run build && node scripts/e2e.mjs [outdir]
//
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || 'test-results';
mkdirSync(out, { recursive: true });
const PORT = 5287;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const url = `http://localhost:${PORT}/`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const sleep = (ms) => page.waitForTimeout(ms);
const log = (...a) => console.log('[e2e]', ...a);

try {
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await shot('01-title');
  await page.click('text=Open the workshop');
  await sleep(800);
  await page.click('text=Light the forge');
  await sleep(1200);
  await shot('02-workshop');

  // Give ourselves enough gold & materials to test every system quickly.
  await page.evaluate(() => {
    const app = window.__app;
    app.state.gold = 2000;
    app.state.reputation = 40;
    for (const m of ['iron', 'brass', 'silver', 'dragonsteel', 'starmetal', 'moonstone', 'gardenglass', 'walnut', 'garnet', 'riverstone', 'slate']) app.state.materials[m] = (app.state.materials[m] ?? 0) + 8;
    app.state.upgrades.push('smallanvil', 'shieldframe', 'loupe', 'bellows', 'wheel', 'gemsetter', 'finebench', 'collectionroom');
    app.state.journals.push('journal_folds', 'journal_tinkerer');
    app.refresh();
  });

  for (const [key, name] of [['KeyV', 'village'], ['KeyJ', 'journal'], ['KeyI', 'inventory'], ['KeyU', 'workshop'], ['KeyC', 'collection']]) {
    await page.keyboard.press(key);
    await sleep(500);
    await shot(`03-${name}`);
    await page.keyboard.press('Escape');
    await sleep(300);
  }

  async function craft(category, tradition, tag) {
    log('crafting', category, tradition);
    await page.keyboard.press('KeyF');
    await sleep(500);
    await page.click(`.panel .card:has-text("${category}")`);
    await page.click(`.panel .card:has-text("${tradition}")`);
    await page.click('text=Light the forge');
    await sleep(600);
    const t0 = Date.now();
    let shots = 0;
    while (Date.now() - t0 < 420000) {
      if (await page.locator('text=Admire & close').count()) break;
      const cont = page.locator('.result-card button:has-text("Continue")');
      if (await cont.count()) { await cont.first().click(); await sleep(300); continue; }
      const begin = page.locator('.result-card button:has-text("Begin")');
      if (await begin.count()) { await begin.first().click(); await sleep(300); continue; }
      const mg = page.locator('canvas.mg');
      if (await mg.count()) {
        if (shots < 12 && Math.random() < 0.08) await shot(`${tag}-mg-${shots++}`);
        const box = await mg.boundingBox();
        // Mixed input: taps, holds, sweeps, keys — enough to complete any minigame.
        const r = Math.random();
        if (box && r < 0.35) {
          const x = box.x + box.width * (0.2 + Math.random() * 0.6), y = box.y + box.height * (0.2 + Math.random() * 0.6);
          await page.mouse.move(x, y); await page.mouse.down();
          await page.mouse.move(x + (Math.random() - 0.5) * 120, y + (Math.random() - 0.5) * 80, { steps: 6 });
          await page.mouse.up();
        } else if (r < 0.6) await page.keyboard.press('Space');
        else if (r < 0.7) { await page.keyboard.down('Space'); await sleep(250); await page.keyboard.up('Space'); }
        else if (r < 0.8) await page.keyboard.press(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyQ', 'KeyE', 'Tab'][Math.floor(Math.random() * 7)]);
        else if (r < 0.88 && Date.now() - t0 > 30000) await page.keyboard.press('Enter');
        else await page.keyboard.press('Space');
        await sleep(60);
        continue;
      }
      const go = page.locator('.craft-side .panel-foot button.primary');
      if (await go.count()) {
        if (shots < 12) await shot(`${tag}-stage-${shots++}`);
        await go.first().click();
        await sleep(350);
        continue;
      }
      await sleep(200);
    }
    if (!(await page.locator('text=Admire & close').count())) throw new Error(`crafting ${tradition} did not finish`);
    await sleep(700);
    await shot(`${tag}-appraisal`);
    await page.click('text=Admire & close');
    await sleep(400);
  }

  await craft('Sword', 'Traditional Foundry', '10-foundry');
  const crafted = [['Dagger', 'Patternwrights', '11-pattern'], ['Shield', 'Mountain', '12-mountain'], ['Sword', 'Celestial', '13-celestial'], ['Dagger', 'Glassgarden', '14-glass'], ['Sword', 'Experimental', '15-exp']];
  for (const c of (process.env.QUICK ? [] : crafted)) await craft(...c);

  const before = await page.evaluate(() => window.__app.state.items.map((i) => ({ id: i.id, craft: i.stats.craftsmanship, name: i.name })));
  log('items', JSON.stringify(before));
  await page.keyboard.press('KeyC');
  await sleep(600);
  await shot('20-collection');
  await page.keyboard.press('Escape');
  await page.reload();
  await sleep(800);
  await page.click('text=Continue');
  await sleep(1200);
  const after = await page.evaluate(() => window.__app.state.items.map((i) => ({ id: i.id, craft: i.stats.craftsmanship, name: i.name })));
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('items changed after reload');
  await shot('21-after-reload');
  log('reload OK —', after.length, 'items persisted');
} catch (e) {
  errors.push(String(e && e.stack || e));
  await shot('99-failure').catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.error('[e2e] ERRORS:\n' + errors.join('\n')); process.exit(1); }
log('PASS');
