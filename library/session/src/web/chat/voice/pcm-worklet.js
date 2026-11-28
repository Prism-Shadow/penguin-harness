// Web Audio delivers mono input resampled at the context rate. Batch it so long recordings
// do not send a main-thread message every render quantum. The output stays silent.
class DictationPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(2048);
    this.used = 0;
    this.finished = false;
    this.port.onmessage = () => {
      this.finished = true;
      this.flush();
      this.port.postMessage(null);
    };
  }

  flush() {
    if (this.used) {
      const chunk = this.samples.buffer.slice(0, this.used * 2);
      this.port.postMessage(chunk, [chunk]);
      this.used = 0;
    }
  }

  process(inputs) {
    if (this.finished) return false;
    for (const value of inputs[0]?.[0] ?? []) {
      const sample = Math.max(-1, Math.min(1, value));
      this.samples[this.used++] = Math.round(sample * (sample < 0 ? 32768 : 32767));
      if (this.used === this.samples.length) this.flush();
    }
    return true;
  }
}
registerProcessor("dictation-pcm", DictationPcm);
