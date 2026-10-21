import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseTatoebaAudio } from "@/src/modules/lexicon-corpus/domain/tatoeba-audio";
import { parseTatoebaExampleAsset } from "@/src/modules/lexicon-corpus/application/tatoeba-examples";

const audio = { id: 505729, author: "arh", license: "CC BY-NC-ND 3.0", attributionUrl: "https://tatoeba.org/user/profile/arh" };
describe("Tatoeba audio metadata", () => {
  it("preserves the recording's distinct licence and uses the actual audio ID", () => {
    expect(parseTatoebaAudio(audio)).toEqual({ ...audio, url: "https://api.tatoeba.org/v1/audios/505729/file" });
  });
  it.each(["", "unknown", "All rights reserved", "PROBLEM"])("rejects the non-reusable licence %s", (license) => {
    expect(parseTatoebaAudio({ ...audio, license })).toBeNull();
  });
  it.each([{ id: -1 }, { id: 1.5 }, { author: "" }, { attributionUrl: "" }, { attributionUrl: "javascript:alert(1)" }])("rejects incomplete or unsafe credit %j", (override) => {
    expect(parseTatoebaAudio({ ...audio, ...override })).toBeNull();
  });
  it("joins the metadata by sentence ID and leaves other examples text-only", () => {
    const example = { text: "¿Tienen casa?", translation: "有房子吗？", sentenceId: 5087454 };
    const parsed = parseTatoebaExampleAsset({ examples: { casa: [example, { ...example, sentenceId: 99 }] } }, { 5087454: audio });
    expect(parsed.examples.casa?.[0]?.audio?.id).toBe(505729);
    expect(parsed.examples.casa?.[1]?.audio).toBeNull();
  });
  it("does not promote the text licence to the audio licence", () => {
    const parsed = parseTatoebaExampleAsset({ examples: { casa: [{ text: "Casa.", translation: "家。", sentenceLicense: "CC BY 2.0 FR", audio: { ...audio, license: "" } }] } });
    expect(parsed.examples.casa?.[0]?.audio).toBeNull();
  });
  it("observes newly built and removed metadata without a process restart", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), "tatoeba-audio-test-"));
    const examplePath = path.join(folder, "examples.json");
    const audioPath = path.join(folder, "audio.json");
    writeFileSync(examplePath, JSON.stringify({ examples: { casa: [{ text: "Casa.", translation: "家。", sentenceId: 7 }] } }));
    vi.stubEnv("TATOEBA_EXAMPLES_ASSET", examplePath);
    vi.stubEnv("TATOEBA_AUDIO_ASSET", audioPath);
    vi.resetModules();
    try {
      const { loadTatoebaExampleAsset } = await import("@/src/modules/lexicon-corpus/application/tatoeba-examples");
      expect(loadTatoebaExampleAsset().examples.casa?.[0]?.audio).toBeNull();
      writeFileSync(audioPath, JSON.stringify({ audios: { 7: audio } }));
      expect(loadTatoebaExampleAsset().examples.casa?.[0]?.audio?.id).toBe(505729);
      rmSync(audioPath);
      expect(loadTatoebaExampleAsset().examples.casa?.[0]?.audio).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      const resolved = path.resolve(folder);
      if (!resolved.startsWith(`${path.resolve(tmpdir())}${path.sep}`)) throw new Error("Unsafe test cleanup path");
      rmSync(resolved, { recursive: true });
    }
  });
});
