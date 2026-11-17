// Mobile smoke test: plays on an emulated phone using touch input only — no
// keyboard, no mouse. Starts a game, opens every menu from the bottom bar,
// then crafts a sword through every stage, in portrait and in landscape.
// Along the way it checks that the buttons a player must press are on screen
// and finger-sized.
//
//   npm run build && node scripts/e2e-mobile.mjs [outdir]
//
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || 'test-results/mobile';
mkdirSync(out, { recursive: true });
const PORT = 5289;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const stopServer = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); } };
await new Promise((r) => setTimeout(r, 2500));
const url = `http://localhost:${PORT}/`;
const log = (...a) => console.log('[mobile]', ...a);
const errors = [];
const MIN_TARGET = 40; // CSS px; anything a finger must hit

const browser = await chromium.launch();

async function run(name, device) {
  const context = await browser.newContext({ ...devices[device] });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const vp = page.viewportSize();
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  const shot = (n) => page.screenshot({ path: `${out}/${name}-${n}.png` });
  const sleep = (ms) => page.waitForTimeout(ms);
  const fail = (msg) => errors.push(`${name}: ${msg}`);

  /** Tap an element by touch, after checking it is on screen and big enough for a finger. */
  async function tap(selector, what = selector) {
    const loc = page.locator(selector).first();
    await loc.waitFor({ state: 'visible', timeout: 8000 });
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const b = await loc.boundingBox();
    if (!b) return fail(`${what} has no box`);
    if (b.x < -1 || b.y < -1 || b.x + b.width > vp.width + 1 || b.y + b.height > vp.height + 1) fail(`${what} is outside the screen (${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)} in ${vp.width}x${vp.height})`);
    if (b.height < MIN_TARGET - 0.5) fail(`${what} is only ${Math.round(b.height)}px tall`);
    await loc.tap();
  }
  async function drag(x0, y0, x1, y1) {
    const pt = (x, y) => [{ x, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0, y0) });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * i) / 6) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await sleep(600);
  await shot('01-title');
  await tap('button:has-text("Open the workshop")');
  await sleep(700);
  await tap('button:has-text("Light the forge")');
  await sleep(1000);
  await shot('02-workshop');
  await page.evaluate(() => {
    const app = window.__app;
    app.state.gold = 500;
    for (const m of ['iron', 'brass', 'oak']) app.state.materials[m] = (app.state.materials[m] ?? 0) + 8;
    app.refresh();
  });

  // nothing may make the page itself scroll sideways
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) fail(`page is ${overflow}px wider than the screen`);

  // every menu opens from the bottom bar and closes again
  for (const label of ['Materials', 'Journal', 'Collection', 'Village', 'Workshop', 'Settings']) {
    await tap(`.hud .menu button[aria-label="${label}"]`, `menu button ${label}`);
    await sleep(350);
    await shot(`03-${label.toLowerCase()}`);
    await tap('.overlay .panel-head button[aria-label="Close"]', `close button of ${label}`);
    await sleep(250);
  }

  // tapping a station walks there and uses it
  await page.touchscreen.tap(vp.width / 2, vp.height / 2);
  await sleep(1500);
  if (await page.locator('.overlay').count()) { await shot('03b-station'); await tap('.overlay .panel-head button[aria-label="Close"]', 'close button of a station panel'); await sleep(250); }

  // craft a sword by touch alone
  await tap('.hud .menu button[aria-label="Craft"]', 'menu button Craft');
  await sleep(400);
  await shot('04-newpiece');
  await page.locator('.panel .card:has-text("Sword")').first().tap();
  await page.locator('.panel .card:has-text("Traditional Foundry")').first().tap();
  await tap('button:has-text("Light the forge")');
  await sleep(600);
  await shot('05-craft-design');
  const t0 = Date.now();
  let shots = 0, games = 0, lastStage = '';
  while (Date.now() - t0 < 420000) {
    if (await page.locator('text=Admire & close').count()) break;
    const cont = page.locator('.result-card button:has-text("Continue")');
    if (await cont.count()) { await tap('.result-card button:has-text("Continue")', 'Continue'); await sleep(300); continue; }
    const begin = page.locator('.result-card button:has-text("Begin")');
    if (await begin.count()) { if (games++ < 3) await shot(`06-instructions-${games}`); await tap('.result-card button:has-text("Begin")', 'Begin'); await sleep(300); continue; }
    const mg = page.locator('canvas.mg');
    if (await mg.count()) {
      const box = await mg.first().boundingBox().catch(() => null);
      if (!box) { await sleep(100); continue; }
      if (box.x < -1 || box.x + box.width > vp.width + 1 || box.y + box.height > vp.height + 1) fail(`minigame canvas is cut off (${JSON.stringify(box)})`);
      const stage = await page.locator('.step.cur').first().innerText().catch(() => '');
      if (stage !== lastStage) { lastStage = stage; await sleep(400); await shot(`07-mg-${shots++}`); }
      const fx = (x) => box.x + (x / 480) * box.width, fy = (y) => box.y + (y / 270) * box.height;
      const r = Math.random();
      if (r < 0.4) await page.touchscreen.tap(fx(120 + Math.random() * 240), fy(70 + Math.random() * 130));
      else if (r < 0.75) { const x = 100 + Math.random() * 280, y = 70 + Math.random() * 130; await drag(fx(x), fy(y), fx(x + (Math.random() - 0.5) * 120), fy(y + (Math.random() - 0.5) * 70)); }
      else if (Date.now() - t0 > 8000) await page.touchscreen.tap(fx(436), fy(242)); // the Done / Seat / Finish corner
      await sleep(70);
      continue;
    }
    const go = page.locator('.craft-side .panel-foot button.primary:not([disabled])');
    if (await go.count()) { await tap('.craft-side .panel-foot button.primary:not([disabled])', 'stage Continue/Begin button'); await sleep(350); continue; }
    await sleep(200);
  }
  if (!(await page.locator('text=Admire & close').count())) { await shot('99-stuck'); fail('crafting did not finish by touch'); }
  else {
    await sleep(600);
    await shot('08-appraisal');
    await tap('button:has-text("Admire & close")');
    await sleep(300);
    const n = await page.evaluate(() => window.__app.state.items.length);
    if (n !== 1) fail(`expected 1 finished piece, found ${n}`);
    log(name, 'crafted a sword by touch in', Math.round((Date.now() - t0) / 1000), 's');
  }
  await context.close();
}

try {
  for (const [name, device] of [['portrait', 'iPhone 13'], ['landscape', 'iPhone 13 landscape'], ['small', 'Galaxy S9+']]) {
    if (process.env.ONLY && !process.env.ONLY.split(',').includes(name)) continue;
    log('running', name, device);
    await run(name, device);
  }
} catch (e) {
  errors.push(String((e && e.stack) || e));
} finally {
  await browser.close();
  stopServer();
}
if (errors.length) { console.error('[mobile] ERRORS:\n' + [...new Set(errors)].join('\n')); process.exit(1); }
log('PASS');
process.exit(0);
