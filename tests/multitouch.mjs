import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TEST_URL ?? 'http://127.0.0.1:5174', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__SOFTIE__?.getDiagnostics().frames > 10);
  await page.locator('#stage[aria-busy="false"]').waitFor();
  await page.waitForFunction(() => {
    const p = window.__SOFTIE__.getDiagnostics().physics.position;
    return p.x === 0 && p.y === 0;
  }, null, { timeout: 60000 });
  const center = await page.evaluate(() => {
    const { slime, camera } = window.__SOFTIE__;
    const rect = document.querySelector('#slime-canvas').getBoundingClientRect();
    slime.body.geometry.computeBoundingBox();
    const p = slime.body.position.clone();
    slime.body.geometry.boundingBox.getCenter(p);
    slime.body.updateWorldMatrix(true, false);
    p.applyMatrix4(slime.body.matrixWorld).project(camera);
    return { x: rect.x + (p.x + 1) * rect.width / 2, y: rect.y + (1 - p.y) * rect.height / 2 };
  });
  const cdp = await context.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id, x, y]) => ({ id, x, y, radiusX: 5, radiusY: 5, force: 1 })) });
  const state = () => page.evaluate(() => window.__SOFTIE__.getDiagnostics().physics);
  const { x, y } = center;
  await page.screenshot({ path: 'artifacts/multitouch-rest.png' });
  await touch('touchStart', [[1, x - 24, y]]);
  assert.equal((await state()).dragging, true, 'single touch grabs the body');
  await touch('touchStart', [[1, x - 24, y], [2, x + 24, y]]);
  assert.equal((await state()).pinching, true, 'second touch starts pinch');
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', [[1, x - 24 - i * 3, y], [2, x + 24 + i * 3, y]]);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(250);
  assert.ok((await state()).modes.pinch > 0.4, 'spreading fingers stretches');
  await page.screenshot({ path: 'artifacts/multitouch-stretch.png' });
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', [[1, x - 60 + i * 4, y], [2, x + 60 - i * 4, y]]);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(250);
  assert.ok((await state()).modes.pinch < -0.3, 'closing fingers compresses');
  await page.screenshot({ path: 'artifacts/multitouch-pinch.png' });
  // CDP touchEnd lists the finger being removed, not the remaining contacts.
  await touch('touchEnd', [[1, x - 12, y]]);
  assert.equal((await state()).pinching, false);
  assert.equal((await state()).dragging, true, 'remaining finger keeps its grab');
  await touch('touchMove', [[2, x + 12, y - 50]]);
  await page.waitForFunction(() => window.__SOFTIE__.physics.position.y > 0.1, null, { timeout: 10000 });
  assert.ok((await state()).position.y > 0.1, 'remaining finger can lift');
  await touch('touchEnd', []);
  assert.equal((await state()).dragging, false);
  await page.waitForFunction(() => window.__SOFTIE__.getDiagnostics().physics.deformation < 0.002, null, { timeout: 30000 });
  assert.ok((await state()).deformation < 0.002, 'release settles');
  await page.evaluate(() => window.__SOFTIE__.physics.reset());
  await page.waitForTimeout(100);
  await touch('touchStart', [[1, x - 24, y]]);
  await touch('touchStart', [[1, x - 24, y], [2, x + 24, y]]);
  assert.equal((await state()).pinching, true);
  await touch('touchCancel', []);
  assert.equal((await state()).pinching, false, 'cancellation clears both fingers');
  assert.equal((await state()).dragging, false);
  assert.equal(await page.evaluate(() => visualViewport.scale), 1, 'gesture does not zoom the page');
  assert.deepEqual(errors, []);
  console.log('PASS mobile: stretch, pinch, single-finger handoff, lift, rebound, cancel, no page zoom');
} finally {
  await browser.close();
}
