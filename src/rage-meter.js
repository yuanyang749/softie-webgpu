// High-performance WebGPU (WGSL) Game-Style Kawaii Rage Meter (打工怨气槽)
// Renders procedural SDF glass capsule, dual-layer liquid waves with slosh inertia,
// carbonated/boiling micro-bubbles, temperature gradient color flow, and spring recoil physics.

const WGSL_SHADER = `
struct Uniforms {
  resolution: vec2f,
  progress: f32,
  time: f32,
  slosh: f32,
  hitFlash: f32,
  mood: f32, // 0: chill, 1: annoyed, 2: rage, 3: sleepy, 4: max
  pad: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f(-1.0,  1.0),
    vec2f(-1.0,  1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0)
  );
  var output: VertexOutput;
  output.position = vec4f(pos[vertexIndex], 0.0, 1.0);
  output.uv = (pos[vertexIndex] + vec2f(1.0)) * 0.5;
  return output;
}

fn sdRoundedBox(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + vec2f(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0))) - r;
}

fn hash(p: vec2f) -> f32 {
  let h = dot(p, vec2f(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = u.resolution.x / u.resolution.y;
  let p = (uv - vec2f(0.5)) * vec2f(aspect, 1.0);
  let halfW = aspect * 0.5 - 0.03;
  let halfH = 0.46;
  let radius = 0.44;
  let dContainer = sdRoundedBox(p, vec2f(halfW, halfH), radius);

  if (dContainer > 0.03) {
    discard;
  }

  let innerMask = 1.0 - smoothstep(-0.02, 0.01, dContainer);
  let borderGlow = (1.0 - smoothstep(0.0, 0.035, abs(dContainer))) * 0.4;

  let progress = clamp(u.progress, 0.0, 1.0);
  let fillX = -halfW + (halfW * 2.0) * progress;

  let waveSpeed = select(3.2, 7.8, u.progress > 0.7);
  let waveAmp = select(0.028, 0.058, u.progress > 0.7);

  let w1 = sin(p.y * 12.0 + u.time * waveSpeed + u.slosh * 3.5) * waveAmp;
  let w2 = cos(p.y * 20.0 - u.time * (waveSpeed * 1.25)) * (waveAmp * 0.4);
  let surfaceX = fillX + w1 + w2 + u.slosh * p.y * 0.28;

  let isLiquid = smoothstep(0.018, -0.018, p.x - surfaceX);

  // Dynamic Theme Colors
  var colBottom = vec3f(0.95, 0.50, 0.66); // Strawberry pastel pink
  var colTop = vec3f(1.0, 0.72, 0.82);
  var colSurface = vec3f(1.0, 0.92, 0.96);
  var glowCol = vec3f(0.95, 0.38, 0.58);

  if (u.mood == 3.0) {
    // Sleepy mode (Twilight dream cyan & lavender)
    colBottom = vec3f(0.24, 0.52, 0.82);
    colTop = vec3f(0.48, 0.76, 0.96);
    colSurface = vec3f(0.78, 0.92, 1.0);
    glowCol = vec3f(0.3, 0.6, 0.9);
  } else if (u.progress > 0.96) {
    // MAX Burst mode (Solar white-hot plasma & fiery red)
    colBottom = vec3f(0.96, 0.06, 0.12);
    colTop = vec3f(1.0, 0.36, 0.08);
    colSurface = vec3f(1.0, 0.95, 0.72);
    glowCol = vec3f(1.0, 0.22, 0.0);
  } else if (u.progress > 0.65) {
    // Rage mode (Hot crimson magma)
    colBottom = vec3f(0.88, 0.10, 0.22);
    colTop = vec3f(1.0, 0.28, 0.16);
    colSurface = vec3f(1.0, 0.75, 0.55);
    glowCol = vec3f(0.9, 0.15, 0.25);
  } else if (u.progress > 0.28) {
    // Annoyed mode (Sparkling amber citrus)
    colBottom = vec3f(0.96, 0.54, 0.06);
    colTop = vec3f(1.0, 0.80, 0.20);
    colSurface = vec3f(1.0, 0.94, 0.62);
    glowCol = vec3f(1.0, 0.62, 0.12);
  }

  let vertGrad = clamp((p.y + 0.44) / 0.88, 0.0, 1.0);
  var liquidColor = mix(colBottom, colTop, vertGrad);

  // Surface highlight
  let distToSurface = abs(p.x - surfaceX);
  let surfaceHighlight = smoothstep(0.026, 0.0, distToSurface) * isLiquid;
  liquidColor = mix(liquidColor, colSurface, surfaceHighlight * 0.82);

  // Procedural carbonation micro-bubbles rising
  let bubbleSeedY = p.y * 3.2 - u.time * (1.1 + u.progress * 1.6);
  let bubbleGrid = vec2f(floor(p.x * 14.0), floor(bubbleSeedY));
  let bubbleOffset = vec2f(hash(bubbleGrid), hash(bubbleGrid + vec2f(5.1, 7.3)));
  let bubblePos = (fract(vec2f(p.x * 14.0, bubbleSeedY)) - bubbleOffset);
  let bubbleDist = length(bubblePos);
  let bubbleRadius = 0.10 + hash(bubbleGrid + vec2f(11.3, 3.7)) * 0.09;
  let isBubble = smoothstep(bubbleRadius, bubbleRadius * 0.5, bubbleDist) * step(p.x, surfaceX - 0.04) * isLiquid;
  liquidColor += vec3f(0.45, 0.45, 0.45) * isBubble;

  // Sparks at MAX burst
  if (u.progress > 0.78) {
    let sparkNoise = hash(vec2f(p.x * 35.0 + u.time * 22.0, p.y * 35.0));
    if (sparkNoise > 0.955) {
      liquidColor += vec3f(1.0, 0.92, 0.65) * isLiquid * (u.progress - 0.78) * 4.2;
    }
  }

  // White translucent glass tube body & optics
  let glassBase = vec3f(0.98, 0.99, 1.0);
  // Smooth, continuous cylindrical lighting without harsh horizontal streak lines
  let glassCylinder = 0.92 + 0.08 * sin((clamp(p.y / halfH, -1.0, 1.0) + 1.0) * 1.5708);
  let emptyTrack = glassBase * glassCylinder;

  // Inner glass wall rim refraction (fresnel-like refraction around capsule perimeter)
  let innerWallRim = smoothstep(-0.08, 0.0, dContainer) * 0.35 * innerMask;

  // Blend empty frosted glass with vibrant liquid
  var finalRgb = mix(emptyTrack, liquidColor, isLiquid);

  // Layer subtle perimeter glass rim refraction
  finalRgb += vec3f(innerWallRim * 0.5);

  // White hit flash
  if (u.hitFlash > 0.01) {
    finalRgb = mix(finalRgb, vec3f(1.0, 1.0, 1.0), u.hitFlash * 0.65 * isLiquid);
  }

  // Outer border rim glow (pure white edge shifting towards glowing color when raging)
  let borderCol = mix(vec3f(1.0, 1.0, 1.0), glowCol, clamp(borderGlow * 0.5 + u.progress * 0.5, 0.0, 1.0));
  finalRgb = mix(finalRgb, borderCol, borderGlow);

  // Translucent alpha: empty tube is delicately transparent (0.24), liquid is vibrant & opaque (0.94)
  let contentAlpha = mix(0.24, 0.94, isLiquid);
  let totalAlpha = clamp(contentAlpha * innerMask + borderGlow * 0.7, 0.0, 1.0);

  return vec4f(finalRgb * totalAlpha, totalAlpha);
}
`;

