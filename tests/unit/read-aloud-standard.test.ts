import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const path = join(directory, item.name);
    return item.isDirectory() ? sources(path) : /\.[jt]sx?$/u.test(path) ? [path] : [];
  });
}
describe("future synthesized read-aloud standard", () => {
  it("keeps product callers on the shared MiniMax audio client", () => {
    const violations = [...sources("app"), ...sources("src")].filter((path) => !path.includes(join("providers", "tts"))).filter((path) => {
      const code = readFileSync(path, "utf8");
      return /speechSynthesis|createBrowserTextToSpeech|useBrowserSpeech|preferredSpanishVoice|readSpanishVoicePreference/u.test(code);
    });
    expect(violations).toEqual([]);
  });
});
