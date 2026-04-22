/**
 * birthday-cake/app.js
 * Handles: candle rendering, microphone analysis,
 * blow detection, confetti, reset logic, and celebration audio.
 *
 * Audio engine uses the Web Audio API exclusively —
 * no external files needed. All sounds are synthesized.
 */

'use strict';

/* ── Constants ──────────────────────────────────────────────── */
const CANDLE_COUNT       = 5;
const BLOW_RMS_THRESHOLD = 1;    // 0–255 scale
const BLOW_SUSTAIN_MS    = 500;   // ms of continuous blow to extinguish one candle
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
  soundCtx:      null,   // separate context for celebration audio
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
  btnText.textContent = 'BLOWWW';
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
   SOUND ENGINE
   — Fireworks: real .ogg/.mp3 samples via Web Audio API
   — Happy Birthday: synthesized melody (no file needed)
══════════════════════════════════════════════════════════════ */

/**
 * Real firework audio sample URLs (Freesound / public domain OGG).
 * We load several variants so each burst sounds different.
 */
const FIREWORK_URLS = [
  'https://freesound.org/data/previews/270/270402_5123851-lq.mp3',  // single crack boom
  'https://freesound.org/data/previews/270/270401_5123851-lq.mp3',  // whistle + burst
  'https://freesound.org/data/previews/456/456790_8438588-lq.mp3',  // multi-pop burst
  'https://freesound.org/data/previews/397/397354_4284968-lq.mp3',  // distant boom
];

/** Decoded AudioBuffer cache so we only fetch each file once. */
const audioBufferCache = new Map();

/**
 * Lazily create a shared AudioContext for celebration sounds.
 * Kept separate from the mic AudioContext to avoid conflicts.
 * @returns {AudioContext}
 */
function getSoundCtx() {
  if (!state.soundCtx) {
    state.soundCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.soundCtx.state === 'suspended') state.soundCtx.resume();
  return state.soundCtx;
}

/**
 * Fetch and decode an audio file into an AudioBuffer.
 * Results are cached by URL.
 * @param {string} url
 * @returns {Promise<AudioBuffer>}
 */
async function loadAudioBuffer(url) {
  if (audioBufferCache.has(url)) return audioBufferCache.get(url);
  const ctx = getSoundCtx();
  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  const decoded = await ctx.decodeAudioData(arrayBuffer);
  audioBufferCache.set(url, decoded);
  return decoded;
}

/**
 * Pre-fetch all firework samples in the background so they're
 * ready to play instantly when celebration triggers.
 */
async function preloadFireworkSounds() {
  try {
    await Promise.all(FIREWORK_URLS.map(url => loadAudioBuffer(url)));
  } catch (e) {
    // Silently ignore — fallback synthesis will kick in
    console.warn('Firework preload failed, will use synthesis fallback:', e);
  }
}

/**
 * Play a real firework sound sample.
 * Falls back to synthesis if the sample failed to load.
 * @param {number} delaySeconds - scheduling delay in seconds
 */
async function playFirework(delaySeconds = 0) {
  const ctx = getSoundCtx();
  const url = FIREWORK_URLS[Math.floor(Math.random() * FIREWORK_URLS.length)];

  try {
    const buffer = await loadAudioBuffer(url);

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Slight random pitch shift per burst for variety
    source.playbackRate.value = 0.85 + Math.random() * 0.35;

    // Master gain with a tail fade
    const gain = ctx.createGain();
    const startAt = ctx.currentTime + delaySeconds;
    gain.gain.setValueAtTime(0.9, startAt);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + buffer.duration + 0.3);

    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(startAt);

  } catch (e) {
    // Synthesis fallback
    playFireworkSynthesis(delaySeconds);
  }
}

/**
 * Fallback synthesis firework in case network fetch fails.
 * @param {number} delaySeconds
 */
