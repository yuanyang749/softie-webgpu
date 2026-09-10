import test from 'node:test';
import assert from 'node:assert/strict';
import { JellyPhysics } from '../src/physics.js';

function advance(jelly, seconds, dt = 1 / 60) {
  for (let i = 0; i < Math.round(seconds / dt); i++) jelly.update(dt);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

const point = { x: 0.65, y: 1.15, z: 0.96 };

test('two-finger stretch and pinch deform along the grab axis and spring back', () => {
  for (const ratio of [0.5, 2]) {
    for (const axis of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }]) {
      const jelly = new JellyPhysics();
      jelly.beginPinch(axis);
      jelly.movePinch(ratio);
      advance(jelly, 0.5);
      const length = Math.hypot(axis.x, axis.y);
      const a = jelly.deform(-axis.x * 0.4 / length, 1.08 - axis.y * 0.4 / length, 0, {});
      const b = jelly.deform(axis.x * 0.4 / length, 1.08 + axis.y * 0.4 / length, 0, {});
      assert.ok(ratio > 1 ? distance(a, b) > 1.2 : distance(a, b) < 0.6);
      assert.equal(jelly.diagnostics.pinching, true);
      jelly.endGrab();
      advance(jelly, 4);
      assert.equal(jelly.diagnostics.pinching, false);
      assert.ok(jelly.diagnostics.deformation < 0.0001);
    }
  }
});

test('pinch extremes stay finite, respect the floor, and reset clears the gesture', () => {
  const jelly = new JellyPhysics();
  jelly.beginPinch({ x: 1, y: 1, z: 0 });
  for (const ratio of [1000, 0.00001, NaN, Infinity, -1, 0]) {
    jelly.movePinch(ratio);
    advance(jelly, 0.2);
    const out = jelly.deform(-1.58, 0.035, -1.15, {});
    assert.ok(Object.values(out).every(Number.isFinite));
    assert.ok(out.y + jelly.position.y >= 0.012 - 1e-12);
    assert.ok(Math.abs(jelly.diagnostics.modes.pinch) <= 0.85);
  }
  jelly.reset();
  assert.equal(jelly.diagnostics.pinching, false);
  assert.deepEqual(jelly.deform(point.x, point.y, point.z, {}), point);
});

test('rest is identity and reset leaves settings intact', () => {
  const jelly = new JellyPhysics();
  const out = {};
  for (const p of [point, { x: -1.58, y: 0.035, z: -1.15 }, { x: 0, y: 2.4, z: 0 }]) {
    assert.deepEqual(jelly.deform(p.x, p.y, p.z, out), p);
  }
  jelly.setConfig({ stiffness: 0.8, damping: 0.2 });
  jelly.poke();
  advance(jelly, 0.1);
  jelly.beginGrab(point, point);
  jelly.reset();
  assert.deepEqual(jelly.position, { x: 0, y: 0, z: 0 });
  assert.equal(jelly.diagnostics.deformation, 0);
  assert.equal(jelly.diagnostics.dragging, false);
  assert.equal(jelly.diagnostics.steps, 0);
  assert.deepEqual(jelly.config, { stiffness: 0.8, damping: 0.2 });
});

test('poke visibly squashes, bounces on the table, and settles', () => {
  const jelly = new JellyPhysics();
  jelly.poke();
  advance(jelly, 0.1);
  assert.ok(jelly.position.y > 0.15, 'button provides a visible hop');
  assert.ok(jelly.diagnostics.modes.squash < -0.07, 'initial compression, not a rigid sphere');
  assert.ok(jelly.diagnostics.deformation > 0.08);
  advance(jelly, 3);
  assert.equal(jelly.position.y, 0);
  assert.equal(jelly.velocity.y, 0);
  assert.ok(jelly.diagnostics.contacts > 0);
  assert.ok(jelly.diagnostics.deformation < 0.0001);
});