export class RageMeter {
  constructor({ containerId = 'rage-meter-hud', device = null } = {}) {
    this.container = typeof document !== 'undefined' ? document.getElementById(containerId) : null;
    this.canvas = this.container ? this.container.querySelector('.rage-hud-canvas') : null;
    this.avatar = this.container ? this.container.querySelector('.rage-hud-avatar') : null;
    this.badge = this.container ? this.container.querySelector('.rage-hud-badge') : null;
    this.percentEl = this.container ? this.container.querySelector('.rage-hud-percent') : null;

    this.device = device;
    this.gpuContext = null;
    this.pipeline = null;
    this.uniformBuffer = null;
    this.bindGroup = null;

    // Simulation state
    this.progress = 0;
    this.displayProgress = 0;
    this.time = 0;
    this.slosh = 0;
    this.sloshVelocity = 0;
    this.hitFlash = 0;
    this.mood = 'chill';
    this.isSleeping = false;
    this.scaleX = 1;
    this.scaleY = 1;
    this.scaleVelX = 0;
    this.scaleVelY = 0;

    this.useWebGPU = false;
    this.ctx2d = null;

    this.initRenderer();
  }

  setDevice(device) {
    if (this.device === device) return;
    this.device = device;
    this.initRenderer();
  }

  async initRenderer() {
    if (!this.canvas || typeof window === 'undefined') return;

    // Only attempt WebGPU if navigator.gpu exists
    if (navigator.gpu) {
      try {
        if (!this.device) {
          const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
          if (adapter) this.device = await adapter.requestDevice();
        }

        if (this.device) {
          this.gpuContext = this.canvas.getContext('webgpu');
          if (this.gpuContext) {
            const format = navigator.gpu.getPreferredCanvasFormat();
            this.gpuContext.configure({
              device: this.device,
              format,
              alphaMode: 'premultiplied',
            });

            const shaderModule = this.device.createShaderModule({ code: WGSL_SHADER });
            this.pipeline = this.device.createRenderPipeline({
              layout: 'auto',
              vertex: { module: shaderModule, entryPoint: 'vs_main' },
              fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{
                  format,
                  blend: {
                    color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                  },
                }],
              },
              primitive: { topology: 'triangle-list' },
            });

            // 8 floats: resolution(2), progress(1), time(1), slosh(1), hitFlash(1), mood(1), pad(1)
            this.uniformBuffer = this.device.createBuffer({
              size: 32,
              usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            this.bindGroup = this.device.createBindGroup({
              layout: this.pipeline.getBindGroupLayout(0),
              entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
            });

            this.useWebGPU = true;
            this.resize();
            return;
          }
        }
      } catch (e) {
        console.warn('[softie] RageMeter WebGPU initialization fallback:', e);
      }
    }

    // High-res 2D Canvas fallback if WebGPU is absent or in non-WebGPU environment
    try {
      this.ctx2d = this.canvas.getContext('2d');
      this.resize();
    } catch {
      // Headless / mock environment
    }
  }

