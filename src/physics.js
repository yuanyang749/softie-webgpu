const STEP = 1 / 120;
const GRAVITY = 8.8;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const vec = () => ({ x: 0, y: 0, z: 0 });
const mode = () => ({ value: 0, velocity: 0 });

function spring(state, target, frequency, damping, dt, limit) {
  state.velocity += ((target - state.value) * frequency * frequency
    - 2 * damping * frequency * state.velocity) * dt;
  state.value += state.velocity * dt;
  if (Math.abs(state.value) > limit) {
    state.value = clamp(state.value, -limit, limit);
    state.velocity *= 0.25;
  }
  if (Math.abs(state.value - target) < 1e-7 && Math.abs(state.velocity) < 1e-6) {
    state.value = target;
    state.velocity = 0;
  }
}

/** Low-dimensional elastic continuum; all visible parts use the same material map. */
export class JellyPhysics {
  constructor() {
    this.position = vec();
    this.velocity = vec();
    this.config = { stiffness: 0.35, damping: 0.45 };
    this._squash = mode();
    this._oval = mode();
    this._shearX = mode();
    this._shearZ = mode();
    this._localX = mode();
    this._localY = mode();
    this._localZ = mode();
    this._pinch = mode();
    this._pinchAxis = { x: 1, y: 0, z: 0 };
    this._anchor = vec();
    this._normal = vec();
    this._target = vec();
    this._startTarget = vec();
    this._startPosition = vec();
    this.onLand = null;
    this.onEntryComplete = null;
    this._entering = false;
    this._entryTime = 0;
    this._entryLanded = [false, false];
    this.reset();
  }

  setConfig({ stiffness, damping } = {}) {
    if (Number.isFinite(stiffness)) this.config.stiffness = clamp(stiffness, 0, 1);
    if (Number.isFinite(damping)) this.config.damping = clamp(damping, 0, 1);
  }

  reset() {
    for (const point of [this.position, this.velocity, this._anchor, this._target,
      this._startTarget, this._startPosition, this._normal]) {
      point.x = point.y = point.z = 0;
    }
    for (const state of [this._squash, this._oval, this._shearX, this._shearZ,
      this._localX, this._localY, this._localZ, this._pinch]) {
      state.value = state.velocity = 0;
    }
    this._accumulator = 0;
    this._time = 0;
    this._steps = 0;
    this._contacts = 0;
    this._dragging = false;
    this._pinching = false;
    this._pinchTarget = 0;
    this._entering = false;
    this._entryTime = 0;
    this._entryLanded = [false, false];
    this._scaleY = this._scaleX = this._scaleZ = 1;
    this._pinchParallel = this._pinchTransverse = 1;
  }

  startEntry() {
    this.reset();
    this._entering = true;
    this._entryTime = 0;
    this._entryLanded = [false, false];
    this.position.x = 3.6;
    this.position.y = 2.4;
    this.position.z = 0;
    this._squash.value = 0.16;
    this._shearX.value = -0.22;
  }

  beginGrab(localPoint, worldTarget) {
    if (!this._validPoint(localPoint) || !this._validPoint(worldTarget)) return;
    this._entering = false;
    this._dragging = true;
    Object.assign(this._anchor, localPoint);
    Object.assign(this._startTarget, worldTarget);
    Object.assign(this._target, worldTarget);
    Object.assign(this._startPosition, this.position);
    // Ellipsoid gradient approximates the local outward normal, including the tip.
    const n = this._normal;
    n.x = localPoint.x / (1.58 * 1.58);
    n.y = (localPoint.y - 1.08) / (1.2 * 1.2);
    n.z = localPoint.z / (1.15 * 1.15);
    const length = Math.hypot(n.x, n.y, n.z) || 1;
    n.x /= length;
    n.y /= length;
    n.z /= length;
  }

  moveGrab(worldTarget) {
    if (this._dragging && this._validPoint(worldTarget)) {
      Object.assign(this._target, worldTarget);
    }
  }