test('onLand callback triggers on ground landing with measured impact', () => {
  const jelly = new JellyPhysics();
  const impacts = [];
  jelly.onLand = impact => impacts.push(impact);
  jelly.poke();
  advance(jelly, 3);
  assert.ok(impacts.length > 0, 'onLand was triggered');
  assert.ok(impacts[0] > 0.38, 'impact is a positive downward velocity');
});

test('startEntry animates bouncing leap from right and settles dead-center', () => {
  const jelly = new JellyPhysics();
  const impacts = [];
  let completed = false;
  jelly.onLand = impact => impacts.push(impact);
  jelly.onEntryComplete = () => { completed = true; };

  jelly.startEntry();
  assert.equal(jelly.position.x, 3.6);
  assert.equal(jelly.position.y, 2.4);

  advance(jelly, 2.0);
  assert.equal(completed, true, 'entry animation completed');
  assert.equal(jelly.position.x, 0, 'settles dead-center x');
  assert.equal(jelly.position.y, 0, 'settles dead-center y');
  assert.equal(jelly.position.z, 0, 'settles dead-center z');
  assert.equal(impacts.length, 2, 'two bounces triggered during entrance');
});

test('press locally indents flesh; a remote point moves much less; release restores', () => {
  const jelly = new JellyPhysics();
  const anchor = { x: 0.8, y: 1.08, z: 0.9 };
  const far = { x: -1.2, y: 1.08, z: -0.7 };
  jelly.beginGrab(anchor, anchor);
  advance(jelly, 0.08);
  const nearOut = jelly.deform(anchor.x, anchor.y, anchor.z, {});
  const farOut = jelly.deform(far.x, far.y, far.z, {});
  assert.ok(nearOut.z < anchor.z - 0.05, 'press responds within 100 ms');
  assert.ok(distance(nearOut, anchor) > distance(farOut, far) * 3, 'localized deformation');
  assert.equal(jelly.diagnostics.dragging, true);
  jelly.endGrab();
  advance(jelly, 3);
  assert.ok(distance(jelly.deform(anchor.x, anchor.y, anchor.z, {}), anchor) < 0.0001);
});

test('squash/oval scales conserve volume through repeated impacts', () => {
  const jelly = new JellyPhysics();
  jelly.setConfig({ stiffness: 0, damping: 0 });
  jelly.poke();
  let sawSquash = false;
  let sawStretch = false;
  for (let i = 0; i < 360; i++) {
    jelly.update(1 / 120);
    assert.ok(Math.abs(jelly.diagnostics.volumeScale - 1) < 1e-12);
    sawSquash ||= jelly.diagnostics.modes.squash < -0.08;
    sawStretch ||= jelly.diagnostics.modes.squash > 0.03;
  }
  assert.ok(sawSquash && sawStretch);
});

test('drag follows the pointer, yields locally, and releases with inertia without floor penetration', () => {
  const jelly = new JellyPhysics();
  jelly.beginGrab(point, point);
  for (let i = 1; i <= 30; i++) {
    jelly.moveGrab({ x: point.x + i * 0.06, y: point.y + i * 0.05, z: point.z });
    jelly.update(1 / 60);
  }
  assert.ok(jelly.position.x > 1.1);
  assert.ok(jelly.position.y > 0.9);
  assert.ok(jelly.diagnostics.deformation > 0.04);
  const beforeRelease = { ...jelly.position };
  jelly.endGrab();
  jelly.update(1 / 60);
  assert.ok(jelly.position.x > beforeRelease.x, 'release preserves horizontal velocity');
  assert.ok(jelly.position.y > beforeRelease.y, 'upward momentum survives release');
  const out = {};
  for (let i = 0; i < 360; i++) {
    jelly.update(1 / 60);
    jelly.deform(-0.6, 0.035, 0.3, out);
    assert.ok(out.y + jelly.position.y >= 0.012 - 1e-12);
    assert.ok(jelly.position.x >= -2.7 && jelly.position.x <= 2.7);
  }
  assert.equal(jelly.position.y, 0);
  assert.ok(jelly.diagnostics.contacts > 0);
  assert.ok(jelly.diagnostics.deformation < 0.0001);
});

