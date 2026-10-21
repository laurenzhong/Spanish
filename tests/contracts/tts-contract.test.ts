import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

describe("unified read-aloud request contract", () => {
  it("accepts only bounded Spanish text, without client voice or provider overrides", () => {
    const validate = new Ajv2020({ strict: true }).compile(JSON.parse(readFileSync("contracts/schemas/v1/tts-request.schema.json", "utf8")));
    expect(validate({ text: "Buenos días.", languageTag: "es-ES" })).toBe(true);
    expect(validate({ text: "Hola" })).toBe(true);
    for (const input of [{ text: " " }, { text: "x".repeat(1001) }, { text: "Hola", voiceId: "other" }, { text: "Hola", languageTag: "en-US" }]) {
      expect(validate(input)).toBe(false);
    }
  });
});
