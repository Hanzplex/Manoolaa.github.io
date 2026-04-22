/**
 * birthday-cake/app.js
 *
 * Sections:
 *  1. Constants & State
 *  2. DOM References
 *  3. Candle Rendering
 *  4. Microphone & Blow Detection
 *  5. UI Updates
 *  6. Sound Engine  (realistic multi-layer synthesis)
 *  7. Fireworks Animation (canvas)
 *  8. Celebration Controller
 *  9. Confetti (CSS)
 * 10. Starfield Canvas
 * 11. Event Listeners & Init
 */

'use strict';

/* ══════════════════════════════════════════════════════════════
   1. CONSTANTS & STATE
══════════════════════════════════════════════════════════════ */

const CANDLE_COUNT       = 5;
const BLOW_RMS_THRESHOLD = 1;
const BLOW_SUSTAIN_MS    = 250;
const METER_SMOOTH       = 0.72;
const CONFETTI_COUNT     = 140;

const GEM_COLORS = ['#e8c97a', '#4ecdc4', '#f09ab0', '#a78bfa', '#f5e4a8'];

const CONFETTI_COLORS = [
  '#e8c97a', '#d4607a', '#4ecdc4', '#a78bfa',
  '#f09ab0', '#ffffff', '#f5e4a8', '#7c5fd4',
];

/** Pyrotechnic colour sets — each entry is [core, mid, edge] */
const FIREWORK_COLORS = [
  ['#ff4444', '#ff8888', '#ffaaaa'],   // red
  ['#ffaa00', '#ffcc44', '#ffe088'],   // gold
  ['#00ccff', '#66ddff', '#aaeeff'],   // cyan
  ['#44ff88', '#88ffaa', '#bbffcc'],   // green
  ['#ff44cc', '#ff88dd', '#ffbbee'],   // magenta
  ['#ffffff', '#ffffcc', '#ffeeaa'],   // silver-white
  ['#aa44ff', '#cc88ff', '#eeccff'],   // purple
  ['#ff6600', '#ff9944', '#ffcc88'],   // orange
];

const state = {
  /* candles */
  litCount:      CANDLE_COUNT,
  nextCandle:    0,
  blowStart:     null,
  /* mic */
  smoothedLevel: 0,
  isListening:   false,
  audioCtx:      null,
  analyser:      null,
  micStream:     null,
  animFrameId:   null,
  /* sound */
  soundCtx:      null,
  /* fireworks */
  fwCanvas:      null,
  fwCtx:         null,
  fwAnimId:      null,
  fwRockets:     [],
  fwParticles:   [],
  fwActive:      false,
};

/* ══════════════════════════════════════════════════════════════
   2. DOM REFERENCES
══════════════════════════════════════════════════════════════ */

const DOM = {
  candles:     document.getElementById('candles'),
  meterFill:   document.getElementById('meterFill'),
  meterLabel:  document.getElementById('meterLabel'),
  micBtn:      document.getElementById('micBtn'),
  hint:        document.getElementById('hint'),
  celebration: document.getElementById('celebration'),
  resetBtn:    document.getElementById('resetBtn'),
  bgCanvas:    document.getElementById('particleCanvas'),
  fwCanvas:    document.getElementById('fireworksCanvas'),
};

/* ══════════════════════════════════════════════════════════════
   3. CANDLE RENDERING
══════════════════════════════════════════════════════════════ */

function buildCandles() {
  DOM.candles.innerHTML = '';
  for (let i = 0; i < CANDLE_COUNT; i++) {
    const candle = document.createElement('div');
    candle.className = 'candle';
    candle.id = `candle-${i}`;
    candle.setAttribute('aria-label', `Candle ${i + 1}`);
    candle.innerHTML = `
      <div class="candle__flame-wrap" aria-hidden="true">
        <div class="candle__glow"></div>
        <div class="candle__flame"></div>
      </div>
      <div class="candle__smoke" aria-hidden="true"></div>
      <div class="candle__wick"></div>
      <div class="candle__body"></div>
    `;
    DOM.candles.appendChild(candle);
  }
}

function buildGems() {
  const gemsEl = document.querySelector('.tier__gems');
  if (!gemsEl) return;
  GEM_COLORS.forEach(color => {
    const gem = document.createElement('div');
    gem.className = 'gem';
    gem.style.cssText = `color:${color};background:${color}`;
    gemsEl.appendChild(gem);
  });
}

