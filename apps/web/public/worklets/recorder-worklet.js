// AudioWorklet that forwards mono PCM frames to the main thread in ~2048-sample batches.
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048);
    this.n = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const ch0 = input[0];
      const ch1 = input.length > 1 ? input[1] : null;
      for (let i = 0; i < ch0.length; i++) {
        this.buf[this.n++] = ch1 ? (ch0[i] + ch1[i]) * 0.5 : ch0[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.slice(0));
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("recorder-processor", RecorderProcessor);