  endGrab() {
    this._dragging = false;
    this.endPinch();
  }

  beginPinch(axis) {
    if (!this._validPoint(axis)) return;
    const length = Math.hypot(axis.x, axis.y, axis.z);
    if (length < 0.001) return;
    this._pinching = true;
    for (const key of ['x', 'y', 'z']) this._pinchAxis[key] = axis[key] / length;
    this._pinchTarget = this._pinch.value;
    this._pinchStart = this._pinch.value;
  }

  movePinch(ratio) {
    if (!this._pinching || !Number.isFinite(ratio) || ratio <= 0) return;
    this._pinchTarget = clamp(this._pinchStart + Math.log(ratio) * 0.7, -0.5, 0.48);
  }

  endPinch() {
    this._pinching = false;
    this._pinchTarget = 0;
  }

  poke() {
    this.velocity.y = Math.min(this.velocity.y + 2.45, 5.4);
    this._squash.velocity = Math.max(this._squash.velocity - 3.1, -6);
    this._oval.velocity += 0.48;
    this._shearX.velocity += 0.7;
  }

  _validPoint(point) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.y)
      && Number.isFinite(point.z);
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (this._entering) {
      this._updateEntry(dt);
      const q = this._squash.value;
      const oval = this._oval.value;
      this._scaleY = Math.exp(q);
      this._scaleX = Math.exp(-q * 0.5 + oval);
      this._scaleZ = Math.exp(-q * 0.5 - oval);
      return;
    }
    // Drop excess wall time after tab suspension instead of spiralling into catch-up.
    this._accumulator += Math.min(dt, 0.1);
    while (this._accumulator + 1e-10 >= STEP) {
      this._step(STEP);
      this._accumulator = Math.max(0, this._accumulator - STEP);
    }
    const q = this._squash.value;
    const oval = this._oval.value;
    // Product of these scales is exactly one; shear also has unit determinant.
    this._pinchParallel = Math.exp(this._pinch.value);
    this._pinchTransverse = Math.exp(-this._pinch.value * 0.5);
    this._scaleY = Math.exp(q);
    this._scaleX = Math.exp(-q * 0.5 + oval);
    this._scaleZ = Math.exp(-q * 0.5 - oval);
  }

  _updateEntry(dt) {
    this._entryTime += dt;
    const t = this._entryTime;
    if (t < 0.70) {
      const p = t / 0.70;
      this.position.x = 3.6 * (1 - p) + 1.25 * p;
      this.position.y = Math.max(0, 2.4 * (1 - p * p) + Math.sin(p * Math.PI) * 0.35);
      this._squash.value = (1 - p) * 0.16 - Math.sin(p * Math.PI) * 0.15;
      this._shearX.value = -0.22 * (1 - p);
      if (p >= 0.98 && !this._entryLanded[0]) {
        this._entryLanded[0] = true;
        if (typeof this.onLand === 'function') this.onLand(3.2);
      }
    } else if (t < 1.15) {
      if (!this._entryLanded[0]) {
        this._entryLanded[0] = true;
        if (typeof this.onLand === 'function') this.onLand(3.2);
      }
      const p = (t - 0.70) / 0.45;
      this.position.x = 1.25 * (1 - p);
      this.position.y = Math.max(0, Math.sin(p * Math.PI) * 0.78);
      this._squash.value = Math.sin(p * Math.PI) * 0.10;
      this._shearX.value = -0.12 * Math.sin(p * Math.PI);
      if (p >= 0.98 && !this._entryLanded[1]) {
        this._entryLanded[1] = true;
        if (typeof this.onLand === 'function') this.onLand(2.0);
      }
    } else if (t < 1.35) {
      if (!this._entryLanded[1]) {
        this._entryLanded[1] = true;
        if (typeof this.onLand === 'function') this.onLand(2.0);
      }
      const p = (t - 1.15) / 0.20;
      this.position.x = 0;
      this.position.y = 0;
      this.position.z = 0;
      this._squash.value = -0.16 * Math.exp(-p * 4) * Math.cos(p * Math.PI * 3);
      this._shearX.value = 0;
    } else {
      this._entering = false;
      this.position.x = 0;
      this.position.y = 0;
      this.position.z = 0;
      this._squash.value = 0;
      this._shearX.value = 0;
      if (typeof this.onEntryComplete === 'function') this.onEntryComplete();
    }
  }

  _step(dt) {
    const p = this.position;
    const v = this.velocity;
    const { stiffness, damping } = this.config;
    const frequency = 9 + 14 * stiffness;
    const dampingRatio = 0.11 + 0.82 * damping;
    let ax = 0;
    let az = 0;
    let ay = -GRAVITY;
    let localX = 0;
    let localY = 0;
    let localZ = 0;
    let squashTarget = 0;

    if (this._dragging) {
      const dx = this._target.x - this._startTarget.x;
      const dy = this._target.y - this._startTarget.y;
      const dz = this._target.z - this._startTarget.z;
      const goalX = clamp(this._startPosition.x + dx, -2.7, 2.7);
      const goalY = clamp(this._startPosition.y + dy, 0, 3.4);
      const goalZ = clamp(this._startPosition.z + dz, -1.35, 1.35);
      const pull = 95 + stiffness * 105;
      const resistance = 2 * Math.sqrt(pull) * (0.66 + damping * 0.22);
      ax = (goalX - p.x) * pull - v.x * resistance;
      ay = (goalY - p.y) * pull - v.y * resistance - GRAVITY * 0.16;
      az = (goalZ - p.z) * pull - v.z * resistance;

      const indentation = 0.21 - stiffness * 0.12;
      localX = dx - (p.x - this._startPosition.x) - this._normal.x * indentation;
      localY = dy - (p.y - this._startPosition.y) - this._normal.y * indentation;
      localZ = dz - (p.z - this._startPosition.z) - this._normal.z * indentation;
      const maxPull = 0.72 - stiffness * 0.2;
      const length = Math.hypot(localX, localY, localZ);
      if (length > maxPull) {
        const scale = maxPull / length;
        localX *= scale;
        localY *= scale;
        localZ *= scale;
      }
      squashTarget = clamp(dy * 0.075, -0.16, 0.12) - indentation * 0.09;
    } else {
      const friction = p.y < 0.005 ? 5.4 + damping * 4 : 0.45;
      ax = -v.x * friction;
      az = -v.z * friction;
    }

    v.x = clamp(v.x + ax * dt, -9, 9);
    v.y = clamp(v.y + ay * dt, -8, 8);
    v.z = clamp(v.z + az * dt, -6, 6);
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;

    if (p.y < 0) {
      p.y = 0;
      if (v.y < -0.38) {
        const impact = -v.y;
        this._squash.velocity -= Math.min(impact * 0.68, 4.6);
        this._oval.velocity += impact * 0.035;
        v.y = impact * (0.27 - damping * 0.16);
        this._contacts++;
        if (typeof this.onLand === 'function') this.onLand(impact);
      } else {
        v.y = 0;
      }
    }
    for (const [axis, min, max] of [['x', -2.7, 2.7], ['y', 0, 3.4], ['z', -1.35, 1.35]]) {
      if (p[axis] < min || p[axis] > max) {
        p[axis] = clamp(p[axis], min, max);
        v[axis] *= -0.16;
      }
      if (!this._dragging && Math.abs(v[axis]) < 1e-5) v[axis] = 0;
    }

    spring(this._squash, squashTarget, frequency, dampingRatio, dt, 0.40);
    spring(this._pinch, this._pinchTarget, frequency, dampingRatio, dt, 0.85);
    spring(this._oval, 0, frequency * 0.84, dampingRatio, dt, 0.17);
    spring(this._shearX, clamp(-ax * 0.008, -0.28, 0.28), frequency * 0.70,
      dampingRatio * 0.91, dt, 0.33);
    spring(this._shearZ, clamp(-az * 0.008, -0.22, 0.22), frequency * 0.73,
      dampingRatio * 0.91, dt, 0.28);
    spring(this._localX, localX, frequency * 1.45, dampingRatio, dt, 0.78);
    spring(this._localY, localY, frequency * 1.45, dampingRatio, dt, 0.78);
    spring(this._localZ, localZ, frequency * 1.45, dampingRatio, dt, 0.78);
    this._time += dt;
    this._steps++;
  }

  /** Map authored local coordinates to the shared jelly surface/interior. No allocation. */
  deform(x, y, z, out) {
    let px = x;
    let py = y;
    let pz = z;
    const ux = this._localX.value;
    const uy = this._localY.value;
    const uz = this._localZ.value;
    if (ux !== 0 || uy !== 0 || uz !== 0) {
      const dx = x - this._anchor.x;
      const dy = y - this._anchor.y;
      const dz = z - this._anchor.z;
      const r2 = dx * dx + dy * dy + dz * dz;
      // Curl-derived Gaussian field: divergence-free to first order. Its surrounding
      // counterflow makes an indentation move flesh, rather than shrink a rigid ball.
      const inverseVariance = 1.05;
      const a = r2 * inverseVariance;
      const weight = Math.exp(-a);
      const projection = (ux * dx + uy * dy + uz * dz) * inverseVariance;
      const central = 1 - a;
      px += weight * (central * ux + projection * dx);
      py += weight * (central * uy + projection * dy);
      pz += weight * (central * uz + projection * dz);
    }
    py *= this._scaleY;
    px *= this._scaleX;
    pz *= this._scaleZ;
    // Stretch along the finger axis and bulge across it: determinant stays one.
    if (this._pinch.value !== 0) {
      const parallel = this._pinchParallel;
      const transverse = this._pinchTransverse;
      const axis = this._pinchAxis;
      const centerY = 1.08 * this._scaleY;
      const projection = px * axis.x + (py - centerY) * axis.y + pz * axis.z;
      const extension = projection * (parallel - transverse);
      px = px * transverse + axis.x * extension;
      py = centerY + (py - centerY) * transverse + axis.y * extension;
      pz = pz * transverse + axis.z * extension;
    }
    const height = py / 2.4;
    // Nonlinear height-only shear has determinant one and lets the crown lag the belly.
    const bend = py * (0.30 + height * 0.70);
    out.x = px + this._shearX.value * bend;
    out.y = Math.max(py, -this.position.y + 0.012);
    out.z = pz + this._shearZ.value * bend;
    return out;
  }

  get diagnostics() {
    const modes = {
      squash: this._squash.value,
      oval: this._oval.value,
      shearX: this._shearX.value,
      shearZ: this._shearZ.value,
      localX: this._localX.value,
      localY: this._localY.value,
      localZ: this._localZ.value,
      pinch: this._pinch.value,
    };
    const deformation = Math.hypot(...Object.values(modes));
    return {
      engine: 'custom-elastic-continuum',
      fixedStep: STEP,
      bodyCount: 1,
      colliderCount: 1,
      ccd: 'analytic-floor-clamp',
      position: { ...this.position },
      velocity: { ...this.velocity },
      dragging: this._dragging,
      pinching: this._pinching,
      grounded: this.position.y < 0.005,
      deformation,
      energy: deformation * deformation + this.velocity.x ** 2
        + this.velocity.y ** 2 + this.velocity.z ** 2,
      volumeScale: this._scaleX * this._scaleY * this._scaleZ,
      modes,
      config: { ...this.config },
      contacts: this._contacts,
      simulatedTime: this._time,
      steps: this._steps,
    };
  }
}