function extinguishCandle(index) {
  const candle = document.getElementById(`candle-${index}`);
  if (!candle || candle.classList.contains('candle--out')) return;
  candle.classList.add('candle--out');
  state.litCount--;
  if (state.litCount === 0) setTimeout(triggerCelebration, 700);
}

function relightAllCandles() {
  document.querySelectorAll('.candle').forEach(c => c.classList.remove('candle--out'));
  state.litCount   = CANDLE_COUNT;
  state.nextCandle = 0;
  state.blowStart  = null;
}

/* ══════════════════════════════════════════════════════════════
   4. MICROPHONE & BLOW DETECTION
══════════════════════════════════════════════════════════════ */

async function startMicrophone() {
  if (state.isListening) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    state.micStream = stream;
    state.audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
    state.analyser  = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 256;
    state.audioCtx.createMediaStreamSource(stream).connect(state.analyser);
    state.isListening = true;
    setMicActiveUI();
    runAnalysisLoop();
  } catch (err) {
    console.error('Microphone error:', err);
    setMicErrorUI();
  }
}

function stopMicrophone() {
  state.isListening = false;
  if (state.animFrameId) { cancelAnimationFrame(state.animFrameId); state.animFrameId = null; }
  if (state.micStream)   { state.micStream.getTracks().forEach(t => t.stop()); state.micStream = null; }
  if (state.audioCtx)    { state.audioCtx.close(); state.audioCtx = null; }
}

function runAnalysisLoop() {
  if (!state.isListening) return;
  const buffer = new Uint8Array(state.analyser.frequencyBinCount);
  state.analyser.getByteTimeDomainData(buffer);
  const rms = computeRMS(buffer);
  state.smoothedLevel = state.smoothedLevel * METER_SMOOTH + rms * (1 - METER_SMOOTH);
  updateMeter(state.smoothedLevel);
  detectBlow(rms);
  state.animFrameId = state.litCount > 0
    ? requestAnimationFrame(runAnalysisLoop)
    : (stopMicrophone(), null);
}

function computeRMS(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) { const d = buffer[i] - 128; sum += d * d; }
  return Math.sqrt(sum / buffer.length);
}

function detectBlow(rms) {
  if (rms >= BLOW_RMS_THRESHOLD) {
    if (!state.blowStart) {
      state.blowStart = performance.now();
    } else if (performance.now() - state.blowStart >= BLOW_SUSTAIN_MS) {
      extinguishCandle(state.nextCandle++);
      state.blowStart = null;
      flashMeter();
    }
  } else {
    state.blowStart = null;
  }
}

/* ══════════════════════════════════════════════════════════════
   5. UI UPDATES
══════════════════════════════════════════════════════════════ */

function updateMeter(level) {
  DOM.meterFill.style.width = `${Math.min(100, (level / BLOW_RMS_THRESHOLD) * 100)}%`;
}

function flashMeter() {
  DOM.meterFill.style.background = 'linear-gradient(90deg, #d4607a, #f09ab0)';
  setTimeout(() => { DOM.meterFill.style.background = ''; }, 500);
}

function setMicActiveUI() {
  DOM.micBtn.querySelector('.btn__text').textContent = 'Listening\u2026';
  DOM.micBtn.querySelector('.btn__icon').textContent = '🟢';
  DOM.micBtn.disabled = true;
  DOM.hint.textContent = 'Blow steadily into the mic \u2014 each breath extinguishes a candle.';
}

function setMicErrorUI() {
  DOM.micBtn.querySelector('.btn__text').textContent = 'Mic access denied';
  DOM.micBtn.style.background = 'linear-gradient(135deg,#666,#444)';
  DOM.hint.textContent = 'Allow microphone access in browser settings, then reload.';
}

/* ══════════════════════════════════════════════════════════════
   6. SOUND ENGINE — Realistic 4-layer synthesis

   Each firework burst has four simultaneous layers:
     A) Whistle rise  — pitched sawtooth sweep before bang
     B) Crack         — ultra-short noise transient (the "bang")
     C) Boom body     — sub-bass shaped noise + sine thud
     D) Shimmer tail  — mid-band noise crackle that decays slowly

   No external files. Works offline. No CORS issues.
══════════════════════════════════════════════════════════════ */

