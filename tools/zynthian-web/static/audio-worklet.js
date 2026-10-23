// The ring is bounded: a suspended or slow tab never replays seconds of stale audio.
class ZynthianAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(8192 * 2);
    this.read = 0;
    this.write = 0;
    this.available = 0;
    this.started = false;
    this.port.onmessage = ({ data }) => {
      const input = new Float32Array(data);
      if (input.length > this.samples.length) return;
      if (this.available + input.length > this.samples.length) {
        this.read = this.write = this.available = 0;
        this.started = false;
      }
      for (const sample of input) {
        this.samples[this.write] = sample;
        this.write = (this.write + 1) % this.samples.length;
      }
      this.available += input.length;
    };
  }

  process(inputs, outputs) {
    const [left, right] = outputs[0];
    if (!this.started && this.available >= 2048) this.started = true;
    if (!this.started) return true;
    for (let i = 0; i < left.length; i++) {
      if (this.available < 2) {
        this.started = false;
        break;
      }
      left[i] = this.samples[this.read];
      right[i] = this.samples[(this.read + 1) % this.samples.length];
      this.read = (this.read + 2) % this.samples.length;
      this.available -= 2;
    }
    return true;
  }
}
registerProcessor('zynthian-audio', ZynthianAudio);