function playFireworkSynthesis(delaySeconds = 0) {
  const ctx = getSoundCtx();
  const now = ctx.currentTime + delaySeconds;

  const bufLen = ctx.sampleRate * 0.8;
  const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;

  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.setValueAtTime(200, now);
  lpf.frequency.exponentialRampToValueAtTime(35, now + 0.6);

  const g = ctx.createGain();
  g.gain.setValueAtTime(1.2, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

  noise.connect(lpf);
  lpf.connect(g);
  g.connect(ctx.destination);
  noise.start(now);
  noise.stop(now + 0.8);
}

/**
 * Schedule a realistic sequence of firework bursts over ~8 seconds.
 */
function playFireworkSequence() {
  const schedule = [0, 0.6, 1.2, 1.7, 2.4, 3.1, 3.6, 4.3, 5.0, 5.7, 6.5, 7.2];
  schedule.forEach(t => playFirework(t));
}

/**
 * Play the full "Happy Birthday to You" melody using the Web Audio API.
 *
 * Note frequencies (Hz) for the melody.
 * Tune: G G A G C B | G G A G D C | G G G(high) E C B A |
 *       F F E C D C
 *
 * Each entry: [frequency, durationBeats]  (1 beat = 0.42 s at ~143 BPM)
 */
function playHappyBirthday() {
  const ctx   = getSoundCtx();
  const BPM   = 138;
  const BEAT  = 60 / BPM;           // seconds per beat
  const START = ctx.currentTime + 0.3; // small lead-in

  // Note frequencies (Hz)
  const N = {
    G3: 196.00, A3: 220.00, B3: 246.94,
    C4: 261.63, D4: 293.66, E4: 329.63,
    F4: 349.23, G4: 392.00, A4: 440.00,
    B4: 493.88, C5: 523.25, D5: 587.33,
    E5: 659.25, G5: 783.99,
  };

  // [freq, beats]  — rests use freq=0
  const score = [
    // "Hap-py  Birth-day  to  You"
    [N.G4, 0.75], [N.G4, 0.25], [N.A4, 1], [N.G4, 1], [N.C5, 1], [N.B4, 2],
    // "Hap-py  Birth-day  to  You"
    [N.G4, 0.75], [N.G4, 0.25], [N.A4, 1], [N.G4, 1], [N.D5, 1], [N.C5, 2],
    // "Hap-py  Birth-day  dear  [name]"
    [N.G4, 0.75], [N.G4, 0.25], [N.G5, 1], [N.E5, 1], [N.C5, 1], [N.B4, 1], [N.A4, 1.5],
    // "Hap-py  Birth-day  to  You"
    [N.E5, 0.75], [N.E5, 0.25], [N.D5, 1], [N.C5, 1], [N.D5, 1], [N.C5, 3],
  ];

  let cursor = START;

  score.forEach(([freq, beats]) => {
    const dur    = beats * BEAT;
    const noteOn = dur * 0.85; // slight staccato — gate at 85 %

    if (freq > 0) {
      /* Oscillator (bell-like: sine + harmonics) */
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sine';
      osc2.type = 'triangle';
      osc1.frequency.value = freq;
      osc2.frequency.value = freq * 2.01; // slight detune for warmth

      /* Gain envelope */
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, cursor);
      env.gain.linearRampToValueAtTime(0.28, cursor + 0.012);  // attack
      env.gain.setValueAtTime(0.22, cursor + 0.06);            // slight decay
      env.gain.exponentialRampToValueAtTime(0.001, cursor + noteOn);

      /* Reverb-ish: tiny convolver via delay+feedback */
      const delay = ctx.createDelay(0.08);
      delay.delayTime.value = 0.045;
      const fbGain = ctx.createGain();
      fbGain.gain.value = 0.18;

      osc1.connect(env);
      osc2.connect(env);
      env.connect(ctx.destination);
      env.connect(delay);
      delay.connect(fbGain);
      fbGain.connect(delay);
      fbGain.connect(ctx.destination);

      osc1.start(cursor);
      osc2.start(cursor);
      osc1.stop(cursor + noteOn + 0.05);
      osc2.stop(cursor + noteOn + 0.05);
    }

    cursor += dur;
  });
}

/**
 * Stop / clean up the celebration audio context.
 */
function stopCelebrationAudio() {
  if (state.soundCtx) {
    state.soundCtx.close();
    state.soundCtx = null;
  }
}

/* ══════════════════════════════════════════════════════════════
   CELEBRATION
══════════════════════════════════════════════════════════════ */

/** Show celebration overlay, fire confetti, and play sounds. */
function triggerCelebration() {
  DOM.celebration.hidden = false;
  launchConfetti();
  playFireworkSequence();
  playHappyBirthday();
}

/** Hide celebration overlay and reset everything. */
function resetExperience() {
  DOM.celebration.hidden = true;
  stopCelebrationAudio();
  relightAllCandles();

  // Re-enable mic button
  const btnText = DOM.micBtn.querySelector('.btn__text');
  const btnIcon = DOM.micBtn.querySelector('.btn__icon');
  btnText.textContent = 'CLICK HERE AND BLOW';
  btnIcon.textContent = '';
  DOM.micBtn.disabled = false;
  DOM.micBtn.style.background = '';
  DOM.hint.textContent = 'BLOWWWWWW';
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
  // Pre-fetch firework samples after first user interaction (autoplay policy)
  document.addEventListener('click', preloadFireworkSounds, { once: true });
}

document.addEventListener('DOMContentLoaded', init);