function getSoundCtx() {
  if (!state.soundCtx) {
    state.soundCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.soundCtx.state === 'suspended') state.soundCtx.resume();
  return state.soundCtx;
}

/** Create a white-noise buffer of given duration. */
function makeNoise(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d   = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * Play one realistic firework burst.
 * @param {number} delaySeconds  — when to play (from AudioContext.currentTime)
 * @param {number} [size=1]      — loudness/size multiplier
 */
function playFireworkBurst(delaySeconds = 0, size = 1) {
  const ctx = getSoundCtx();
  const T   = ctx.currentTime + delaySeconds;

  /* ── A) Whistle rise ── */
  const wDur = 0.16 + Math.random() * 0.12;
  const wStart = Math.max(ctx.currentTime + 0.001, T - wDur);
  const wOsc = ctx.createOscillator();
  wOsc.type = 'sawtooth';
  wOsc.frequency.setValueAtTime(280 + Math.random() * 180, wStart);
  wOsc.frequency.exponentialRampToValueAtTime(1600 + Math.random() * 900, T);

  const wGain = ctx.createGain();
  wGain.gain.setValueAtTime(0, wStart);
  wGain.gain.linearRampToValueAtTime(0.09 * size, T - wDur * 0.25);
  wGain.gain.exponentialRampToValueAtTime(0.001, T + 0.01);

  const wHPF = ctx.createBiquadFilter();
  wHPF.type = 'highpass';
  wHPF.frequency.value = 1000;

  wOsc.connect(wHPF); wHPF.connect(wGain); wGain.connect(ctx.destination);
  wOsc.start(wStart); wOsc.stop(T + 0.02);

  /* ── B) Crack transient ── */
  const crackSrc = ctx.createBufferSource();
  crackSrc.buffer = makeNoise(ctx, 0.055);

  const crackHPF = ctx.createBiquadFilter();
  crackHPF.type = 'highpass';
  crackHPF.frequency.value = 2800;

  const crackGain = ctx.createGain();
  crackGain.gain.setValueAtTime(1.6 * size, T);
  crackGain.gain.exponentialRampToValueAtTime(0.001, T + 0.05);

  crackSrc.connect(crackHPF); crackHPF.connect(crackGain); crackGain.connect(ctx.destination);
  crackSrc.start(T); crackSrc.stop(T + 0.06);

  /* ── C) Sub-bass boom ── */
  const boomSrc = ctx.createBufferSource();
  boomSrc.buffer = makeNoise(ctx, 1.1);

  const boomLPF = ctx.createBiquadFilter();
  boomLPF.type = 'lowpass';
  boomLPF.frequency.setValueAtTime(300, T);
  boomLPF.frequency.exponentialRampToValueAtTime(38, T + 0.75);
  boomLPF.Q.value = 1.4;

  const boomGain = ctx.createGain();
  boomGain.gain.setValueAtTime(0, T);
  boomGain.gain.linearRampToValueAtTime(1.2 * size, T + 0.007);
  boomGain.gain.exponentialRampToValueAtTime(0.001, T + 0.9);

  // Sub sine thud
  const subOsc = ctx.createOscillator();
  subOsc.type = 'sine';
  subOsc.frequency.setValueAtTime(70, T);
  subOsc.frequency.exponentialRampToValueAtTime(24, T + 0.4);
  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0.55 * size, T);
  subGain.gain.exponentialRampToValueAtTime(0.001, T + 0.45);

  boomSrc.connect(boomLPF); boomLPF.connect(boomGain); boomGain.connect(ctx.destination);
  subOsc.connect(subGain); subGain.connect(ctx.destination);
  boomSrc.start(T); boomSrc.stop(T + 1.1);
  subOsc.start(T); subOsc.stop(T + 0.5);

  /* ── D) Shimmer / crackle tail ── */
  const shimSrc = ctx.createBufferSource();
  shimSrc.buffer = makeNoise(ctx, 2.8);

  const shimBPF = ctx.createBiquadFilter();
  shimBPF.type = 'bandpass';
  shimBPF.frequency.setValueAtTime(3200, T + 0.04);
  shimBPF.frequency.exponentialRampToValueAtTime(700, T + 2.2);
  shimBPF.Q.value = 0.7;

  const shimGain = ctx.createGain();
  shimGain.gain.setValueAtTime(0, T);
  shimGain.gain.linearRampToValueAtTime(0.20 * size, T + 0.07);
  shimGain.gain.setValueAtTime(0.16 * size, T + 0.15);
  shimGain.gain.exponentialRampToValueAtTime(0.001, T + 2.4);

  shimSrc.connect(shimBPF); shimBPF.connect(shimGain); shimGain.connect(ctx.destination);
  shimSrc.start(T); shimSrc.stop(T + 2.8);
}