  resize() {
    if (!this.canvas) return;
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round((rect.width || 240) * dpr));
    const h = Math.max(1, Math.round((rect.height || 36) * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  pulse(impact = 1.0) {
    this.hitFlash = 1.0;
    // Subtle jelly spring squash & stretch (avoids excessive horizontal ballooning)
    this.scaleVelX = 0.04 * impact;
    this.scaleVelY = -0.06 * impact;
    // Slosh impulse
    this.sloshVelocity += (Math.random() - 0.5) * 1.8 * impact + 0.8;
  }

  update(dt, anger = 0, mood = 'chill', isSleeping = false) {
    this.time += dt;
    this.progress = Math.max(0, Math.min(1, anger));
    this.mood = mood;
    this.isSleeping = isSleeping;

    // Smooth progress interpolation
    this.displayProgress += (this.progress - this.displayProgress) * Math.min(1, dt * 8);

    // Spring physics for recoil
    const springK = 80;
    const damping = 10;
    this.scaleVelX += (1 - this.scaleX) * springK * dt - this.scaleVelX * damping * dt;
    this.scaleVelY += (1 - this.scaleY) * springK * dt - this.scaleVelY * damping * dt;
    this.scaleX += this.scaleVelX * dt;
    this.scaleY += this.scaleVelY * dt;

    // Slosh physics (damped pendulum)
    const sloshK = 45;
    const sloshDamping = 6;
    this.sloshVelocity += -this.slosh * sloshK * dt - this.sloshVelocity * sloshDamping * dt;
    this.slosh += this.sloshVelocity * dt;

    // Hit flash decay
    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 4.5);
    }

    this.renderDOM();
    this.renderCanvas();
  }

  renderDOM() {
    if (!this.container) return;

    // Update container mood and max rage classes
    const isMax = this.progress >= 0.95;
    this.container.dataset.mood = this.isSleeping ? 'sleepy' : isMax ? 'max' : this.mood;
    this.container.classList.toggle('is-max-rage', isMax);

    // Apply spring squash & stretch (preserving horizontal centering)
    this.container.style.transform = `translateX(-50%) scale(${this.scaleX.toFixed(3)}, ${this.scaleY.toFixed(3)})`;

    // Update percent text
    if (this.percentEl) {
      const pct = Math.round(this.displayProgress * 100);
      this.percentEl.textContent = isMax ? 'MAX!' : `${pct}%`;
    }

    // Update avatar expression
    if (this.avatar) {
      const avatarState = this.isSleeping ? 'sleepy' : isMax ? 'max' : this.mood;
      this.avatar.dataset.state = avatarState;
    }
  }

  renderCanvas() {
    if (!this.canvas) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w <= 1 || h <= 1) return;

