// NEON Voice Isolator + Spectral Denoiser (AudioWorklet)
// Single-channel FFT noise reduction with overlap-add + VAD-based voice isolation.
// Goal: remove steady noise AND strongly suppress keyboard/mouse/click/thump sounds.
// Notes:
// - This is still not a full ML model (like Krisp). It will greatly reduce
//   typing/clicks, especially when you are not speaking, and will also reduce
//   transient noises during speech, but cannot guarantee perfect isolation in
//   every acoustic scenario.

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function clampInt(x, a, b) { x = (x|0); return Math.max(a, Math.min(b, x)); }

class NeonDenoiseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const opt = (options && options.processorOptions) || {};

    // Aggressiveness: 0..1.35 (higher = stronger suppression).
    this.aggr = clamp(typeof opt.aggressiveness === 'number' ? opt.aggressiveness : 1.25, 0, 1.35);
    // Minimum per-bin gain (prevents robotic artifacts; lower = more suppression).
    this.floor = clamp(typeof opt.floor === 'number' ? opt.floor : 0.030, 0.015, 0.25);
    // How quickly noise profile adapts (fast path). Higher = learns noise faster.
    this.noiseLearn = clamp(typeof opt.noiseLearn === 'number' ? opt.noiseLearn : 0.11, 0.005, 0.35);
    // Speech detector RMS threshold (only a weak hint; VAD uses spectral cues too).
    this.speechThresh = clamp(typeof opt.speechThresh === 'number' ? opt.speechThresh : 0.016, 0.004, 0.10);

    // Voice isolation (strongly suppress audio when speech is not present)
    this.voiceIsolation = !!opt.voiceIsolation;
    this.voiceHold = clampInt((opt.voiceHoldFrames ?? opt.voiceHold ?? 22), 0, 80); // hangover
    this.silenceFloor = clamp(typeof opt.silenceFloor === 'number' ? opt.silenceFloor : 0.0, 0.0, 0.20);

    // Extra high-frequency damping to reduce typing/clicks (applied >~6kHz)
    this.hfDamp = clamp(typeof opt.hfDamp === 'number' ? opt.hfDamp : 0.60, 0.15, 1.0);

    // Transient/click suppression (helps with keyboard/mouse taps).
    // 0..1.0 (higher = stronger suppression of clicks)
    this.clickSup = clamp(typeof opt.clickSuppression === 'number' ? opt.clickSuppression : 1.0, 0, 1.0);
    // Minimum attenuation applied to high-band during detected click (0..1)
    this.clickFloor = clamp(typeof opt.clickFloor === 'number' ? opt.clickFloor : 0.07, 0.02, 0.9);
    // How long the attenuation lingers after a click (frames)
    this.clickHold = clampInt((opt.clickHoldFrames ?? 10), 0, 30);
    // Broadband attenuation applied on detected click even during speech (0..1)
    this.clickBroad = clamp(typeof opt.clickBroad === 'number' ? opt.clickBroad : 0.70, 0.20, 1.0);

    // Extra tuning to keep speech natural while still suppressing clicks.
    // Midband gets only light ducking (so voice doesn't get "underwater").
    this.clickMid = clamp(typeof opt.clickMid === 'number' ? opt.clickMid : 0.93, 0.70, 1.0);
    // Low band ducking during thumps/clicks.
    this.clickLow = clamp(typeof opt.clickLow === 'number' ? opt.clickLow : 0.55, 0.20, 1.0);
    // Broadband ducking during speech (keep very close to 1.0).
    this.clickBroadSpeech = clamp(typeof opt.clickBroadSpeech === 'number' ? opt.clickBroadSpeech : 0.97, 0.70, 1.0);

    // VAD tuning knobs
    this.vadMidDom = clamp(typeof opt.vadMidDom === 'number' ? opt.vadMidDom : 1.15, 0.8, 3.0); // mid/hf dominance threshold
    this.vadFlatMax = clamp(typeof opt.vadFlatMax === 'number' ? opt.vadFlatMax : 0.82, 0.4, 1.0); // midband spectral flatness max for speech


    // Adaptive / auto-tune
    this.autoTune = !!opt.autoTune;
    this.warmupFrames = clampInt((opt.warmupFrames ?? 120), 0, 300);
    this._warm = this.warmupFrames;

    // Extra time-domain transient cues (helps catch keyboard/mouse clicks during speech)
    this.crestThresh = clamp(typeof opt.crestThresh === 'number' ? opt.crestThresh : 5.2, 2.5, 12.0);
    this.diffThresh = clamp(typeof opt.diffThresh === 'number' ? opt.diffThresh : 0.42, 0.05, 2.0);


    this._speechHang = 0;

    // FFT size. N=256 (hop=128) keeps CPU low and matches render quantum.
    this.N = 256;
    this.hop = 128;
    this.eps = 1e-8;

    this.frame = new Float32Array(this.N);
    this.ola = new Float32Array(this.N);

    // Hann window
    this.win = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) {
      this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.N);
    }

    // Bit-reversal
    this.bitrev = new Uint16Array(this.N);
    const bits = Math.round(Math.log2(this.N));
    for (let i = 0; i < this.N; i++) {
      let x = i;
      let r = 0;
      for (let b = 0; b < bits; b++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      this.bitrev[i] = r;
    }

    // Twiddles
    const half = this.N >> 1;
    this.cos = new Float32Array(half);
    this.sin = new Float32Array(half);
    for (let k = 0; k < half; k++) {
      const ang = (2 * Math.PI * k) / this.N;
      this.cos[k] = Math.cos(ang);
      this.sin[k] = Math.sin(ang);
    }

    this.re = new Float32Array(this.N);
    this.im = new Float32Array(this.N);

    // Noise profile (magnitude) + smoothed gains (bins 0..N/2)
    this.noise = new Float32Array(half + 1);
    this.gSmooth = new Float32Array(half + 1);
    this.gTmp = new Float32Array(half + 1);
    this.prevMag = new Float32Array(half + 1);

    for (let i = 0; i < this.noise.length; i++) {
      this.noise[i] = 1e-3;
      this.gSmooth[i] = 1;
      this.prevMag[i] = 1e-3;
    }

    // Click detector state (band energies)
    this._clickCountdown = 0;
    this._prevHf = 0;
    this._prevLf = 0;
  }

  _fft(inverse) {
    const N = this.N;
    const re = this.re;
    const im = this.im;

    // bit-reversal permutation
    for (let i = 0; i < N; i++) {
      const j = this.bitrev[i];
      if (j > i) {
        let tr = re[i]; re[i] = re[j]; re[j] = tr;
        let ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }

    // iterative Cooley-Tukey
    for (let len = 2; len <= N; len <<= 1) {
      const half = len >> 1;
      const step = N / len;
      for (let i = 0; i < N; i += len) {
        for (let j = 0; j < half; j++) {
          const idx = (j * step) | 0;
          const c = this.cos[idx];
          const s = inverse ? this.sin[idx] : -this.sin[idx];

          const ur = re[i + j];
          const ui = im[i + j];
          const vr = re[i + j + half] * c - im[i + j + half] * s;
          const vi = re[i + j + half] * s + im[i + j + half] * c;

          re[i + j] = ur + vr;
          im[i + j] = ui + vi;
          re[i + j + half] = ur - vr;
          im[i + j + half] = ui - vi;
        }
      }
    }

    // scale for inverse
    if (inverse) {
      const invN = 1 / N;
      for (let i = 0; i < N; i++) {
        re[i] *= invN;
        im[i] *= invN;
      }
    }
  }

  _rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) {
      const x = buf[i];
      s += x * x;
    }
    return Math.sqrt(s / buf.length);
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output || output.length === 0) return true;

    const inCh = input[0];
    const outCh0 = output[0];

    const hop = this.hop;
    const N = this.N;
    const half = N >> 1;

    // Shift frame left by hop, append new hop samples
    this.frame.copyWithin(0, hop);
    this.frame.set(inCh, N - hop);

    // Prepare FFT input (windowed)
    for (let i = 0; i < N; i++) {
      this.re[i] = this.frame[i] * this.win[i];
      this.im[i] = 0;
    }

    // FFT
    this._fft(false);

    // --- band energies + midband flatness for VAD and click detection ---
    // N=256 @ 48kHz => ~187.5 Hz/bin.
    const kMidLo = 2;   // ~375 Hz
    const kMidHi = 18;  // ~3375 Hz
    const kHfLo = 20;   // ~3750 Hz
    const kHfDamp = 32; // ~6000 Hz

    let lfE = 0;
    let midE = 0;
    let hfE = 0;

    // Midband flatness (geometric / arithmetic mean)
    let midLogSum = 0;
    let midSum = 0;
    let midCnt = 0;

    // Fast scan
    for (let k = 0; k <= half; k++) {
      const rr = this.re[k];
      const ii = this.im[k];
      const p = rr * rr + ii * ii;

      if (k <= 1) lfE += p;
      if (k >= kMidLo && k <= kMidHi) {
        midE += p;
        const mag = Math.sqrt(p) + this.eps;
        midSum += mag;
        midLogSum += Math.log(mag);
        midCnt++;
      }
      if (k >= kHfLo) hfE += p;
    }

    const midFlat = midCnt > 0 ? (Math.exp(midLogSum / midCnt) / ((midSum / midCnt) + this.eps)) : 1.0;
    const domMidHf = midE / (hfE + 1e-9);

    // Weak speech hint from RMS (helps if spectrum is quiet)
    const rms = this._rms(inCh);
    // Time-domain transient cues (clicks/keyboard are spiky vs voiced speech).
    let peak = 0;
    let diff = 0;
    let prev = inCh[0] || 0;
    for (let i = 0; i < inCh.length; i++) {
      const x = inCh[i] || 0;
      const ax = Math.abs(x);
      if (ax > peak) peak = ax;
      if (i > 0) diff += Math.abs(x - prev);
      prev = x;
    }
    const crest = peak / (rms + this.eps);
    const diffNorm = (diff / inCh.length) / (rms + this.eps);
    const tdTransient = (peak > (this.speechThresh * 0.65)) && (crest >= this.crestThresh) && (diffNorm >= this.diffThresh);

    const rmsOk = rms >= (this.speechThresh * 0.85);

    // Voice-like if mid dominates HF and midband isn't too "flat" (flat noise is not speech)
    const voiceLike = (domMidHf >= this.vadMidDom) && (midFlat <= this.vadFlatMax);
    const isSpeechNow = (voiceLike && (rmsOk || midE > 5e-7)) || (domMidHf >= (this.vadMidDom * 1.7) && midE > 4e-7);

    if (isSpeechNow) this._speechHang = this.voiceHold;
    else if (this._speechHang > 0) this._speechHang--;

    const speechOn = !this.voiceIsolation ? true : (this._speechHang > 0);
    // Warmup: learn the room noise profile quickly while you're silent.
    if (this._warm > 0) {
      if (isSpeechNow) this._warm = 0;
      else this._warm--;
    }
    const warm = (this._warm > 0);


    // --- Click / transient detector ---
    // 1) sudden HF jump (keyboard/mouse) AND HF dominance over mid -> click
    // 2) per-bin HF flux spikes -> click
    // 3) big LF thump jump when speech is off -> click/thump
    let clickDetected = false;

    // HF energy jump
    const hfJump = (hfE - this._prevHf) / (this._prevHf + 1e-6);
    this._prevHf = hfE;

    // LF thump jump
    const lfJump = (lfE - this._prevLf) / (this._prevLf + 1e-6);
    this._prevLf = lfE;

    const hfDominates = hfE > (midE * 2.1 + 1e-9);
    const bigHfJump = hfJump > 1.25;
    const bigLfJump = lfJump > 1.8;
    const tdLikelyClick = (this.clickSup > 0) && tdTransient && (hfJump > 0.55 || hfDominates || (!speechOn && bigLfJump));

    if (this.clickSup > 0) {
      if ((hfDominates && bigHfJump) || (!speechOn && bigLfJump && lfE > (midE * 0.9 + 1e-9)) || tdLikelyClick) {
        clickDetected = true;
      }
    }

    // Per-bin HF flux (catches some clicks during speech)
    if (this.clickSup > 0 && !clickDetected) {
      let spikes = 0;
      for (let k = kHfLo; k <= half; k++) {
        const rr = this.re[k];
        const ii = this.im[k];
        const mag = Math.sqrt(rr * rr + ii * ii) + this.eps;
        const r = mag / (this.prevMag[k] + this.eps);
        if (r > 3.5) { spikes++; if (spikes >= 3) break; }
      }
      if (spikes >= 3 || (tdTransient && spikes >= 2)) clickDetected = true;
    }

    if (clickDetected) this._clickCountdown = Math.max(this._clickCountdown, this.clickHold + (tdTransient ? 6 : 0));
    else if (this._clickCountdown > 0) this._clickCountdown--;

    // Dynamic HF damping (auto-tune for noisy mics)
    let hfD = this.hfDamp;
    if (this.autoTune) {
      const hfRatio = hfE / (midE + 1e-9);
      if (hfRatio > 1.35) hfD = Math.min(hfD, 0.45);
      if (!speechOn && hfRatio > 1.10) hfD = Math.min(hfD, 0.35);
    }

    // Noise learning rates
    let learnFast = this.noiseLearn;
    if (warm) learnFast = Math.min(0.28, Math.max(learnFast, 0.20));
    const learnSlow = Math.max(0.0025, learnFast * (speechOn ? 0.05 : 0.20));

    // Compute gains per bin
    for (let k = 0; k <= half; k++) {
      const rr = this.re[k];
      const ii = this.im[k];
      const mag = Math.sqrt(rr * rr + ii * ii) + this.eps;

      // Save prev magnitude for flux detection
      this.prevMag[k] = mag;

      // Guarded per-bin noise adaptation:
      const n0 = this.noise[k];
      const close = (mag <= n0 * (1.45 + 0.35 * this.aggr));
      const lr = close ? learnFast : learnSlow;
      this.noise[k] = n0 + (mag - n0) * lr;

      const nEst = this.noise[k];

      // Over-subtract for suppression.
      // NOTE: previous builds used a very aggressive subtraction that could
      // make speech sound thin/robotic. This curve keeps denoise strong but
      // preserves vocal tone.
      const sub = nEst * (0.95 + 1.65 * this.aggr);
      let g = (mag - sub) / mag;
      g = clamp(g, this.floor, 1);

      // Extra suppression outside the speech band (helps isolate voice)
      if (this.voiceIsolation) {
        if (k <= 1) g *= 0.35; // thumps/rumble
        if (k >= kHfDamp) {
          // stronger HF damping: keep some clarity but reduce typing harshness
          g *= speechOn ? hfD : 0.06;
        }
      }

      // Smooth gains to reduce musical noise
      const gs = this.gSmooth[k];
      const sm = gs + (g - gs) * 0.26;
      this.gSmooth[k] = sm;
    }

    // Light frequency-domain smoothing (reduce musical noise).
    this.gTmp[0] = this.gSmooth[0];
    for (let k = 1; k < half; k++) {
      this.gTmp[k] = 0.18 * this.gSmooth[k - 1] + 0.64 * this.gSmooth[k] + 0.18 * this.gSmooth[k + 1];
    }
    this.gTmp[half] = this.gSmooth[half];

    const clickActive = (this._clickCountdown > 0);

    // Apply gains to spectrum (mirror bins)
    for (let k = 0; k <= half; k++) {
      let g = this.gTmp[k];

      // During detected clicks:
      // - attenuate HF strongly
      // - lightly duck midband (keeps speech intelligible)
      // - duck lows to reduce desk thumps
      // - keep broadband ducking minimal during speech
      if (clickActive) {
        const amt = this.clickSup;
        const kKbLo = 10; // ~1.9kHz
        const kKbHi = 42; // ~7.9kHz

        if (k >= kHfLo) {
          const floor = this.clickFloor;
          const clickG = (1 - amt) * 1.0 + amt * floor;
          g *= clickG;
        }

        if (k <= 1) {
          const lowG = (1 - amt) * 1.0 + amt * this.clickLow;
          g *= lowG;
        } else if (k >= kMidLo && k <= kMidHi) {
          const midG = (1 - amt) * 1.0 + amt * this.clickMid;
          g *= midG;
        }

        // Additional ducking in the "keyboard band" during transients.
        if (k >= kKbLo && k <= kKbHi) {
          const kb = speechOn ? 0.65 : 0.40;
          g *= (1 - amt) * 1.0 + amt * kb;
        }

        g *= (speechOn ? this.clickBroadSpeech : this.clickBroad);
      }

      // Voice isolation gating: if not speech, output near-silence
      if (this.voiceIsolation && !speechOn) {
        g *= this.silenceFloor;
      }

      this.re[k] *= g;
      this.im[k] *= g;

      if (k > 0 && k < half) {
        const mk = N - k;
        this.re[mk] *= g;
        this.im[mk] *= g;
      }
    }

    // iFFT
    this._fft(true);

    // Overlap-add into OLA buffer (window again)
    for (let i = 0; i < N; i++) {
      this.ola[i] += this.re[i] * this.win[i];
    }

    // Output first hop samples
    for (let i = 0; i < hop; i++) {
      outCh0[i] = this.ola[i];
    }

    // Shift OLA buffer left by hop and clear tail
    this.ola.copyWithin(0, hop);
    this.ola.fill(0, N - hop);

    // Copy to other channels if present
    for (let c = 1; c < output.length; c++) {
      const outCh = output[c];
      for (let i = 0; i < hop; i++) outCh[i] = outCh0[i];
    }

    return true;
  }
}

registerProcessor('neon-denoise-processor', NeonDenoiseProcessor);