/**
 * Play a sequence of firework sounds timed to match visual bursts.
 * @param {number[]} burstTimes  — seconds-from-now for each burst
 */
function playFireworkSoundSequence(burstTimes) {
  const sizes = [1.2, 0.85, 1.05, 1.3, 0.9, 1.1, 0.8, 1.25, 1.0, 0.95, 1.15, 1.35, 0.88, 1.1, 1.0];
  burstTimes.forEach((t, i) => playFireworkBurst(t, sizes[i % sizes.length]));
}

/** Play the Happy Birthday melody via oscillator synthesis. */
function playHappyBirthday() {
  const ctx   = getSoundCtx();
  const BEAT  = 60 / 138;
  const START = ctx.currentTime + 0.5;

  const N = {
    G4:392.00, A4:440.00, B4:493.88,
    C5:523.25, D5:587.33, E5:659.25, G5:783.99,
  };
  const score = [
    [N.G4,0.75],[N.G4,0.25],[N.A4,1],[N.G4,1],[N.C5,1],[N.B4,2],
    [N.G4,0.75],[N.G4,0.25],[N.A4,1],[N.G4,1],[N.D5,1],[N.C5,2],
    [N.G4,0.75],[N.G4,0.25],[N.G5,1],[N.E5,1],[N.C5,1],[N.B4,1],[N.A4,1.5],
    [N.E5,0.75],[N.E5,0.25],[N.D5,1],[N.C5,1],[N.D5,1],[N.C5,3],
  ];

  let t = START;
  score.forEach(([freq, beats]) => {
    const dur = beats * BEAT;
    const on  = dur * 0.82;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sine'; osc2.type = 'triangle';
    osc1.frequency.value = freq; osc2.frequency.value = freq * 2.005;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.30, t + 0.015);
    env.gain.setValueAtTime(0.24, t + 0.07);
    env.gain.exponentialRampToValueAtTime(0.001, t + on);

    const dly = ctx.createDelay(0.1); dly.delayTime.value = 0.048;
    const fb  = ctx.createGain(); fb.gain.value = 0.2;

    osc1.connect(env); osc2.connect(env);
    env.connect(ctx.destination);
    env.connect(dly); dly.connect(fb); fb.connect(dly); fb.connect(ctx.destination);
    osc1.start(t); osc2.start(t);
    osc1.stop(t + on + 0.06); osc2.stop(t + on + 0.06);
    t += dur;
  });
}

function stopCelebrationAudio() {
  if (state.soundCtx) { state.soundCtx.close(); state.soundCtx = null; }
}

/* ══════════════════════════════════════════════════════════════
   7. FIREWORKS ANIMATION (canvas)

   Physics:
   • Rocket — rises from the bottom with a glowing trail
   • On reaching apex → explodes into ~140 particles
   • Particles — spread radially, affected by gravity + drag
   • Some particles twinkle (alpha modulated by sin wave)
   • Additive blending ('lighter') makes overlapping sparks glow
══════════════════════════════════════════════════════════════ */

function resizeFWCanvas() {
  if (!state.fwCanvas) return;
  state.fwCanvas.width  = window.innerWidth;
  state.fwCanvas.height = window.innerHeight;
}

/**
 * Queue a single rocket launch after delayMs milliseconds.
 * @param {number} delayMs
 * @returns {number}  approximate burst time in seconds from now
 */
function launchRocket(delayMs) {
  const W = state.fwCanvas.width;
  const H = state.fwCanvas.height;

  // Burst target: upper 40 % of viewport
  const tx = W * (0.12 + Math.random() * 0.76);
  const ty = H * (0.06 + Math.random() * 0.38);

  // Launch origin: bottom strip
  const sx = W * (0.2 + Math.random() * 0.60);
  const sy = H;

  const travelMs  = 950 + Math.random() * 650;
  const colorSet  = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
  const frameTime = 1000 / 60;
  const frames    = travelMs / frameTime;

  setTimeout(() => {
    if (!state.fwActive) return;
    state.fwRockets.push({
      x: sx, y: sy,
      vx: (tx - sx) / frames,
      vy: (ty - sy) / frames,
      trail:    [],
      colorSet,
      life:     frames,
      elapsed:  0,
    });
  }, delayMs);

  return (delayMs + travelMs) / 1000;
}

