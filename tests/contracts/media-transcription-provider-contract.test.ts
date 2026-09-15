import { describe, expect, it } from "vitest";

import { FakeMediaTranscriptionProvider } from "@/src/modules/providers/media-transcription";

describe("media transcription provider contract", () => {
  it("accepts the shared validated STT DTO and records each input", async () => {
    const provider = new FakeMediaTranscriptionProvider();
    const result = await provider.transcribe({ audioBytes: new Uint8Array([1]), mimeType: "audio/mpeg", fileName: "part.mp3", languageTag: "es" });
    expect(result).toMatchObject({ provider: "fake", retentionPolicy: "ephemeral", text: expect.any(String) });
    expect(provider.inputs[0]).toMatchObject({ mimeType: "audio/mpeg", fileName: "part.mp3", languageTag: "es" });
  });
});

