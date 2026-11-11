/**
 * Microphone recorder with a simple energy voice-activity detector (VAD).
 *
 * Captures mono PCM via AudioWorklet (falls back to ScriptProcessor on very old browsers),
 * keeps the full recording in memory (never uploaded until the user submits; never stored),
 * and emits speech-segment boundaries for chunked live transcription:
 *   - a segment opens when speech starts,
 *   - closes after `silenceMs` of silence or when it reaches `maxSegmentMs`.
 */
import { downsample, concatFloat32, TARGET_SR } from "./wav";
import { openPreferredMic } from "./mic-preference";

export interface RecorderCallbacks {
  onLevel?: (rms: number, speaking: boolean) => void;
  onSpeechStart?: () => void;
  onSegmentClosed?: (seg: { index: number; startSample: number; endSample: number }) => void;
  onMaxDuration?: () => void;
}

export interface RecorderOptions {
  silenceMs?: number;
  maxSegmentMs?: number;
  maxDurationMs?: number;
}

export class MicRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = []; // raw at ctx.sampleRate
  private total = 0;
  sampleRate = 48000;
  private noiseFloor = 0.004;
  private inSpeech = false;
  private segStart = 0;
  private lastVoice = 0;
  private segIndex = 0;
  private speechSeen = false;
  private opts: Required<RecorderOptions>;

  constructor(private cb: RecorderCallbacks = {}, opts: RecorderOptions = {}) {
    this.opts = { silenceMs: 700, maxSegmentMs: 10_000, maxDurationMs: 180_000, ...opts };
  }

  static supported(): boolean {
    return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && !!(window.AudioContext || (window as unknown as { webkitAudioContext: unknown }).webkitAudioContext);
  }

  /** Name of the microphone actually in use, and whether the chosen one was unavailable. */
  deviceLabel = "";
  usedFallback = false;

  async start(): Promise<void> {
    // Uses the microphone chosen in Settings (falls back to the system default if it is unplugged).
    const { stream, fellBack } = await openPreferredMic();
    this.stream = stream;
    this.usedFallback = fellBack;
    this.deviceLabel = stream.getAudioTracks()[0]?.label ?? "";
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.sampleRate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    const handle = (frame: Float32Array) => this.onFrame(frame);
    if (this.ctx.audioWorklet) {
      await this.ctx.audioWorklet.addModule("/worklets/recorder-worklet.js");
      const node = new AudioWorkletNode(this.ctx, "recorder-processor");
      node.port.onmessage = (e) => handle(e.data as Float32Array);
      this.node = node;
    } else {
      const sp = this.ctx.createScriptProcessor(2048, 1, 1);
      sp.onaudioprocess = (e) => handle(new Float32Array(e.inputBuffer.getChannelData(0)));
      this.node = sp;
    }
    this.source.connect(this.node);
    // Keep the graph pulling without audible output.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(this.ctx.destination);
  }

  private onFrame(frame: Float32Array) {
    this.chunks.push(frame);
    const frameStart = this.total;
    this.total += frame.length;
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    // Adaptive noise floor (only updated while not speaking).
    if (!this.inSpeech) this.noiseFloor = Math.max(0.0015, this.noiseFloor * 0.97 + rms * 0.03);
    const threshold = Math.max(this.noiseFloor * 3, 0.012);
    const voiced = rms > threshold;
    const nowMs = (this.total / this.sampleRate) * 1000;
    if (voiced) {
      this.lastVoice = nowMs;
      if (!this.inSpeech) {
        this.inSpeech = true;
        this.segStart = Math.max(0, frameStart - Math.floor(this.sampleRate * 0.25)); // 250 ms pre-roll
        if (!this.speechSeen) {
          this.speechSeen = true;
          this.cb.onSpeechStart?.();
        }
      }
    }
    if (this.inSpeech) {
      const segMs = ((this.total - this.segStart) / this.sampleRate) * 1000;
      if (nowMs - this.lastVoice > this.opts.silenceMs || segMs > this.opts.maxSegmentMs) this.closeSegment();
    }
    this.cb.onLevel?.(rms, this.inSpeech);
    if (nowMs > this.opts.maxDurationMs) this.cb.onMaxDuration?.();
  }

  private closeSegment() {
    if (!this.inSpeech) return;
    this.inSpeech = false;
    this.cb.onSegmentClosed?.({ index: this.segIndex++, startSample: this.segStart, endSample: this.total });
  }

  /** Current open segment, if any (for partial transcription snapshots). */
  openSegment(): { index: number; startSample: number; endSample: number } | null {
    return this.inSpeech ? { index: this.segIndex, startSample: this.segStart, endSample: this.total } : null;
  }

  get durationMs() {
    return (this.total / this.sampleRate) * 1000;
  }

  get hasSpeech() {
    return this.speechSeen;
  }

  /** Extract [start, end) raw samples, downsampled to 16 kHz. */
  slice16k(startSample: number, endSample: number): Float32Array {
    const all = this.rawRange(startSample, endSample);
    return downsample(all, this.sampleRate, TARGET_SR);
  }

  private rawRange(start: number, end: number): Float32Array {
    const out = new Float32Array(Math.max(0, end - start));
    let pos = 0;
    let written = 0;
    for (const c of this.chunks) {
      const cEnd = pos + c.length;
      if (cEnd > start && pos < end) {
        const a = Math.max(start, pos) - pos;
        const b = Math.min(end, cEnd) - pos;
        out.set(c.subarray(a, b), written);
        written += b - a;
      }
      pos = cEnd;
      if (pos >= end) break;
    }
    return out.subarray(0, written);
  }

  /** Stop capture and return the full recording at 16 kHz. */
  async stop(): Promise<Float32Array> {
    this.closeSegment();
    const all = concatFloat32(this.chunks);
    await this.release();
    return downsample(all, this.sampleRate, TARGET_SR);
  }

  async cancel(): Promise<void> {
    this.chunks = [];
    await this.release();
  }

  private async release() {
    try {
      this.source?.disconnect();
      this.node?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.ctx && this.ctx.state !== "closed") await this.ctx.close();
    this.ctx = null;
    this.stream = null;
  }
}

export function micErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Microphone permission was denied. Allow microphone access in your browser's site settings and try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found. Connect a microphone and try again.";
  if (name === "NotReadableError") return "The microphone is in use by another application.";
  return "Could not start the microphone: " + ((e as Error)?.message || "unknown error");
}