test('softness changes compliance and damping changes the settling envelope', () => {
  const soft = new JellyPhysics();
  const firm = new JellyPhysics();
  soft.setConfig({ stiffness: 0 });
  firm.setConfig({ stiffness: 1 });
  soft.beginGrab(point, point);
  firm.beginGrab(point, point);
  advance(soft, 1);
  advance(firm, 1);
  assert.ok(Math.abs(soft.diagnostics.modes.localZ) > Math.abs(firm.diagnostics.modes.localZ) * 1.8);

  const bouncy = new JellyPhysics();
  const damped = new JellyPhysics();
  bouncy.setConfig({ damping: 0 });
  damped.setConfig({ damping: 1 });
  bouncy.poke();
  damped.poke();
  let bouncyEnvelope = 0;
  let dampedEnvelope = 0;
  for (let i = 0; i < 180; i++) {
    bouncy.update(1 / 60);
    damped.update(1 / 60);
    if (i > 60) {
      bouncyEnvelope += bouncy.diagnostics.deformation;
      dampedEnvelope += damped.diagnostics.deformation;
    }
  }
  assert.ok(bouncyEnvelope > dampedEnvelope * 8);
});

test('fixed-step outcomes agree at 30, 60 and 120 Hz; suspended frames are bounded', () => {
  const results = [30, 60, 120].map((fps) => {
    const jelly = new JellyPhysics();
    jelly.poke();
    advance(jelly, 2, 1 / fps);
    return jelly.diagnostics;
  });
  for (const result of results.slice(1)) {
    assert.deepEqual(result.position, results[0].position);
    assert.deepEqual(result.modes, results[0].modes);
    assert.equal(result.steps, 240);
  }
  const jelly = new JellyPhysics();
  jelly.update(20);
  assert.equal(jelly.diagnostics.steps, 12);
  jelly.update(NaN);
  jelly.update(Infinity);
  jelly.update(-10);
  assert.equal(jelly.diagnostics.steps, 12);
});

test('stress: all control extremes, rapid dragging, repeated pokes and frame spikes stay finite', () => {
  const out = {};
  for (const stiffness of [0, 1]) {
    for (const damping of [0, 1]) {
      const jelly = new JellyPhysics();
      jelly.setConfig({ stiffness, damping });
      for (let i = 0; i < 1800; i++) {
        if (i % 70 === 0) jelly.beginGrab(point, { x: point.x + jelly.position.x, y: point.y + jelly.position.y, z: point.z });
        if (i % 70 < 50) jelly.moveGrab({ x: Math.sin(i * 0.61) * 20, y: Math.cos(i * 0.31) * 15, z: Math.sin(i * 0.17) * 4 });
        if (i % 70 === 50) jelly.endGrab();
        if (i % 13 === 0) jelly.poke();
        jelly.update(i % 41 === 0 ? 0.3 : 1 / 60);
        for (const p of [point, { x: -1.58, y: 0.035, z: -1.15 }, { x: 0, y: 2.4, z: 0 }]) {
          jelly.deform(p.x, p.y, p.z, out);
          assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z));
          assert.ok(out.y + jelly.position.y >= 0.012 - 1e-12);
          assert.ok(Math.abs(out.x) < 4 && Math.abs(out.y) < 5 && Math.abs(out.z) < 3.5);
        }
        assert.ok(jelly.position.x >= -2.7 && jelly.position.x <= 2.7);
        assert.ok(jelly.position.y >= 0 && jelly.position.y <= 3.4);
        assert.ok(Number.isFinite(jelly.diagnostics.energy));
      }
    }
  }
});