/** Create burst particles from an exploding rocket. */
function explodeRocket(rocket) {
  const MAIN   = 130 + Math.floor(Math.random() * 50);
  const speed  = 3.8 + Math.random() * 2.8;
  const colors = rocket.colorSet;

  for (let i = 0; i < MAIN; i++) {
    const angle = (Math.PI * 2 * i) / MAIN + (Math.random() - 0.5) * 0.45;
    const spd   = speed * (0.35 + Math.random() * 0.65);
    const life  = 55 + Math.random() * 55;
    state.fwParticles.push({
      x:    rocket.x, y: rocket.y,
      vx:   Math.cos(angle) * spd,
      vy:   Math.sin(angle) * spd,
      color: colors[Math.floor(Math.random() * colors.length)],
      size:  1.6 + Math.random() * 2.4,
      alpha: 1,
      life, maxLife: life,
      gravity: 0.055 + Math.random() * 0.045,
      drag:    0.966 + Math.random() * 0.024,
      twinkle: Math.random() > 0.55,
    });
  }

  // Fine glitter streaks
  for (let i = 0; i < 25; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd   = 1.5 + Math.random() * 5;
    const life  = 25 + Math.random() * 30;
    state.fwParticles.push({
      x: rocket.x, y: rocket.y,
      vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd,
      color: '#ffffff', size: 0.9, alpha: 0.85,
      life, maxLife: life,
      gravity: 0.025, drag: 0.985, twinkle: false,
    });
  }
}

