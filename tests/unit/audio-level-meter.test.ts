import { describe, expect, it, vi } from "vitest";

import { AudioLevelMeter, type AudioContextLike } from "@/src/modules/providers/speech";

type FakeAnalyser = Readonly<{
  fftSize: number;
  smoothingTimeConstant: number;
  getByteTimeDomainData(target: Uint8Array): void;
  samples: () => Uint8Array;
  connect: (node: unknown) => void;
}>;

function fakeAnalyser(wave: (index: number, length: number) => number): FakeAnalyser {
  const analyser = {
    fftSize: 0,
    smoothingTimeConstant: 0,
    connect: vi.fn<(node: unknown) => void>(),
    samples: () => new Uint8Array(analyser.fftSize),
    getByteTimeDomainData(target: Uint8Array) {
      for (let index = 0; index < target.length; index += 1) target[index] = wave(index, target.length);
    },
  };
  return analyser;
}

function fakeContext(analyser: FakeAnalyser): Readonly<{ context: AudioContextLike; close: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; sinkGain: { value: number }; sinkConnect: ReturnType<typeof vi.fn>; sinkDisconnect: ReturnType<typeof vi.fn> }> {
  const close = vi.fn().mockResolvedValue(undefined);
  const disconnect = vi.fn();
  const connect = vi.fn();
  const sinkConnect = vi.fn();
  const sinkDisconnect = vi.fn();
  const sinkGain = { value: 1 };
  return {
    close,
    connect,
    disconnect,
    sinkGain,
    sinkConnect,
    sinkDisconnect,
    context: {
      close,
      destination: { id: "destination" },
      createAnalyser: () => analyser,
      // A silent sink: Chrome only renders graphs that reach the destination, so
      // the meter has to be wired through a zero-gain node.
      createGain: () => ({ gain: sinkGain, connect: sinkConnect, disconnect: sinkDisconnect }),
      createMediaStreamSource: () => ({ connect, disconnect }),
    },
  };
}

/** A queue-backed frame scheduler so the loop can be stepped deterministically. */
function manualFrames() {
  let queued: (() => void) | null = null;
  return {
    requestFrame: (callback: () => void) => {
      queued = callback;
      return 1;
    },
    cancelFrame: vi.fn(() => {
      queued = null;
    }),
    step: () => {
      const callback = queued;
      queued = null;
      callback?.();
    },
    pending: () => queued !== null,
  };
}

const stream = { id: "stream" } as unknown as MediaStream;

