import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ onAuthStateChange: vi.fn() }));
vi.mock("@/src/shared/auth/browser", () => ({ createSupabaseBrowserClient: () => ({ auth }) }));

import { ReadAloudReplayCache, subscribeReadAloudSessionChanges } from "@/src/modules/providers/tts/read-aloud-replay-cache";

const caches: ReadAloudReplayCache[] = [];
function setup() {
  const invalidate = vi.fn();
  const unsubscribe = vi.fn();
  const subscribe = vi.fn(() => unsubscribe);
  const cache = new ReadAloudReplayCache(invalidate, subscribe);
  caches.push(cache);
  return { cache, invalidate, unsubscribe, subscribe };
}
afterEach(() => { caches.splice(0).forEach((cache) => cache.clear()); vi.useRealTimers(); vi.clearAllMocks(); });

describe("private read-aloud replay cache", () => {
  it("evicts least recently used entries at eight without extending their expiry on lookup", () => {
    vi.useFakeTimers();
    const { cache } = setup(); const release = cache.begin();
    for (let index = 0; index < 8; index++) cache.set(String(index), new ArrayBuffer(4));
    expect(cache.get("0")).toBeDefined();
    cache.set("8", new ArrayBuffer(4));
    expect(cache.get("1")).toBeUndefined();
    expect(cache.get("0")).toBeDefined();
    release(); vi.advanceTimersByTime(60_001);
    expect(cache.get("0")).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds audio memory to 4 MiB and rejects oversized entries", () => {
    const { cache } = setup(); const release = cache.begin();
    cache.set("first", new ArrayBuffer(3 * 1024 * 1024));
    cache.set("second", new ArrayBuffer(2 * 1024 * 1024));
    expect(cache.get("first")).toBeUndefined();
    expect(cache.get("second")).toBeDefined();
    cache.set("large", new ArrayBuffer(4 * 1024 * 1024 + 1));
    expect(cache.get("large")).toBeUndefined();
    release();
  });

  it("releases session and lifecycle listeners at idle expiry or an empty attempt", () => {
    vi.useFakeTimers();
    const { cache, unsubscribe, invalidate } = setup();
    const release = cache.begin();
    cache.set("private", new ArrayBuffer(4)); release();
    expect(unsubscribe).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_001);
    expect(unsubscribe).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event("account-signed-out"));
    expect(invalidate).not.toHaveBeenCalled();
    cache.begin()();
    expect(unsubscribe).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not detach listeners when an older attempt releases after its successor starts", () => {
    const { cache, unsubscribe } = setup();
    const first = cache.begin(); const second = cache.begin();
    first(); first();
    expect(unsubscribe).not.toHaveBeenCalled();
    second(); expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("invalidates on subsequent auth events including cross-tab logout and cleans its subscription", () => {
    const unsubscribe = vi.fn();
    auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } });
    const invalidate = vi.fn(); const detach = subscribeReadAloudSessionChanges(invalidate);
    const callback = auth.onAuthStateChange.mock.calls[0]![0] as (event: string) => void;
    callback("INITIAL_SESSION"); expect(invalidate).not.toHaveBeenCalled();
    callback("SIGNED_OUT"); callback("SIGNED_IN"); callback("TOKEN_REFRESHED");
    expect(invalidate).toHaveBeenCalledTimes(3);
    detach(); expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
