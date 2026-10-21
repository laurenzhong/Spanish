import {
  SpeechCapabilityError,
  type RecordedAudioMetadata,
} from "./speech-capability";
import { AudioLevelMeter, type AudioLevelListener } from "./audio-level-meter";

type MediaDevicesLike = Readonly<{
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
}>;

type MediaRecorderLike = Pick<MediaRecorder, "start" | "stop" | "state"> & {
  ondataavailable: ((event: BlobEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onstop: ((event: Event) => void) | null;
};

type MediaRecorderFactory = (
  stream: MediaStream,
  options?: MediaRecorderOptions,
) => MediaRecorderLike;

type RecorderLifecycle = Readonly<{
  page?: EventTarget;
  visibility?: EventTarget & Readonly<{ visibilityState: DocumentVisibilityState }>;
  onInterrupted?: () => void;
}>;

export type BrowserRecordedAudio = Readonly<{
  blob: Blob;
  metadata: RecordedAudioMetadata;
}>;

const preferredMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;

export class BrowserAudioRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorderLike | null = null;
  private chunks: Blob[] = [];
  private lifecycleCleanup: Array<() => void> = [];
  private levelUnsubscribes: Array<() => void> = [];

  constructor(
    private readonly mediaDevices: MediaDevicesLike | null,
    private readonly recorderFactory: MediaRecorderFactory | null,
    private readonly isMimeTypeSupported: (mimeType: string) => boolean = (
      mimeType,
    ) =>
      typeof MediaRecorder !== "undefined" &&
      typeof MediaRecorder.isTypeSupported === "function" &&
      MediaRecorder.isTypeSupported(mimeType),
    private readonly lifecycle: RecorderLifecycle = {},
    private readonly levelMeter: AudioLevelMeter = new AudioLevelMeter(),
  ) {}

  get isSupported(): boolean {
    return this.mediaDevices !== null && this.recorderFactory !== null;
  }

  /**
   * True while a recording is open and the browser can actually measure the
   * input. When it is false the UI must keep its decorative fallback instead of
   * pretending to show real levels.
   */
  get isLevelMeterSupported(): boolean {
    return this.stream !== null && this.levelMeter.isSupported;
  }

  /**
   * Reports a normalized 0..1 input level while recording. The returned
   * unsubscribe is safe to call at any time; every subscription is also closed
   * by the recorder itself on stop, cancel or interruption.
   */
  subscribeLevel(listener: AudioLevelListener): () => void {
    const stream = this.stream;
    if (!stream) return () => undefined;
    let closed = false;
    const unsubscribe = this.levelMeter.open(stream, (level) => {
      if (!closed) listener(level);
    });
    const release = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      this.levelUnsubscribes = this.levelUnsubscribes.filter((item) => item !== release);
    };
    this.levelUnsubscribes.push(release);
    return release;
  }

  async start(): Promise<void> {
    if (this.recorder?.state === "recording") {
      throw new SpeechCapabilityError(
        "recording-already-active",
        "A recording is already active.",
      );
    }
    if (!this.isSupported) {
      throw new SpeechCapabilityError(
        "microphone-not-supported",
        "This browser cannot record audio.",
      );
    }

    const mimeType = preferredMimeTypes.find(this.isMimeTypeSupported);
    if (!mimeType) {
      throw new SpeechCapabilityError(
        "microphone-format-unsupported",
        "No supported recording format is available.",
      );
    }

    let stream: MediaStream;
    try {
      stream = await this.mediaDevices!.getUserMedia({ audio: true });
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        throw new SpeechCapabilityError(
          "microphone-permission-denied",
          "Microphone permission was denied.",
        );
      }
      if (
        error instanceof DOMException &&
        (error.name === "NotFoundError" || error.name === "OverconstrainedError")
      ) {
        throw new SpeechCapabilityError(
          "microphone-not-supported",
          "No compatible microphone is available.",
        );
      }
      throw new SpeechCapabilityError(
        "recording-failed",
        "The microphone could not be opened.",
      );
    }

    try {
      const recorder = this.recorderFactory!(stream, { mimeType });
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.onerror = null;
      recorder.onstop = null;
      recorder.start();
      this.stream = stream;
      this.recorder = recorder;
      this.attachLifecycle(stream);
    } catch {
      stopTracks(stream);
      throw new SpeechCapabilityError(
        "recording-failed",
        "The microphone recorder could not start.",
      );
    }
  }

  async stop(): Promise<BrowserRecordedAudio> {
    const recorder = this.recorder;
    const stream = this.stream;
    if (!recorder || !stream || recorder.state !== "recording") {
      throw new SpeechCapabilityError(
        "recording-not-active",
        "There is no active recording.",
      );
    }

    return new Promise<BrowserRecordedAudio>((resolve, reject) => {
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType() });
        this.reset(stream);
        resolve({
          blob,
          metadata: { mimeType: blob.type, sizeBytes: blob.size },
        });
      };
      recorder.onerror = () => {
        this.reset(stream);
        reject(
          new SpeechCapabilityError(
            "recording-failed",
            "The microphone recorder failed.",
          ),
        );
      };
      try {
        recorder.stop();
      } catch {
        this.reset(stream);
        reject(
          new SpeechCapabilityError(
            "recording-failed",
            "The microphone recorder could not stop.",
          ),
        );
      }
    });
  }

  async cancel(): Promise<void> {
    const recorder = this.recorder;
    const stream = this.stream;
    if (!recorder || !stream || recorder.state !== "recording") return;

    await new Promise<void>((resolve) => {
      recorder.onstop = () => {
        this.reset(stream);
        resolve();
      };
      recorder.onerror = () => {
        this.reset(stream);
        resolve();
      };
      try {
        recorder.stop();
      } catch {
        this.reset(stream);
        resolve();
      }
    });
  }

  private mimeType(): string {
    return preferredMimeTypes.find(this.isMimeTypeSupported) ?? "audio/webm";
  }

  private reset(stream: MediaStream): void {
    for (const release of this.levelUnsubscribes.splice(0)) release();
    this.detachLifecycle();
    stopTracks(stream);
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }

  private attachLifecycle(stream: MediaStream): void {
    this.detachLifecycle();
    const interrupt = () => {
      if (this.recorder?.state !== "recording") return;
      this.lifecycle.onInterrupted?.();
      void this.cancel();
    };
    const handleVisibility = () => {
      if (this.lifecycle.visibility?.visibilityState === "hidden") interrupt();
    };
    if (this.lifecycle.page) {
      this.lifecycle.page.addEventListener("pagehide", interrupt);
      this.lifecycleCleanup.push(() => this.lifecycle.page?.removeEventListener("pagehide", interrupt));
    }
    if (this.lifecycle.visibility) {
      this.lifecycle.visibility.addEventListener("visibilitychange", handleVisibility);
      this.lifecycleCleanup.push(() => this.lifecycle.visibility?.removeEventListener("visibilitychange", handleVisibility));
    }
    for (const track of stream.getTracks()) {
      if (typeof track.addEventListener !== "function") continue;
      track.addEventListener("ended", interrupt);
      this.lifecycleCleanup.push(() => track.removeEventListener("ended", interrupt));
    }
  }

  private detachLifecycle(): void {
    for (const cleanup of this.lifecycleCleanup.splice(0)) cleanup();
  }
}

export function createBrowserAudioRecorder(onInterrupted?: () => void): BrowserAudioRecorder {
  if (typeof navigator === "undefined" || typeof MediaRecorder === "undefined") {
    return new BrowserAudioRecorder(null, null);
  }

  return new BrowserAudioRecorder(
    navigator.mediaDevices ?? null,
    (stream, options) => new MediaRecorder(stream, options),
    undefined,
    { page: window, visibility: document, onInterrupted },
  );
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
