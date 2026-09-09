import * as THREE from 'three/webgpu';
import { JellyPhysics } from './physics.js';
import { makeSlime } from './slime.js';
import { makeStudio } from './studio.js';
import { setupUI } from './ui.js';
import { sound } from './sound.js';
import { RageMeter } from './rage-meter.js';
import './style.css';

const physics = new JellyPhysics();
const rageMeter = new RageMeter();
let slime, studio, ready = false;
let isDizzyPending = false;
let lastSnoreTime = 0;
let lastActivity = performance.now();
const registerActivity = () => {
  // Only update activity when awake so mouse movement never disturbs sleep
  if (!slime?.faceMotion.isSleeping) {
    lastActivity = performance.now();
  }
};

physics.onLand = impact => {
  if (!ready) return;
  if (isDizzyPending) {
    isDizzyPending = false;
    sound.playDizzyLand(impact);
    slime?.faceMotion.react('dizzy');
  } else if (slime?.faceMotion.anger > 0.48) {
    sound.playAngryLand(impact);
  } else {
    sound.playLand(impact);
  }
};
physics.onEntryComplete = () => {
  slime?.faceMotion.react('happy');
  sound.playWakeup();
};
let lastPokeTime = 0;
let rapidPokeCount = 0;

function poke() {
  if (!ready) return;
  const now = performance.now();
  lastActivity = now;

  if (slime?.faceMotion.isSleeping) {
    rapidPokeCount = 0;
    slime.faceMotion.wakeUp(true);
    sound.playStartle();
    physics.poke();
    return;
  }

  physics.poke();
  rageMeter.pulse(1.0);

  const dtPoke = now - lastPokeTime;
  lastPokeTime = now;

  if (dtPoke < 750) {
    rapidPokeCount++;
  } else {
    rapidPokeCount = 1;
  }

  if (rapidPokeCount >= 2) {
    // Rapid continuous poking: emotion shifts towards annoyed and angry
    slime?.faceMotion.addAnger(0.20);
    rageMeter.pulse(1.4);
    if (slime?.faceMotion.anger > 0.55) {
      sound.playAngryPoke(slime.faceMotion.anger);
    } else {
      sound.playPoke();
    }
  } else {
    // Single poke: restore original surprised round circle ':O' mouth!
    slime?.faceMotion.react('surprised');
    sound.playPoke();
  }
}
const ui = setupUI({
  onColor: ({ color }) => { slime?.setColor(color); studio?.setColor(color); slime?.faceMotion.react('wink'); },
  onAccessory: type => {
    slime?.setAccessory(type);
    slime?.faceMotion.react('wink');
  },
  onStiffness: stiffness => physics.setConfig({ stiffness }),
  onDamping: damping => physics.setConfig({ damping }),
  onPoke: poke,
  onReset: () => {
    isDizzyPending = false;
    physics.reset();
    slime?.setColor('#f17fa9');
    studio?.setColor('#f17fa9');
    slime?.setAccessory('none');
    slime?.faceMotion.reset();
    ui.setMood('chill');
    rageMeter.reset();
  },
  onWakeup: () => {
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotion.matches) {
      sound.playWakeup();
    } else {
      physics.startEntry();
    }
  },
});

