import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { createMiniMaxTextToSpeech, MiniMaxTtsError, type ReadAloudProvider, type SynthesizedSpeech } from "../minimax-tts";
import { READ_ALOUD_POLICY } from "../policy";

type Entry = { expiresAt: number; promise: Promise<SynthesizedSpeech>; bytes: number; timer?: ReturnType<typeof setTimeout> };

/** Private, bounded process memory only. No text or audio is written to disk or logs. */
export class ReadAloudService {
  private readonly secret = randomBytes(32);
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  constructor(private readonly provider: ReadAloudProvider, private readonly now = Date.now) {}

  async execute(userId: string, text: string, signal?: AbortSignal): Promise<SynthesizedSpeech> {
    if (signal?.aborted) throw new MiniMaxTtsError("cancelled", "Read-aloud cancelled.");
    const normalized = text.trim();
    if (!userId || !normalized || normalized.length > READ_ALOUD_POLICY.maxChunkCharacters) {
      throw new Error("Invalid read-aloud application input.");
    }
    for (const [key, entry] of this.entries) if (entry.expiresAt <= this.now()) this.remove(key);
    const key = createHmac("sha256", this.secret).update(JSON.stringify([userId, normalized, READ_ALOUD_POLICY])).digest("hex");
    let entry = this.entries.get(key);
    if (!entry) {
      // Pending requests are never evicted: no retry can create a duplicate paid request.
      while (this.entries.size >= 128 || this.bytes >= 32 * 1024 * 1024) {
        const candidate = [...this.entries].find(([, value]) => Number.isFinite(value.expiresAt));
        if (!candidate) throw new MiniMaxTtsError("rate-limited", "Read-aloud queue is full.");
        this.remove(candidate[0]);
      }
      entry = { expiresAt: Infinity, bytes: 0, promise: Promise.resolve(null as never) };
      const current = entry;
      this.entries.set(key, current);
      // A disconnect cancels only its waiter. The bounded provider request completes so
      // another click can reuse the result instead of charging for the same generation.
      current.promise = Promise.resolve().then(() => this.provider.synthesizeDetailed(normalized)).then((result) => {
        if (result.audio.byteLength > 32 * 1024 * 1024) {
          throw new MiniMaxTtsError("invalid-response", "Read-aloud audio exceeds the memory limit.");
        }
        current.bytes = result.audio.byteLength;
        this.bytes += current.bytes;
        current.expiresAt = this.now() + 10 * 60_000;
        this.expire(key, current, 10 * 60_000);
        while (this.bytes > 32 * 1024 * 1024) {
          const candidate = [...this.entries].find(([entryKey, value]) => entryKey !== key && Number.isFinite(value.expiresAt));
          if (!candidate) break;
          this.remove(candidate[0]);
        }
        return result;
      }).catch((error: unknown) => {
        // Keep a short rejection tombstone after uncertain provider failures; never retry automatically.
        current.expiresAt = this.now() + 30_000;
        this.expire(key, current, 30_000);
        throw error;
      });
    }
    return waitForAudio(entry.promise, signal);
  }

  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) { this.bytes -= entry.bytes; clearTimeout(entry.timer); }
    this.entries.delete(key);
  }

  private expire(key: string, entry: Entry, delay: number) {
    entry.timer = setTimeout(() => { if (this.entries.get(key) === entry) this.remove(key); }, delay);
    entry.timer.unref?.();
  }
}

function waitForAudio(promise: Promise<SynthesizedSpeech>, signal?: AbortSignal): Promise<SynthesizedSpeech> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(new MiniMaxTtsError("cancelled", "Read-aloud cancelled.")); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then((value) => { signal.removeEventListener("abort", abort); resolve(value); }, (error: unknown) => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

let service: ReadAloudService | undefined;
export function synthesizeReadAloud(userId: string, text: string, signal?: AbortSignal) {
  service ??= new ReadAloudService(createMiniMaxTextToSpeech());
  return service.execute(userId, text, signal);
}
