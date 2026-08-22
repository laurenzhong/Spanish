import {
  SpeechSignalError,
  type DecodedSpeechSignal,
  type SpeechSignalAnalyzer,
  type SpeechSignalDecoder,
  type SpeechSignalInput,
  type SpeechSignalObservation,
  validateSpeechSignalInput,
} from "./speech-signal";

const defaultFrameMs = 20;
const defaultMinimumPauseMs = 120;
const defaultMinimumDurationMs = 100;
const defaultMinimumRms = 0.01;

export type LocalSpeechSignalAnalyzerOptions = Readonly<{
  decoder: SpeechSignalDecoder;
  clock?: () => number;
  frameMs?: number;
  minimumPauseMs?: number;
  minimumDurationMs?: number;
  minimumRms?: number;
}>;

export class LocalSpeechSignalAnalyzer implements SpeechSignalAnalyzer {
  private readonly clock: () => number;
  private readonly frameMs: number;
  private readonly minimumPauseMs: number;
  private readonly minimumDurationMs: number;
  private readonly minimumRms: number;

  constructor(private readonly options: LocalSpeechSignalAnalyzerOptions) {
    this.clock = options.clock ?? Date.now;
    this.frameMs = options.frameMs ?? defaultFrameMs;
    this.minimumPauseMs = options.minimumPauseMs ?? defaultMinimumPauseMs;
    this.minimumDurationMs = options.minimumDurationMs ?? defaultMinimumDurationMs;
    this.minimumRms = options.minimumRms ?? defaultMinimumRms;
  }

  async analyze(
    input: SpeechSignalInput,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<SpeechSignalObservation> {
    validateSpeechSignalInput(input);
    throwIfAborted(options.signal);
    const startedAt = this.clock();

    let decoded: DecodedSpeechSignal;
    try {
      decoded = await this.options.decoder(input, options);
    } catch (error) {
      if (error instanceof SpeechSignalError) throw error;
      throw new SpeechSignalError(
        "audio-decode-failed",
        "Audio could not be decoded for local signal analysis.",
        false,
      );
    }
    throwIfAborted(options.signal);
    validateDecodedSignal(decoded);

    const durationMs = (decoded.monoSamples.length / decoded.sampleRate) * 1000;
    const frames = frameRmsValues(decoded, this.frameMs);
    const peakRms = frames.reduce((peak, frame) => Math.max(peak, frame), 0);
    const latencyMs = Math.max(0, this.clock() - startedAt);

    if (
      durationMs < this.minimumDurationMs ||
      !Number.isFinite(peakRms) ||
      peakRms < this.minimumRms
    ) {
      return insufficientObservation(durationMs, latencyMs);
    }

    const voiceThreshold = Math.max(this.minimumRms, peakRms * 0.12);
    const voiced = frames.map((rms) => rms >= voiceThreshold);
    const voicedFrameCount = voiced.filter(Boolean).length;
    const firstVoicedFrame = voiced.findIndex(Boolean);
    const lastVoicedFrame = findLastIndex(voiced, Boolean);

    if (
      voicedFrameCount < 3 ||
      firstVoicedFrame < 0 ||
      lastVoicedFrame < firstVoicedFrame
    ) {
      return insufficientObservation(durationMs, latencyMs);
    }

    const span = voiced.slice(firstVoicedFrame, lastVoicedFrame + 1);
    const pauseFrameCount = span.filter((isVoiced) => !isVoiced).length;
    const pauseCount = countPauses(
      span,
      this.frameMs,
      this.minimumPauseMs,
    );

    return {
      quality: "usable",
      durationMs: roundMetric(durationMs),
      voicedRatio: roundMetric(voicedFrameCount / voiced.length),
      pauseCount,
      pauseRatio: roundMetric(pauseFrameCount / span.length),
      analyzer: "local-signal",
      algorithmVersion: "local-signal-v1",
      latencyMs,
      retentionPolicy: "ephemeral",
    };
  }
}

function frameRmsValues(
  decoded: DecodedSpeechSignal,
  frameMs: number,
): number[] {
  const frameLength = Math.max(1, Math.round((decoded.sampleRate * frameMs) / 1000));
  const frames: number[] = [];

  for (let offset = 0; offset < decoded.monoSamples.length; offset += frameLength) {
    const end = Math.min(offset + frameLength, decoded.monoSamples.length);
    let sumSquares = 0;
    for (let index = offset; index < end; index += 1) {
      const sample = decoded.monoSamples[index] ?? 0;
      sumSquares += sample * sample;
    }
    frames.push(Math.sqrt(sumSquares / Math.max(1, end - offset)));
  }

  return frames;
}

function countPauses(
  frames: boolean[],
  frameMs: number,
  minimumPauseMs: number,
): number {
  const minimumPauseFrames = Math.max(1, Math.ceil(minimumPauseMs / frameMs));
  let pauses = 0;
  let silentFrames = 0;

  for (const isVoiced of frames) {
    if (!isVoiced) {
      silentFrames += 1;
      continue;
    }
    if (silentFrames >= minimumPauseFrames) pauses += 1;
    silentFrames = 0;
  }

  if (silentFrames >= minimumPauseFrames) pauses += 1;
  return pauses;
}

function findLastIndex<T>(values: T[], predicate: (value: T) => boolean): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index]!)) return index;
  }
  return -1;
}

function insufficientObservation(
  durationMs: number,
  latencyMs: number,
): SpeechSignalObservation {
  return {
    quality: "insufficient",
    durationMs: roundMetric(durationMs),
    voicedRatio: null,
    pauseCount: null,
    pauseRatio: null,
    analyzer: "local-signal",
    algorithmVersion: "local-signal-v1",
    latencyMs,
    retentionPolicy: "ephemeral",
  };
}

function validateDecodedSignal(decoded: DecodedSpeechSignal): void {
  if (
    !Number.isFinite(decoded.sampleRate) ||
    decoded.sampleRate <= 0 ||
    !Number.isInteger(decoded.sampleRate) ||
    decoded.monoSamples.length === 0
  ) {
    throw new SpeechSignalError(
      "audio-decode-failed",
      "Decoded audio does not contain a valid mono signal.",
      false,
    );
  }

  for (const sample of decoded.monoSamples) {
    if (!Number.isFinite(sample)) {
      throw new SpeechSignalError(
        "audio-decode-failed",
        "Decoded audio contains a non-finite sample.",
        false,
      );
    }
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SpeechSignalError(
      "provider-cancelled",
      "Local signal analysis was cancelled.",
      false,
    );
  }
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}