async function start() {
  if (!navigator.gpu) throw new Error('gpuUnsupported');
  const canvas = document.querySelector('#slime-canvas');
  const stage = document.querySelector('#stage');
  // Renderer + one explicit backend: no fallback backend is even registered.
  const renderer = new THREE.Renderer(new THREE.WebGPUBackend({
    canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
  }), { antialias: true, alpha: false, getFallback: null });
  renderer.library = new THREE.StandardNodeLibrary();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor('#f5f5f3', 1);
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) throw new Error('nativeRequired');
  rageMeter.setDevice(renderer.backend.device);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f5f5f3');
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
  studio = makeStudio(renderer, scene);
  studio.setColor('#f17fa9');
  slime = makeSlime(physics, scene.environment);
  scene.add(slime.group);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const syncMotionPreference = () => { slime.faceMotion.reducedMotion = reducedMotion.matches; };
  syncMotionPreference();
  reducedMotion.addEventListener('change', syncMotionPreference);
  let dpr = Math.min(devicePixelRatio, 2);
  const resize = () => {
    const rect = stage.getBoundingClientRect();
    const { width, height } = rect;
    // Overscan the designed hero viewport so a lifted jelly is not sliced by its box.
    // A camera view offset preserves the reference framing and its pixel scale.
    const desktop = window.innerWidth >= 900;
    const left = Math.max(0, rect.left);
    const top = desktop ? Math.max(0, rect.top) : 0;
    const right = Math.max(0, (desktop ? window.innerWidth * 0.744 - 12 : window.innerWidth) - rect.right);
    const bottom = desktop ? Math.max(0, window.innerHeight - rect.bottom) : 0;
    const canvasWidth = width + left + right, canvasHeight = height + top + bottom;
    Object.assign(canvas.style, {
      position: 'absolute', left: `${-left}px`, top: `${-top}px`,
      width: `${canvasWidth}px`, height: `${canvasHeight}px`,
    });
    renderer.setPixelRatio(dpr);
    renderer.setSize(canvasWidth, canvasHeight, false);
    camera.aspect = width / height;
    const visibleHeight = Math.max(desktop ? 3.25 : 3.85, (desktop ? 4.12 : 4.45) / camera.aspect);
    const distance = visibleHeight / (2 * Math.tan(THREE.MathUtils.degToRad(16)));
    const camY = desktop ? 1.1 + distance * 0.15 : 1.18 + distance * 0.08;
    const lookAtY = desktop ? 1.03 : 1.10;
    camera.position.set(0.19, camY, distance);
    camera.lookAt(0.19, lookAtY, 0);
    camera.setViewOffset(width, height, -left, -top, canvasWidth, canvasHeight);
    camera.updateProjectionMatrix();
    rageMeter.resize();
    if (rageMeter?.container && width > 0) {
      const centerVec = new THREE.Vector3(0, 0, 0);
      centerVec.project(camera);
      const slimeStageX = -left + (centerVec.x + 1) * canvasWidth / 2;
      rageMeter.container.style.left = `${Math.round(slimeStageX)}px`;
    }
  };
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  resize();

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const worldTarget = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const gazeOrigin = new THREE.Vector3();
  const clearGaze = () => slime.faceMotion.lookAt(0, 0);
  const followPointer = event => {
    if (event.pointerType !== 'mouse' || !finePointer.matches) { clearGaze(); return; }
    if (slime?.faceMotion.isSleeping) return;
    const r = canvas.getBoundingClientRect();
    physics.deform(0, 1.2, 1.15, gazeOrigin);
    gazeOrigin.add(slime.group.position).project(camera);
    const x = r.left + (gazeOrigin.x + 1) * r.width / 2;
    const y = r.top + (1 - gazeOrigin.y) * r.height / 2;
    slime.faceMotion.lookAt((event.clientX - x) / (r.width * 0.24), (y - event.clientY) / (r.height * 0.24));
  };
  window.addEventListener('pointermove', followPointer, { passive: true });
  document.documentElement.addEventListener('pointerleave', clearGaze);
  let pointerId = null;
  let pressTime = 0, pressX = 0, pressY = 0, moved = false;
  let lastMoveTime = 0, lastMoveX = 0, lastMoveY = 0;
  let maxStretchDist = 0;
  let shakePathDist = 0, shakeWindowStart = 0, shakeStartX = 0, shakeStartY = 0;
  let dizzyUntil = 0, dizzyPendingUntil = 0;
  const ray = event => {
    const r = canvas.getBoundingClientRect();
    ndc.set((event.clientX - r.left) / r.width * 2 - 1, -(event.clientY - r.top) / r.height * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  };
  canvas.addEventListener('pointerdown', event => {
    if (pointerId !== null || event.button !== 0) return;
    lastActivity = performance.now();
    ray(event);
    const hit = raycaster.intersectObject(slime.body, false)[0];

    // Clicking / tapping when asleep startles the slime awake!
    if (slime?.faceMotion.isSleeping) {
      slime.faceMotion.wakeUp(true);
      sound.playStartle();
      physics.poke();
      if (!hit) return;
    }

    if (!hit) return;
    pointerId = event.pointerId;
    pressTime = performance.now(); pressX = event.clientX; pressY = event.clientY; moved = false;
    lastMoveTime = performance.now(); lastMoveX = event.clientX; lastMoveY = event.clientY;
    maxStretchDist = 0;
    shakePathDist = 0;
    shakeWindowStart = performance.now();
    shakeStartX = event.clientX;
    shakeStartY = event.clientY;
    dizzyUntil = 0;
    dizzyPendingUntil = 0;
    isDizzyPending = false;
    canvas.setPointerCapture(pointerId);
    camera.getWorldDirection(normal);
    plane.setFromNormalAndCoplanarPoint(normal, hit.point);
    const local = hit.point.clone().sub(slime.group.position);
    physics.beginGrab(local, hit.point);
    slime.faceMotion.grab(true);
    ui.setInteraction('grabbing');
    sound.playSquish();
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', event => {
    if (pointerId !== null) {
      if (event.pointerId !== pointerId) return;
      const now = performance.now();
      const dt = Math.max(1, now - lastMoveTime);
      const dx = event.clientX - lastMoveX;
      const dy = event.clientY - lastMoveY;
      const moveDist = Math.hypot(dx, dy);
      const speed = moveDist / dt;
      lastMoveTime = now; lastMoveX = event.clientX; lastMoveY = event.clientY;

      const totalDist = Math.hypot(event.clientX - pressX, event.clientY - pressY);
      if (totalDist > 8) moved = true;

      // 1. Shake Detection via Path Curvature / Back-and-Forth Motion
      // Linear dragging has netDist ≈ shakePathDist (turnaround ≈ 0) -> Never triggers!
      // Rapid shaking (back-and-forth or rapid circular motions) produces huge turnaround!
      if (now - shakeWindowStart > 420) {
        shakeWindowStart = now;
        shakeStartX = event.clientX;
        shakeStartY = event.clientY;
        shakePathDist = 0;
      }

      if (speed > 0.60) {
        shakePathDist += moveDist;
      }

      const netDist = Math.hypot(event.clientX - shakeStartX, event.clientY - shakeStartY);
      const turnaround = shakePathDist - netDist;

      // When vigorously shaken back-and-forth or in rapid tight circles:
      if (turnaround > 150 && shakePathDist > 220) {
        dizzyUntil = now + 650;
        isDizzyPending = true;
        dizzyPendingUntil = now + 2000;
        slime?.faceMotion.addAnger(0.42);
        sound.playDizzy();
        shakeWindowStart = now;
        shakeStartX = event.clientX;
        shakeStartY = event.clientY;
        shakePathDist = 0;
      }

      // 2. Stretch sound (only when not dizzy-shaking and actively pulling outward)
      const isDizzy = now < dizzyUntil;
      if (!isDizzy && totalDist > 32 && totalDist > maxStretchDist + 8) {
        maxStretchDist = totalDist;
        const stretchRatio = Math.min(1.0, (totalDist - 25) / 170);
        sound.playStretch(stretchRatio);
      } else if (totalDist < maxStretchDist - 25) {
        maxStretchDist = totalDist + 10;
      }

      ray(event);
      if (raycaster.ray.intersectPlane(plane, worldTarget)) physics.moveGrab(worldTarget);
      return;
    }
    ray(event);
    const hit = raycaster.intersectObject(slime.body, false).length > 0;
    canvas.style.cursor = hit ? 'grab' : 'default';
  });
  const triggerDizzyLand = (impact = 1.3) => {
    if (!isDizzyPending) return;
    isDizzyPending = false;
    sound.playDizzyLand(impact);
    slime?.faceMotion.react('dizzy');
  };
  const release = event => {
    if (pointerId === null || (event?.pointerId !== undefined && event.pointerId !== pointerId)) return;
    const id = pointerId;
    pointerId = null;
    dizzyUntil = 0;
    physics.endGrab();

    const willBeDizzy = isDizzyPending && performance.now() < dizzyPendingUntil;
    const shouldCelebrate = event?.type === 'pointerup' && !willBeDizzy;
    slime.faceMotion.grab(false, shouldCelebrate);

    if (event?.type === 'pointerup') {
      if (!moved && performance.now() - pressTime < 160) poke();
      else sound.playBounce(moved ? 1.15 : 0.8);
    }

    // Guarantee landing trigger when touching ground
    if (willBeDizzy) {
      let settled = false;
      const checkLand = () => {
        if (settled) return;
        if (physics.position.y <= 0.08 || !isDizzyPending) {
          settled = true;
          triggerDizzyLand(1.3);
        }
      };
      const timer = setInterval(checkLand, 16);
      setTimeout(() => { settled = true; clearInterval(timer); }, 900);
    } else {
      isDizzyPending = false;
    }

    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    ui.setInteraction('idle');
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  window.addEventListener('blur', () => { release(); clearGaze(); });
  window.addEventListener('keydown', event => {
    if (event.code !== 'Space' || event.repeat || /INPUT|BUTTON|TEXTAREA/.test(event.target.tagName)) return;
    event.preventDefault(); poke();
  });
  const unlockAudio = () => sound.resume();
  window.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
  window.addEventListener('keydown', unlockAudio, { once: true, passive: true });

  window.addEventListener('pointermove', registerActivity, { passive: true });
  window.addEventListener('pointerdown', registerActivity, { passive: true });
  window.addEventListener('keydown', registerActivity, { passive: true });

  const ambientInterval = setInterval(() => {
    if (!ready || document.hidden || pointerId !== null) return;
    if (performance.now() - lastActivity > 12000 && !slime?.faceMotion.isSleeping) {
      sound.playAmbientBubble();
      lastActivity = performance.now() - 3000;
    }
  }, 3000);

  let frames = 0, fps = 0, previous = performance.now(), windowStart = previous, windowFrames = 0;
  let time = 0, slowWindows = 0;
  const frameTimes = [];
  slime.update(0);
  await renderer.compileAsync(scene, camera);
  ready = true;
  ui.setStatus('ready');
  renderer.setAnimationLoop(now => {
    const elapsed = now - previous;
    previous = now;
    if (document.hidden) return;
    const dt = Math.min(Math.max(elapsed / 1000, 0), 1 / 15);
    time += dt;

    // Sleep mode when inactive for 15 seconds
    if (pointerId === null && !slime.faceMotion.isSleeping && now - lastActivity > 15000 && slime.faceMotion.anger < 0.25) {
      slime.faceMotion.fallAsleep();
    }

    // Gentle rhythmic snoring when sleeping
    if (slime.faceMotion.isSleeping && now - lastSnoreTime > 2400) {
      lastSnoreTime = now;
      sound.playSnore();
    }

    physics.update(dt);
    slime.update(time);
    studio.update(physics.position);
    ui.setMood(slime.faceMotion.mood);
    rageMeter.update(dt, slime.faceMotion.anger, slime.faceMotion.mood, slime.faceMotion.isSleeping);
    renderer.render(scene, camera);
    frames++; windowFrames++;
    frameTimes.push(elapsed);
    if (frameTimes.length > 600) frameTimes.shift();
    if (now - windowStart >= 1000) {
      fps = windowFrames * 1000 / (now - windowStart);
      ui.setFps(fps);
      if (fps < 52 && frames > 180) slowWindows++; else slowWindows = 0;
      if (slowWindows >= 3 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); resize(); slowWindows = 0; }
      windowStart = now; windowFrames = 0;
    }
  });
  renderer.backend.device.lost.then(info => {
    if (info.reason === 'destroyed') return;
    ready = false;
    renderer.setAnimationLoop(null);
    ui.showError('deviceLost');
  });
  document.addEventListener('visibilitychange', () => {
    previous = performance.now(); windowStart = previous; windowFrames = 0;
    if (document.hidden) { release(); clearGaze(); }
  });
  const getDiagnostics = () => ({
    backend: renderer.backend.isWebGPUBackend ? 'native-WebGPU' : 'unexpected',
    fps, frames, dpr, frameTimes: [...frameTimes],
    drawCalls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles,
    memory: { ...renderer.info.memory },
    face: { expression: slime.faceMotion.expression, ...slime.faceMotion.state },
    physics: { ...physics.diagnostics, center: { ...physics.position }, dragging: pointerId !== null },
  });
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('test')) {
    window.__SOFTIE__ = { getDiagnostics, physics, renderer, slime, studio, camera, rageMeter };
  }
  window.addEventListener('pagehide', () => {
    renderer.setAnimationLoop(null); observer.disconnect();
    clearInterval(ambientInterval);
    window.removeEventListener('pointermove', followPointer);
    document.documentElement.removeEventListener('pointerleave', clearGaze);
    reducedMotion.removeEventListener('change', syncMotionPreference);
    slime.dispose(); studio.dispose(); renderer.dispose(); rageMeter.dispose();
  }, { once: true });
}

start().catch(error => {
  console.error('[softie] WebGPU initialization:', error);
  ui.showError(error.message || 'initFailed');
});
