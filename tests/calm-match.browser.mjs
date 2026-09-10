import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { findMove } from '../src/games/calm-match/model.js';
const base = process.env.TEST_URL || 'http://127.0.0.1:5174';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/games/calm-match`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('.match-cell').count(), 30);
    await page.locator('.has-jelly-renderer').waitFor({ timeout: 60000 });
    await page.evaluate(() => {
      window.__jellyPhases = [];
      const canvas = document.querySelector('.jelly-board-canvas');
      new MutationObserver(() => window.__jellyPhases.push(canvas.dataset.phase))
        .observe(canvas, { attributes: true, attributeFilter: ['data-phase'] });
    });
    await page.screenshot({ path: `artifacts/calm-match-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
    const getState = () => page.evaluate(() => JSON.parse(localStorage.getItem('softie:calm-match:v1')));
    const path = findMove((await getState()).board);
    const points = [];
    for (const i of path) {
      const r = await page.locator(`[data-cell="${i}"]`).boundingBox();
      points.push({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    }
    if (mobile) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...points[0], id: 1 }] });
      for (const p of points.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...p, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(points[0].x, points[0].y); await page.mouse.down();
      for (const p of points.slice(1)) await page.mouse.move(p.x, p.y, { steps: 8 });
      await page.mouse.up();
    }
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('softie:calm-match:v1')).cleared >= 3);
    await page.waitForFunction(() => ['gather', 'bubbles', 'fall'].every(phase => window.__jellyPhases.includes(phase)));
    const after = await getState();
    await page.reload({ waitUntil: 'networkidle' });
    assert.deepEqual(await getState(), after);
    await page.locator('.game-sound').click();
    await page.locator('.game-hint').click();
    assert.equal(await page.locator('.hinted').count(), 3);
    await page.locator('.game-restart').click();
    await page.locator('.cancel-reset').click();
    assert.equal((await getState()).cleared, after.cleared);
    await page.evaluate(() => {
      const key = 'softie:calm-match:v1'; const s = JSON.parse(localStorage.getItem(key)); s.cleared = 89; s.board[0] = s.board[1] = s.board[2] = 0; localStorage.setItem(key, JSON.stringify(s));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-cell="0"]').focus();
    await page.keyboard.press('Space'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Space'); await page.keyboard.press('Enter');
    await page.locator('.game-win[open]').waitFor();
    assert.equal((await getState()).cleared, 90);
    await page.waitForTimeout(850);
    await page.locator('.game-again').click();
    assert.equal((await getState()).cleared, 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`PASS ${mobile ? 'touch' : 'mouse'}: clear, restore, hint, sound, reset confirmation, keyboard win, replay`);
    await context.close();
  }
} finally { await browser.close(); }
