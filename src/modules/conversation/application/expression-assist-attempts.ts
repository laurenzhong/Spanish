import { createHmac, randomBytes } from "node:crypto";
import { TranslationError, type TranslationResult } from "@/src/modules/providers/translation/translation";
import { ExpressionAssistError } from "./expression-assist-error";

type Entry = {
  fingerprint: string;
  promise: Promise<TranslationResult>;
  controller: AbortController;
  waiters: number;
  bytes: number;
  completed: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

/** One process only. Private attempts expire quickly and never enter disk or DB. */
export class ExpressionAssistAttempts {
  private readonly secret = randomBytes(32);
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  constructor(private readonly limits = { maxEntries: 128, maxBytes: 512 * 1024, ttlMs: 30_000 }) {}

  run(
    input: Readonly<{ userId: string; characterKey: string; characterVersion: number; attemptId: string; text: string }>,
    produce: (signal: AbortSignal) => Promise<TranslationResult>,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    if (signal?.aborted) return Promise.reject(cancelled());
    const key = this.hash([input.userId, input.characterKey, input.characterVersion, input.attemptId]);
    const fingerprint = this.hash([input.text]);
    let entry = this.entries.get(key);
    if (entry && entry.fingerprint !== fingerprint) return Promise.reject(new ExpressionAssistError("CONFLICT", 409));
    if (!entry) {
      while (this.entries.size >= this.limits.maxEntries) {
        const oldest = [...this.entries].find(([, item]) => item.completed);
        if (!oldest) return Promise.reject(new ExpressionAssistError("RATE_LIMITED", 429));
        this.remove(oldest[0], oldest[1]);
      }
      entry = { fingerprint, promise: Promise.resolve(null as never), controller: new AbortController(), waiters: 0, bytes: 0, completed: false };
      const current = entry;
      this.entries.set(key, current);
      let rejectAborted!: () => void;
      let timedOut = false;
      const deadline = setTimeout(() => { timedOut = true; current.controller.abort(); }, 30_000);
      const aborted = new Promise<never>((_, reject) => { rejectAborted = () => reject(timedOut ? new TranslationError("provider-timeout", "Expression assistance timed out.", true) : cancelled()); });
      current.controller.signal.addEventListener("abort", rejectAborted, { once: true });
      const work = Promise.resolve().then(() => {
        if (current.controller.signal.aborted) throw cancelled();
        return produce(current.controller.signal);
      });
      current.promise = Promise.race([work, aborted]).then((result) => {
        if (current.controller.signal.aborted) throw cancelled();
        current.completed = true;
        current.bytes = new TextEncoder().encode(result.text).byteLength;
        this.bytes += current.bytes;
        if (current.bytes > this.limits.maxBytes) { this.remove(key, current); return result; }
        while (this.bytes > this.limits.maxBytes) {
          const oldest = [...this.entries].find(([candidate, value]) => candidate !== key && value.completed);
          if (!oldest) break;
          this.remove(oldest[0], oldest[1]);
        }
        current.timer = setTimeout(() => this.remove(key, current), this.limits.ttlMs);
        current.timer.unref?.();
        return result;
      }).catch((error: unknown) => { this.remove(key, current); throw error; }).finally(() => {
        clearTimeout(deadline);
        current.controller.signal.removeEventListener("abort", rejectAborted);
      });
    }
    const current = entry;
    current.waiters += 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return false;
        settled = true; signal?.removeEventListener("abort", abort); current.waiters -= 1;
        if (current.waiters === 0 && !current.completed) {
          this.remove(key, current); current.controller.abort();
        }
        return true;
      };
      const abort = () => { if (finish()) reject(cancelled()); };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      current.promise.then((result) => { if (finish()) resolve(result); }, (error: unknown) => { if (finish()) reject(error); });
    });
  }

  private hash(value: readonly unknown[]) { return createHmac("sha256", this.secret).update(JSON.stringify(value)).digest("hex"); }
  private remove(key: string, entry: Entry) {
    if (this.entries.get(key) !== entry) return;
    clearTimeout(entry.timer); this.bytes -= entry.bytes; this.entries.delete(key);
  }
}
function cancelled() { return new TranslationError("provider-cancelled", "Expression assistance was cancelled.", false); }

export const expressionAssistAttempts = new ExpressionAssistAttempts();
