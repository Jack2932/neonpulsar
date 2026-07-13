// Noise gate for voice: attenuates signal when below a threshold.
// Helps reduce constant background hiss/rumble.

function dbToLin(db) {
  return Math.pow(10, db / 20);
}

function coefFromMs(ms) {
  const t = Math.max(1, ms) / 1000;
  return 1 - Math.exp(-1 / (sampleRate * t));
}

class NoiseGateProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opt = (options && options.processorOptions) || {};
    const thresholdDb = (typeof opt.thresholdDb === 'number') ? opt.thresholdDb : -50;
    const floorDb = (typeof opt.floorDb === 'number') ? opt.floorDb : -36;
    const attackMs = (typeof opt.attackMs === 'number') ? opt.attackMs : 6;
    const releaseMs = (typeof opt.releaseMs === 'number') ? opt.releaseMs : 160;

    this.threshold = dbToLin(thresholdDb);
    this.floor = dbToLin(floorDb);
    this.attackCoef = coefFromMs(attackMs);
    this.releaseCoef = coefFromMs(releaseMs);

    this.env = 0;
    this.gain = 1;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    // Determine gate target using first channel envelope
    const ch0 = input[0];
    for (let i = 0; i < ch0.length; i++) {
      const x = Math.abs(ch0[i]);
      const coef = (x > this.env) ? this.attackCoef : this.releaseCoef;
      this.env += (x - this.env) * coef;

      const target = (this.env >= this.threshold) ? 1 : this.floor;
      const gcoef = (target > this.gain) ? this.attackCoef : this.releaseCoef;
      this.gain += (target - this.gain) * gcoef;
    }

    // Apply gain to all channels
    for (let c = 0; c < output.length; c++) {
      const inCh = input[c] || input[0];
      const outCh = output[c];
      for (let i = 0; i < outCh.length; i++) {
        outCh[i] = (inCh[i] || 0) * this.gain;
      }
    }
    return true;
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
