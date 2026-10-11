import { describe, expect, it } from "vitest";

import { VerifyWordTimingsInputError, parseVerifyWordTimingsArguments } from "../../scripts/verify-podcast-word-timings";

describe("verify-podcast-word-timings arguments", () => {
  it("requires an audio path", () => {
    expect(() => parseVerifyWordTimingsArguments([])).toThrow(VerifyWordTimingsInputError);
    expect(() => parseVerifyWordTimingsArguments(["--audio"])).toThrow("--audio requires a file path.");
    expect(() => parseVerifyWordTimingsArguments(["--audio", "--live"])).toThrow("--audio requires a file path.");
  });

  it("defaults to the free local check", () => {
    expect(parseVerifyWordTimingsArguments(["--audio", "episode.mp3"])).toEqual({
      audioPath: "episode.mp3",
      live: false,
      keepParts: false,
    });
  });

  it("opts into the paid provider check explicitly", () => {
    expect(parseVerifyWordTimingsArguments(["--audio", "episode.mp3", "--live", "--keep-parts"])).toEqual({
      audioPath: "episode.mp3",
      live: true,
      keepParts: true,
    });
  });

  it("rejects repeated audio paths and unknown arguments", () => {
    expect(() => parseVerifyWordTimingsArguments(["--audio", "a.mp3", "--audio", "b.mp3"])).toThrow("--audio may only be provided once.");
    expect(() => parseVerifyWordTimingsArguments(["--audio", "a.mp3", "--dry-run"])).toThrow("Unknown argument: --dry-run");
  });
});
