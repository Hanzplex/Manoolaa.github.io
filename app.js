/**
 * birthday-cake/app.js
 * Handles: candle rendering, microphone analysis,
 * blow detection, confetti, and reset logic.
 */

'use strict';

/* ── Constants ──────────────────────────────────────────────── */
const CANDLE_COUNT       = 5;
const BLOW_RMS_THRESHOLD = 10;    // 0–255 scale
const BLOW_SUSTAIN_MS    = 200;   // ms of continuous blow to extinguish one candle
const METER_SMOOTH       = 0.72;  // exponential smoothing factor (0–1)
const CONFETTI_COUNT     = 120;

const GEM_COLORS = ['#e8c97a', '#4ecdc4', '#f09ab0', '#a78bfa', '#f5e4a8'];
const CONFETTI_COLORS = [
  '#e8c97a', '#d4607a', '#4ecdc4', '#a78bfa',
  '#f09ab0', '#ffffff', '#f5e4a8', '#7c5fd4'
];

/* ── State ──────────────────────────────────────────────────── */
const state = {
  litCount:      CANDLE_COUNT,
  nextCandle:    0,
  blowStart:     null,
  smoothedLevel: 0,
  isListening:   false,
  audioCtx:      null,
  analyser:       null,
  micStream:     null,
  animFrameId:   null,
};

/* ── DOM References ─────────────────────────────────────────── */
const DOM = {
  candles:     document.getElementById('candles'),
  meterFill:   document.getElementById('meterFill'),
  meterLabel:  document.getElementById('meterLabel'),
  micBtn:      document.getElementById('micBtn'),
  hint:        document.getElementById('hint'),
  celebration: document.getElementById('celebration'),
  resetBtn:    document.getElementById('resetBtn'),
  canvas:      document.getElementById('particleCanvas'),
};

/* ══════════════════════════════════════════════════════════════
   CANDLE RENDERING
══════════════════════════════════════════════════════════════ */

/**
 * Build and insert all candle DOM elements.
 */
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

/**
 * Add pearl gems to the top tier.
 */
function buildGems() {
  const gemsEl = document.querySelector('.tier__gems');
  if (!gemsEl) return;

  GEM_COLORS.forEach(color => {
    const gem = document.createElement('div');
    gem.className = 'gem';
    gem.style.color = color;
    gem.style.background = color;
    gemsEl.appendChild(gem);
  });
}

/**
 * Extinguish a single candle by index.
 * @param {number} index - candle index (0-based)
 */
function extinguishCandle(index) {
  const candle = document.getElementById(`candle-${index}`);
  if (!candle || candle.classList.contains('candle--out')) return;

  candle.classList.add('candle--out');
  state.litCount--;

  if (state.litCount === 0) {
    setTimeout(triggerCelebration, 700);
  }
}

/**
 * Re-enable all candles for a fresh round.
 */
function relightAllCandles() {
  document.querySelectorAll('.candle').forEach(c => c.classList.remove('candle--out'));
  state.litCount   = CANDLE_COUNT;
  state.nextCandle = 0;
  state.blowStart  = null;
}

/* ══════════════════════════════════════════════════════════════
   MICROPHONE & AUDIO ANALYSIS
══════════════════════════════════════════════════════════════ */

/**
 * Request microphone access and begin the analysis loop.
 */
async function startMicrophone() {
  if (state.isListening) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    state.micStream = stream;
    state.audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
    state.analyser   = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 256;

    const source = state.audioCtx.createMediaStreamSource(stream);
    source.connect(state.analyser);

    state.isListening = true;
    setMicActiveUI();
    runAnalysisLoop();

  } catch (err) {
    console.error('Microphone error:', err);
    setMicErrorUI(err);
  }
}

/**
 * Stop the microphone stream and analysis loop.
 */
function stopMicrophone() {
  state.isListening = false;

  if (state.animFrameId) {
    cancelAnimationFrame(state.animFrameId);
    state.animFrameId = null;
  }
  if (state.micStream) {
    state.micStream.getTracks().forEach(t => t.stop());
    state.micStream = null;
  }
  if (state.audioCtx) {
    state.audioCtx.close();
    state.audioCtx = null;
  }
}

/**
 * Main audio analysis loop — runs on every animation frame.
 */
function runAnalysisLoop() {
  if (!state.isListening) return;

  const buffer = new Uint8Array(state.analyser.frequencyBinCount);
  state.analyser.getByteTimeDomainData(buffer);

  const rms = computeRMS(buffer);

  // Smooth the display level
  state.smoothedLevel = state.smoothedLevel * METER_SMOOTH + rms * (1 - METER_SMOOTH);

  updateMeter(state.smoothedLevel);
  detectBlow(rms);

  if (state.litCount > 0) {
    state.animFrameId = requestAnimationFrame(runAnalysisLoop);
  } else {
    stopMicrophone();
  }
}

/**
 * Compute Root Mean Square of a PCM buffer (values are 0-255, centre = 128).
 * @param {Uint8Array} buffer
 * @returns {number} RMS in range 0–128
 */
function computeRMS(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const deviation = buffer[i] - 128;
    sum += deviation * deviation;
  }
  return Math.sqrt(sum / buffer.length);
}

/**
 * Detect a sustained blow and extinguish the next candle.
 * @param {number} rms - current RMS value
 */