    if (this.useWebGPU && this.gpuContext && this.device && this.pipeline) {
      let moodCode = 0.0;
      if (this.isSleeping) moodCode = 3.0;
      else if (this.progress >= 0.95) moodCode = 4.0;
      else if (this.mood === 'rage' || this.progress > 0.65) moodCode = 2.0;
      else if (this.mood === 'annoyed' || this.progress > 0.28) moodCode = 1.0;

      const uniformData = new Float32Array([
        w, h,
        this.displayProgress,
        this.time,
        this.slosh,
        this.hitFlash,
        moodCode,
        0.0,
      ]);

      this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

      const commandEncoder = this.device.createCommandEncoder();
      const textureView = this.gpuContext.getCurrentTexture().createView();
      const renderPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: textureView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });

      renderPass.setPipeline(this.pipeline);
      renderPass.setBindGroup(0, this.bindGroup);
      renderPass.draw(6);
      renderPass.end();

      this.device.queue.submit([commandEncoder.finish()]);
      return;
    }

    // 2D Canvas Fallback
    if (this.ctx2d) {
      const ctx = this.ctx2d;
      ctx.clearRect(0, 0, w, h);

      const radius = h * 0.46;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(4, 4, w - 8, h - 8, radius);
      ctx.clip();

      // Track background (White frosted transparent glass tube)
      const glassBg = ctx.createLinearGradient(0, 4, 0, h - 4);
      glassBg.addColorStop(0, 'rgba(255, 255, 255, 0.60)');
      glassBg.addColorStop(0.25, 'rgba(255, 255, 255, 0.22)');
      glassBg.addColorStop(0.75, 'rgba(255, 255, 255, 0.18)');
      glassBg.addColorStop(1, 'rgba(255, 255, 255, 0.45)');
      ctx.fillStyle = glassBg;
      ctx.fillRect(0, 0, w, h);

      // Liquid fill with wave
      const fillW = (w - 8) * this.displayProgress;
      if (fillW > 0) {
        ctx.beginPath();
        const waveSpeed = this.progress > 0.7 ? 8 : 3.5;
        const waveAmp = (this.progress > 0.7 ? 8 : 4) * (h / 40);

        ctx.moveTo(4, h - 4);
        ctx.lineTo(4, 4);

        for (let y = 4; y <= h - 4; y += 4) {
          const wave = Math.sin(y * 0.15 + this.time * waveSpeed + this.slosh * 4) * waveAmp;
          ctx.lineTo(4 + fillW + wave, y);
        }

        ctx.lineTo(4, h - 4);
        ctx.closePath();

        let grad;
        if (this.isSleeping) {
          grad = ctx.createLinearGradient(4, 0, 4 + fillW, 0);
          grad.addColorStop(0, '#3d84c6');
          grad.addColorStop(1, '#6ec6ff');
        } else if (this.progress >= 0.95) {
          grad = ctx.createLinearGradient(4, 0, 4 + fillW, 0);
          grad.addColorStop(0, '#ff1a35');
          grad.addColorStop(1, '#ff8a00');
        } else if (this.progress > 0.65) {
          grad = ctx.createLinearGradient(4, 0, 4 + fillW, 0);
          grad.addColorStop(0, '#e61e38');
          grad.addColorStop(1, '#ff5252');
        } else if (this.progress > 0.28) {
          grad = ctx.createLinearGradient(4, 0, 4 + fillW, 0);
          grad.addColorStop(0, '#f59e0b');
          grad.addColorStop(1, '#fbbf24');
        } else {
          grad = ctx.createLinearGradient(4, 0, 4 + fillW, 0);
          grad.addColorStop(0, '#f17fa9');
          grad.addColorStop(1, '#ffa6c5');
        }

        ctx.fillStyle = grad;
        ctx.fill();

        if (this.hitFlash > 0.05) {
          ctx.fillStyle = `rgba(255, 255, 255, ${this.hitFlash * 0.6})`;
          ctx.fill();
        }
      }

      // Glass inner rim outline
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.restore();
    }
  }

  reset() {
    this.progress = 0;
    this.displayProgress = 0;
    this.slosh = 0;
    this.sloshVelocity = 0;
    this.hitFlash = 0;
    this.mood = 'chill';
    this.isSleeping = false;
    this.renderDOM();
    this.renderCanvas();
  }

  dispose() {
    if (this.uniformBuffer) {
      try { this.uniformBuffer.destroy(); } catch { /* ignore */ }
    }
  }
}