/** One rAF frame for the fireworks canvas. */
function fireworksFrame() {
  if (!state.fwActive) return;

  const canvas = state.fwCanvas;
  const ctx    = state.fwCtx;
  const W = canvas.width;
  const H = canvas.height;

  // Dim the previous frame — creates motion-blur trails
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(10, 8, 20, 0.20)';
  ctx.fillRect(0, 0, W, H);

  // Additive blending makes sparks glow where they overlap
  ctx.globalCompositeOperation = 'lighter';

  /* Rockets */
  for (let i = state.fwRockets.length - 1; i >= 0; i--) {
    const r = state.fwRockets[i];
    r.elapsed++;

    r.trail.push({ x: r.x, y: r.y });
    if (r.trail.length > 14) r.trail.shift();

    // Draw glowing trail
    r.trail.forEach((dot, ti) => {
      const progress = ti / r.trail.length;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, 1.8 * progress, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,220,80,${(progress * 0.7).toFixed(2)})`;
      ctx.fill();
    });

    // Rocket head glow
    const g = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, 5);
    g.addColorStop(0, 'rgba(255,255,200,1)');
    g.addColorStop(1, 'rgba(255,180,0,0)');
    ctx.beginPath();
    ctx.arc(r.x, r.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    r.x += r.vx;
    r.y += r.vy;

    if (r.elapsed >= r.life) {
      explodeRocket(r);
      state.fwRockets.splice(i, 1);
    }
  }

  /* Particles */
  for (let i = state.fwParticles.length - 1; i >= 0; i--) {
    const p = state.fwParticles[i];
    p.life--;
    p.vx *= p.drag; p.vy *= p.drag;
    p.vy += p.gravity;
    p.x  += p.vx;   p.y  += p.vy;

    let a = p.life / p.maxLife;
    if (p.twinkle) a *= 0.4 + 0.6 * Math.abs(Math.sin(p.life * 0.45));

    if (p.life <= 0) { state.fwParticles.splice(i, 1); continue; }

    // Draw spark with inner glow
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();

    // Tiny white core on larger sparks
    if (p.size > 2) {
      ctx.globalAlpha = a * 0.7;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
  }

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  state.fwAnimId = requestAnimationFrame(fireworksFrame);
}

/**
 * Launch the full fireworks show.
 * @returns {number[]}  burst times in seconds (for audio sync)
 */
function startFireworksShow() {
  state.fwCanvas    = DOM.fwCanvas;
  state.fwCtx       = DOM.fwCanvas.getContext('2d');
  state.fwRockets   = [];
  state.fwParticles = [];
  state.fwActive    = true;

  resizeFWCanvas();
  DOM.fwCanvas.style.display = 'block';

  // Launch schedule in ms — 15 rockets over ~8 s
  const launches = [
    80,  580,  1050, 1480, 1960,
    2500, 2980, 3450, 3980, 4600,
    5200, 5800, 6400, 7000, 7700,
  ];

  const burstTimes = launches.map(ms => launchRocket(ms));

  state.fwAnimId = requestAnimationFrame(fireworksFrame);

  // Stop launching after 10 s; hide canvas once particles drain
  setTimeout(() => {
    state.fwActive = false;
    setTimeout(() => {
      if (DOM.fwCanvas) DOM.fwCanvas.style.display = 'none';
    }, 3500);
  }, 10000);

  return burstTimes;
}

function stopFireworks() {
  state.fwActive = false;
  if (state.fwAnimId) { cancelAnimationFrame(state.fwAnimId); state.fwAnimId = null; }
  state.fwRockets   = [];
  state.fwParticles = [];
  const fw = DOM.fwCanvas;
  if (fw) {
    fw.style.display = 'none';
    fw.getContext('2d').clearRect(0, 0, fw.width, fw.height);
  }
}

/* ══════════════════════════════════════════════════════════════
   8. CELEBRATION CONTROLLER
══════════════════════════════════════════════════════════════ */

function triggerCelebration() {
  DOM.celebration.hidden = false;
  launchConfetti();
  const burstTimes = startFireworksShow();   // visual
  playFireworkSoundSequence(burstTimes);      // audio synced to visuals
  playHappyBirthday();
}

function resetExperience() {
  DOM.celebration.hidden = true;
  stopCelebrationAudio();
  stopFireworks();
  relightAllCandles();

  DOM.micBtn.querySelector('.btn__text').textContent = 'Enable Mic & Blow';
  DOM.micBtn.querySelector('.btn__icon').textContent = '🎤';
  DOM.micBtn.disabled    = false;
  DOM.micBtn.style.background = '';
  DOM.hint.textContent   = 'Grant microphone access, then blow steadily to extinguish each candle.';
  DOM.meterFill.style.width  = '0%';
  state.smoothedLevel = 0;
  state.isListening   = false;
}

/* ══════════════════════════════════════════════════════════════
   9. CONFETTI
══════════════════════════════════════════════════════════════ */

function launchConfetti() {
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    setTimeout(() => spawnConfettiPiece(), i * 13);
  }
}

function spawnConfettiPiece() {
  const el       = document.createElement('div');
  el.className   = 'confetti';
  const size     = 6 + Math.random() * 9;
  const duration = 2.2 + Math.random() * 2;
  const color    = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
  el.style.cssText = `
    left:${Math.random() * 100}vw;
    width:${size}px; height:${size}px;
    background:${color};
    border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
    animation-duration:${duration}s;
    animation-delay:${Math.random() * 0.5}s;
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), (duration + 0.8) * 1000);
}

/* ══════════════════════════════════════════════════════════════
   10. STARFIELD CANVAS (background)
══════════════════════════════════════════════════════════════ */

function initParticleCanvas() {
  const canvas = DOM.bgCanvas;
  const ctx    = canvas.getContext('2d');
  const stars  = [];

  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }

  function build() {
    stars.length = 0;
    for (let i = 0; i < 160; i++) {
      stars.push({
        x: Math.random() * canvas.width, y: Math.random() * canvas.height,
        r: 0.5 + Math.random() * 1.8,
        speed: 0.003 + Math.random() * 0.008,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  function draw(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    stars.forEach(s => {
      const a = 0.15 + 0.85 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }

  resize(); build();
  window.addEventListener('resize', () => { resize(); build(); resizeFWCanvas(); });
  requestAnimationFrame(draw);
}

/* ══════════════════════════════════════════════════════════════
   11. EVENT LISTENERS & INIT
══════════════════════════════════════════════════════════════ */

DOM.micBtn.addEventListener('click', startMicrophone);
DOM.resetBtn.addEventListener('click', resetExperience);

function init() {
  buildCandles();
  buildGems();
  initParticleCanvas();

  // Style the fireworks canvas
  Object.assign(DOM.fwCanvas.style, {
    position:       'fixed',
    inset:          '0',
    pointerEvents:  'none',
    zIndex:         '50',
    display:        'none',
  });
}

document.addEventListener('DOMContentLoaded', init);
