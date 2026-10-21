"use client";

import { createSupabaseBrowserClient } from "@/src/shared/auth/browser";

export function subscribeReadAloudSessionChanges(invalidate: () => void): () => void {
  const client = createSupabaseBrowserClient();
  if (!client) return () => undefined;
  const { data } = client.auth.onAuthStateChange((event) => {
    // Initial delivery describes the session that just made the authenticated request.
    // Subsequent changes (including cross-tab sign-out) must discard private audio.
    if (event !== "INITIAL_SESSION") invalidate();
  });
  return () => data.subscription.unsubscribe();
}

/** Only completed playback is reusable, within this controller's lifetime.
 * No storage, public URLs, cross-controller sharing or background synthesis.
 */
export class ReadAloudReplayCache {
  private readonly entries = new Map<string, { audio: ArrayBuffer; expires: number }>();
  private bytes = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private detach: (() => void) | undefined;
  private leases = 0;

  constructor(
    private readonly invalidate: () => void,
    private readonly subscribe: (invalidate: () => void) => () => void,
  ) {}

  begin(): () => void {
    this.leases++;
    if (!this.detach) {
      const hidden = () => { if (document.visibilityState === "hidden") this.invalidate(); };
      window.addEventListener("pagehide", this.invalidate);
      window.addEventListener("account-signed-out", this.invalidate);
      document.addEventListener("visibilitychange", hidden);
      let unsubscribe = () => undefined as void;
      const detach = () => {
        window.removeEventListener("pagehide", this.invalidate);
        window.removeEventListener("account-signed-out", this.invalidate);
        document.removeEventListener("visibilitychange", hidden);
        unsubscribe();
      };
      this.detach = detach;
      unsubscribe = this.subscribe(this.invalidate);
      if (this.detach !== detach) unsubscribe(); // A synchronous session change invalidated it.
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.leases--;
      this.releaseIfEmpty();
    };
  }

  get(text: string): ArrayBuffer | undefined {
    this.prune();
    const entry = this.entries.get(text);
    if (!entry) return undefined;
    this.entries.delete(text); this.entries.set(text, entry);
    return entry.audio;
  }

  set(text: string, audio: ArrayBuffer): void {
    this.prune();
    this.remove(text);
    if (audio.byteLength > 4 * 1024 * 1024) return;
    while (this.entries.size >= 8 || this.bytes + audio.byteLength > 4 * 1024 * 1024) {
      this.remove(this.entries.keys().next().value!);
    }
    this.entries.set(text, { audio, expires: Date.now() + 60_000 });
    this.bytes += audio.byteLength;
    this.schedule();
  }

  clear(): void {
    this.entries.clear(); this.bytes = 0;
    clearTimeout(this.timer); this.timer = undefined;
    this.detach?.(); this.detach = undefined;
  }

  private remove(text: string): void {
    const entry = this.entries.get(text);
    if (entry) { this.bytes -= entry.audio.byteLength; this.entries.delete(text); }
  }

  private prune(): void {
    for (const [text, entry] of this.entries) if (entry.expires <= Date.now()) this.remove(text);
    this.schedule();
  }

  private schedule(): void {
    clearTimeout(this.timer); this.timer = undefined;
    if (this.entries.size) {
      const expires = Math.min(...[...this.entries.values()].map((entry) => entry.expires));
      this.timer = setTimeout(() => this.prune(), Math.max(1, expires - Date.now()));
    } else this.releaseIfEmpty();
  }

  private releaseIfEmpty(): void {
    if (!this.entries.size && !this.leases) this.clear();
  }
}