function detectBlow(rms) {
  if (rms >= BLOW_RMS_THRESHOLD) {
    if (!state.blowStart) {
      state.blowStart = performance.now();
    } else if (performance.now() - state.blowStart >= BLOW_SUSTAIN_MS) {
      extinguishCandle(state.nextCandle);
      state.nextCandle++;
      state.blowStart = null;
      flashMeter();
    }
  } else {
    state.blowStart = null;
  }
}

/* ══════════════════════════════════════════════════════════════
   UI UPDATES
══════════════════════════════════════════════════════════════ */

/**
 * Update the volume meter bar width.
 * @param {number} level - smoothed RMS level
 */
function updateMeter(level) {
  const pct = Math.min(100, (level / BLOW_RMS_THRESHOLD) * 100);
  DOM.meterFill.style.width = `${pct}%`;
}

/**
 * Briefly change meter colour to acknowledge a candle being blown out.
 */
function flashMeter() {
  DOM.meterFill.style.background = 'linear-gradient(90deg, #d4607a, #f09ab0)';
  setTimeout(() => {
    DOM.meterFill.style.background = '';
  }, 500);
}

/** Switch UI to "listening" state after mic granted. */
function setMicActiveUI() {
  const btnText = DOM.micBtn.querySelector('.btn__text');
  const btnIcon = DOM.micBtn.querySelector('.btn__icon');
  btnText.textContent = 'BLOW';
  btnIcon.textContent = '';
  DOM.micBtn.disabled = true;
  DOM.hint.textContent = 'Blow steadily into the mic — each breath extinguishes a candle.';
  DOM.meterLabel.textContent = 'Blow strength';
}

/**
 * Display an error state in the UI.
 * @param {Error} err
 */
function setMicErrorUI(err) {
  const btnText = DOM.micBtn.querySelector('.btn__text');
  btnText.textContent = 'Mic access denied';
  DOM.micBtn.style.background = 'linear-gradient(135deg, #666, #444)';
  DOM.hint.textContent =
    'Please allow microphone access in your browser settings, then reload the page.';
}

/* ══════════════════════════════════════════════════════════════
   CELEBRATION
══════════════════════════════════════════════════════════════ */

/** Show celebration overlay and fire confetti. */
function triggerCelebration() {
  DOM.celebration.hidden = false;
  launchConfetti();
}

/** Hide celebration overlay and reset everything. */
function resetExperience() {
  DOM.celebration.hidden = true;
  relightAllCandles();

  // Re-enable mic button
  const btnText = DOM.micBtn.querySelector('.btn__text');
  const btnIcon = DOM.micBtn.querySelector('.btn__icon');
  btnText.textContent = 'Enable Mic & Blow';
  btnIcon.textContent = '';
  DOM.micBtn.disabled = false;
  DOM.micBtn.style.background = '';
  DOM.hint.textContent = 'Grant microphone access, then blow steadily to extinguish each candle.';
  DOM.meterFill.style.width = '0%';
  state.smoothedLevel = 0;
  state.isListening = false;
}

/* ══════════════════════════════════════════════════════════════
   CONFETTI
══════════════════════════════════════════════════════════════ */

/**
 * Launch confetti pieces onto the page.
 */
function launchConfetti() {
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    setTimeout(() => spawnConfettiPiece(), i * 18);
  }
}

/**
 * Create and animate a single confetti piece.
 */
function spawnConfettiPiece() {
  const el = document.createElement('div');
  el.className = 'confetti';

  const size     = 6 + Math.random() * 9;
  const isCircle = Math.random() > 0.5;
  const duration = 2.2 + Math.random() * 2;
  const color    = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];

  el.style.cssText = `
    left: ${Math.random() * 100}vw;
    width: ${size}px;
    height: ${size}px;
    background: ${color};
    border-radius: ${isCircle ? '50%' : '2px'};
    animation-duration: ${duration}s;
    animation-delay: ${Math.random() * 0.4}s;
  `;

  document.body.appendChild(el);
  setTimeout(() => el.remove(), (duration + 0.6) * 1000);
}

/* ══════════════════════════════════════════════════════════════
   PARTICLE CANVAS (starfield)
══════════════════════════════════════════════════════════════ */

/**
 * Draw and animate a starfield on the background canvas.
 */
function initParticleCanvas() {
  const canvas = DOM.canvas;
  const ctx    = canvas.getContext('2d');

  const stars = [];
  const STAR_COUNT = 160;

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function buildStars() {
    stars.length = 0;
    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x:       Math.random() * canvas.width,
        y:       Math.random() * canvas.height,
        r:       0.5 + Math.random() * 1.8,
        alpha:   Math.random(),
        speed:   0.003 + Math.random() * 0.008,
        phase:   Math.random() * Math.PI * 2,
      });
    }
  }

  function drawFrame(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    stars.forEach(s => {
      const a = 0.15 + 0.85 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      ctx.fill();
    });
    requestAnimationFrame(drawFrame);
  }

  resize();
  buildStars();
  window.addEventListener('resize', () => { resize(); buildStars(); });
  requestAnimationFrame(drawFrame);
}

/* ══════════════════════════════════════════════════════════════
   EVENT LISTENERS
══════════════════════════════════════════════════════════════ */

DOM.micBtn.addEventListener('click', startMicrophone);
DOM.resetBtn.addEventListener('click', resetExperience);

/* ══════════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════════ */

function init() {
  buildCandles();
  buildGems();
  initParticleCanvas();
}

document.addEventListener('DOMContentLoaded', init);
