/**
 * Live microphone level for the recording indicator.
 *
 * The recording "waveform" used to be a canned CSS loop, so a learner could not
 * tell whether the microphone was actually capturing. This meter reads the real
 * time-domain signal from the same `MediaStream` the recorder owns and reports a
 * normalized 0..1 level.
 *
 * Privacy and lifecycle:
 * - the graph never connects to the audio destination, so nothing is monitored
 *   or played back (no feedback loop, no extra copy of the audio);
 * - nothing is buffered or sent anywhere: only the current RMS is reported;
 * - the `AudioContext` is closed as soon as the last subscriber unsubscribes,
 *   and the recorder closes it on stop/cancel/interrupt.
 */

export type AudioLevelListener = (level: number) => void;

type AnalyserLike = {
  fftSize: number;
  smoothingTimeConstant: number;
  getByteTimeDomainData(target: Uint8Array): void;
  /** Optional so plain test doubles stay valid. */
  connect?(node: unknown): void;
};

type MediaStreamSourceLike = {
  connect(node: unknown): void;
  disconnect(): void;
};

type GainLike = {
  gain: { value: number };
  connect(node: unknown): void;
  disconnect(): void;
};

export type AudioContextLike = {
  createAnalyser(): AnalyserLike;
  createMediaStreamSource(stream: MediaStream): MediaStreamSourceLike;
  close(): Promise<void> | void;
  /** Chrome starts a context suspended when it cannot tie it to a gesture. */
  state?: "suspended" | "running" | "closed";
  resume?(): Promise<void> | void;
  /** Optional so simple fakes stay valid; a real context always has them. */
  createGain?(): GainLike;
  destination?: unknown;
};

export type AudioLevelMeterOptions = Readonly<{
  /** Overridable for tests; defaults to the window `AudioContext`. */
  audioContextFactory?: () => AudioContextLike | null;
  /** Minimum gap between reported levels; keeps the main thread near ~16 fps. */
  frameIntervalMs?: number;
  now?: () => number;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
}>;

const analyserSamples = 512;

function defaultAudioContextFactory(): AudioContextLike | null {
  const globalScope = globalThis as {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const Constructor = globalScope.AudioContext ?? globalScope.webkitAudioContext;
  if (typeof Constructor !== "function") return null;
  try {
    return new Constructor();
  } catch {
    return null;
  }
}

export class AudioLevelMeter {
  constructor(private readonly options: AudioLevelMeterOptions = {}) {}

  get isSupported(): boolean {
    if (this.options.audioContextFactory) return true;
    const globalScope = globalThis as { AudioContext?: unknown; webkitAudioContext?: unknown };
    return typeof globalScope.AudioContext === "function" || typeof globalScope.webkitAudioContext === "function";
  }

  /**
   * Starts reporting levels for `stream`. Returns an unsubscribe function that
   * is always safe to call, including after the stream has already ended.
   */
  open(stream: MediaStream, listener: AudioLevelListener): () => void {
    const createContext = this.options.audioContextFactory ?? defaultAudioContextFactory;
    const context = createContext();
    if (!context) return () => undefined;

    let analyser: AnalyserLike;
    let source: MediaStreamSourceLike;
    let silentSink: GainLike | null = null;
    try {
      // A suspended context renders nothing, which reads as permanent silence:
      // resume before wiring the graph so the first frames carry real samples.
      if (context.state === "suspended") void context.resume?.();
      analyser = context.createAnalyser();
      analyser.fftSize = analyserSamples;
      analyser.smoothingTimeConstant = 0.6;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      // Chrome only renders a graph that reaches the destination. Without this
      // path a real microphone stream reads as digital silence (-∞ dBFS) even
      // while the recorder downstream is capturing audio normally. The gain node
      // keeps the pull alive while staying inaudible, so nothing is played back
      // into the speakers (and no feedback loop is created).
      if (context.createGain && context.destination) {
        silentSink = context.createGain();
        silentSink.gain.value = 0;
        analyser.connect?.(silentSink);
        silentSink.connect(context.destination);
      }
    } catch {
      void closeQuietly(context);
      return () => undefined;
    }

    const samples = new Uint8Array(analyserSamples);
    const interval = this.options.frameIntervalMs ?? 60;
    const now = this.options.now ?? (() => Date.now());
    // A timer, not requestAnimationFrame: rAF is throttled or suspended when the
    // page is not rendering (background tab, occluded window, headless), which
    // froze the indicator at its first silent sample. Levels are reported at
    // ~16 fps anyway, so a timer is both sufficient and reliable.
    const requestFrame = this.options.requestFrame ?? ((callback: () => void) => setTimeout(callback, interval) as unknown as number);
    const cancelFrame = this.options.cancelFrame ?? ((handle: number) => clearTimeout(handle));

    let stopped = false;
    let frame = 0;
    let lastReportedAt = Number.NEGATIVE_INFINITY;
    let level = 0;

    const tick = () => {
      if (stopped) return;
      const timestamp = now();
      if (timestamp - lastReportedAt >= interval) {
        lastReportedAt = timestamp;
        analyser.getByteTimeDomainData(samples);
        let sumOfSquares = 0;
        for (const value of samples) {
          const deviation = (value - 128) / 128;
          sumOfSquares += deviation * deviation;
        }
        const rms = Math.sqrt(sumOfSquares / samples.length);
        // Decibels, not raw RMS: microphone gain varies by an order of magnitude
        // between machines, and a linear (or square-root) map of a quiet input
        // sits on the floor, which reads as "the waveform never moves". Mapping a
        // 60 dB window (-70 dBFS … -10 dBFS) keeps soft speech in the middle of
        // the bar range while leaving true silence at the bottom.
        const decibels = 20 * Math.log10(Math.max(rms, 1e-6));
        const target = Math.min(1, Math.max(0, (decibels + 70) / 60));
        // Fast attack, slow release: peaks stay readable instead of flickering.
        level = target > level ? target : level * 0.75 + target * 0.25;
        listener(level);
      }
      frame = requestFrame(tick);
    };
    frame = requestFrame(tick);

    return () => {
      if (stopped) return;
      stopped = true;
      cancelFrame(frame);
      try {
        source.disconnect();
      } catch {
        // A disconnected stream throws in some browsers; the context close below is what matters.
      }
      try {
        silentSink?.disconnect();
      } catch {
        // Same: closing the context releases the sink anyway.
      }
      void closeQuietly(context);
    };
  }
}

async function closeQuietly(context: AudioContextLike): Promise<void> {
  try {
    await context.close();
  } catch {
    // Closing an already-closed context is not an error worth surfacing.
  }
}
