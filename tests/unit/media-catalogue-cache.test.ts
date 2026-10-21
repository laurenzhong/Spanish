import { describe, expect, it, vi } from "vitest";

import { createCatalogueCache } from "@/src/modules/media/repositories/media-catalogue-cache";

function clock(start = 1_000) {
  let current = start;
  return { now: () => current, advance: (ms: number) => { current += ms; } };
}

describe("createCatalogueCache", () => {
  it("serves a repeated key from the cache instead of running the query again", async () => {
    const time = clock();
    const cache = createCatalogueCache({ ttlMs: 600_000, now: time.now });
    const loader = vi.fn().mockResolvedValue({ items: 1 });

    await expect(cache.load("list:a", loader)).resolves.toEqual({ items: 1 });
    await expect(cache.load("list:a", loader)).resolves.toEqual({ items: 1 });

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("keeps different keys apart", async () => {
    const cache = createCatalogueCache({ ttlMs: 600_000 });
    const loader = vi.fn((value: number) => Promise.resolve(value));

    await cache.load("list:all", () => loader(1));
    await cache.load("list:video", () => loader(2));

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent loads of the same key into one query", async () => {
    const cache = createCatalogueCache({ ttlMs: 600_000 });
    let release: (value: string) => void = () => undefined;
    const loader = vi.fn(() => new Promise<string>((resolve) => { release = resolve; }));

    const first = cache.load("list:a", loader);
    const second = cache.load("list:a", loader);
    release("rows");

    await expect(Promise.all([first, second])).resolves.toEqual(["rows", "rows"]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("re-reads once the entry expires", async () => {
    const time = clock();
    const cache = createCatalogueCache({ ttlMs: 10_000, now: time.now });
    const loader = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");

    await expect(cache.load("list:a", loader)).resolves.toBe("first");
    time.advance(10_001);
    await expect(cache.load("list:a", loader)).resolves.toBe("second");

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("propagates a failure instead of inventing an empty catalogue", async () => {
    const cache = createCatalogueCache({ ttlMs: 10_000 });
    const loader = vi.fn().mockRejectedValue(new Error("database unavailable"));

    await expect(cache.load("list:a", loader)).rejects.toThrow("database unavailable");
  });

  it("keeps the last good catalogue when a refresh fails", async () => {
    const time = clock();
    const cache = createCatalogueCache({ ttlMs: 10_000, now: time.now });
    const loader = vi.fn().mockResolvedValueOnce("good").mockRejectedValueOnce(new Error("refresh failed"));

    await expect(cache.load("list:a", loader)).resolves.toBe("good");
    time.advance(10_001);

    // Expired, refresh failed: the out-of-date catalogue is still better than an
    // error, and the next call tries again.
    await expect(cache.load("list:a", loader)).resolves.toBe("good");
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
