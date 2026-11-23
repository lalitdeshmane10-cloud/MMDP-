import { createTracker } from './pitch.mjs';

class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.factor = Math.max(1, Math.floor(sampleRate / 12000));
    const rate = sampleRate / this.factor;
    this.buffer = new Float32Array(Math.ceil(rate * 0.05));
    this.readWindow = new Float32Array(this.buffer.length);
    this.hop = Math.round(rate * 0.01);
    this.track = createTracker(rate, this.buffer.length);
    this.index = 0;
    this.filled = 0;
    this.sinceAnalysis = 0;
    this.count = 0;
    this.sum = 0;
  }

  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    for (let i = 0; i < samples.length; i++) {
      this.sum += samples[i];
      if (++this.count < this.factor) continue;
      this.buffer[this.index] = this.sum / this.factor;
      this.count = 0;
      this.sum = 0;
      this.index = (this.index + 1) % this.buffer.length;
      this.filled = Math.min(this.filled + 1, this.buffer.length);
      this.sinceAnalysis++;
      if (this.filled !== this.buffer.length || this.sinceAnalysis < this.hop) continue;
      this.sinceAnalysis = 0;
      this.readWindow.set(this.buffer.subarray(this.index));
      this.readWindow.set(this.buffer.subarray(0, this.index), this.buffer.length - this.index);
      const time = (currentFrame + i + 1) / sampleRate - 0.025;
      this.port.postMessage({ ...this.track(this.readWindow), time });
    }
    return true;
  }
}

registerProcessor('pitch-processor', PitchProcessor);