describe("AudioLevelMeter", () => {
  it("reports a normalized level between 0 and 1 from the live waveform", () => {
    const analyser = fakeAnalyser(() => 200);
    const { context } = fakeContext(analyser);
    const frames = manualFrames();
    const levels: number[] = [];
    const meter = new AudioLevelMeter({
      audioContextFactory: () => context,
      frameIntervalMs: 0,
      now: () => 1,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    const unsubscribe = meter.open(stream, (level) => levels.push(level));
    frames.step();

    expect(levels).toHaveLength(1);
    expect(levels[0]).toBeGreaterThan(0);
    expect(levels[0]).toBeLessThanOrEqual(1);
    unsubscribe();
  });

  it("clamps loud input to exactly 1 and reports silence as 0", () => {
    const frames = manualFrames();
    const levels: number[] = [];
    const analyser = fakeAnalyser((index) => (index % 2 === 0 ? 0 : 255));

    const meter = new AudioLevelMeter({
      audioContextFactory: () => fakeContext(analyser).context,
      frameIntervalMs: 0,
      now: () => 1,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });
    const unsubscribe = meter.open(stream, (level) => levels.push(level));
    frames.step();
    expect(levels[0]).toBe(1);
    unsubscribe();

    const silentFrames = manualFrames();
    const silentLevels: number[] = [];
    const silentMeter = new AudioLevelMeter({
      audioContextFactory: () => fakeContext(fakeAnalyser(() => 128)).context,
      frameIntervalMs: 0,
      now: () => 1,
      requestFrame: silentFrames.requestFrame,
      cancelFrame: silentFrames.cancelFrame,
    });
    const stopSilent = silentMeter.open(stream, (level) => silentLevels.push(level));
    silentFrames.step();
    expect(silentLevels[0]).toBe(0);
    stopSilent();
  });

  it("keeps quiet speech inside the visible range instead of pinning it to the floor", () => {
    // A low-gain microphone: what a quiet laptop mic actually delivers is a
    // fraction of full scale, which a linear map renders as an almost flat bar.
    const soft = manualFrames();
    const softLevels: number[] = [];
    const softMeter = new AudioLevelMeter({
      audioContextFactory: () => fakeContext(fakeAnalyser((index) => (index % 2 === 0 ? 128 - 2 : 128 + 2))).context,
      frameIntervalMs: 0,
      now: () => 1,
      requestFrame: soft.requestFrame,
      cancelFrame: soft.cancelFrame,
    });
    const stopSoft = softMeter.open(stream, (level) => softLevels.push(level));
    soft.step();

    const quieter = manualFrames();
    const quieterLevels: number[] = [];
    const quieterMeter = new AudioLevelMeter({
      audioContextFactory: () => fakeContext(fakeAnalyser((index) => (index % 2 === 0 ? 128 - 1 : 128 + 1))).context,
      frameIntervalMs: 0,
      now: () => 1,
      requestFrame: quieter.requestFrame,
      cancelFrame: quieter.cancelFrame,
    });
    const stopQuieter = quieterMeter.open(stream, (level) => quieterLevels.push(level));
    quieter.step();

    expect(softLevels[0]).toBeGreaterThan(0.4);
    expect(quieterLevels[0]).toBeGreaterThan(0.2);
    // Monotonic: a quieter signal must not read louder than a louder one.
    expect(quieterLevels[0]!).toBeLessThan(softLevels[0]!);
    stopSoft();
    stopQuieter();
  });

  it("releases a peak gradually so the bars do not flicker", () => {
    const frames = manualFrames();
    const levels: number[] = [];
    let loud = true;
    const analyser = fakeAnalyser((index) => {
      if (!loud) return 128;
      return index % 2 === 0 ? 0 : 255;
    });
    const meter = new AudioLevelMeter({
      audioContextFactory: () => fakeContext(analyser).context,
      frameIntervalMs: 0,
      now: () => 1,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    const unsubscribe = meter.open(stream, (level) => levels.push(level));
    frames.step();
    loud = false;
    frames.step();

    expect(levels[0]).toBe(1);
    // Silence after a peak decays towards zero instead of snapping to it.
    expect(levels[1]!).toBeGreaterThan(0);
    expect(levels[1]!).toBeLessThan(1);
    unsubscribe();
  });

  it("throttles reports to the frame interval so the main thread stays calm", () => {
    const analyser = fakeAnalyser(() => 190);
    const frames = manualFrames();
    const levels: number[] = [];
    let clock = 0;
    const meter = new AudioLevelMeter({
      audioContextFactory: () => fakeContext(analyser).context,
      frameIntervalMs: 60,
      now: () => clock,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    const unsubscribe = meter.open(stream, (level) => levels.push(level));
    frames.step();
    expect(levels).toHaveLength(1);

    clock = 20;
    frames.step();
    expect(levels).toHaveLength(1);

    clock = 80;
    frames.step();
    expect(levels).toHaveLength(2);
    unsubscribe();
  });

  it("stops the loop, disconnects the graph and closes the context on unsubscribe", async () => {
    const analyser = fakeAnalyser(() => 190);
    const fake = fakeContext(analyser);
    const frames = manualFrames();
    const meter = new AudioLevelMeter({
      audioContextFactory: () => fake.context,
      frameIntervalMs: 0,
      now: () => 1,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    const unsubscribe = meter.open(stream, () => undefined);
    expect(fake.connect).toHaveBeenCalledTimes(1);
    unsubscribe();
    unsubscribe();

    expect(frames.cancelFrame).toHaveBeenCalledTimes(1);
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(frames.pending()).toBe(false);
  });

  it("wires the analyser through a silent sink so Chrome actually renders the graph", () => {
    const analyser = fakeAnalyser(() => 190);
    const fake = fakeContext(analyser);
    const frames = manualFrames();
    const meter = new AudioLevelMeter({
      audioContextFactory: () => fake.context,
      frameIntervalMs: 0,
      now: () => 1,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });

    const unsubscribe = meter.open(stream, () => undefined);

    // Gain is zero, so the microphone is never played back into the speakers.
    expect(fake.sinkGain.value).toBe(0);
    expect(fake.sinkConnect).toHaveBeenCalledWith(fake.context.destination);
    unsubscribe();
    expect(fake.sinkDisconnect).toHaveBeenCalledTimes(1);
  });

  it("degrades to a no-op without an audio context and never touches the stream", () => {
    const meter = new AudioLevelMeter({ audioContextFactory: () => null });
    const listener = vi.fn();

    const unsubscribe = meter.open(stream, listener);

    expect(listener).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });

  it("reports support only when the browser exposes an audio context", () => {
    expect(new AudioLevelMeter({ audioContextFactory: () => null }).isSupported).toBe(true);
    const scope = globalThis as { AudioContext?: unknown; webkitAudioContext?: unknown };
    const original = scope.AudioContext;
    delete scope.AudioContext;
    delete scope.webkitAudioContext;
    try {
      expect(new AudioLevelMeter().isSupported).toBe(false);
    } finally {
      if (original !== undefined) scope.AudioContext = original;
    }
  });
});
