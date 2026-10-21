import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { expressionAssistRequestSchema, expressionAssistResponseSchema } from "@/src/modules/conversation/schemas/expression-assist";

const read = (file: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "contracts/schemas/v1", file), "utf8"));
describe("expression assistance public contract", () => {
  it("keeps strict request/response Zod and JSON Schema boundaries compatible", () => {
    const ajv = new Ajv2020({ strict: true });
    const request = ajv.compile(read("expression-assist-request.schema.json"));
    const response = ajv.compile(read("expression-assist-response.schema.json"));
    const input = { text: "今天有点累，¿quedamos 改天？", characterVersion: 2, attemptId: "attempt-1" };
    const output = { apiVersion: "v1", data: { text: "¿Quedamos otro día?", attemptId: "attempt-1" } };
    for (const value of [input, { ...input, text: "a".repeat(2000) }]) {
      expect(request(value)).toBe(true);
      expect(expressionAssistRequestSchema.safeParse(value).success).toBe(true);
    }
    expect(response(output)).toBe(true);
    expect(expressionAssistResponseSchema.safeParse(output).success).toBe(true);
    for (const value of [{ ...input, text: " " }, { ...input, text: "a".repeat(2001) }, { ...input, characterVersion: 0 }, { ...input, userId: "another-user" }, { ...input, context: [] }]) {
      expect(request(value)).toBe(false);
      expect(expressionAssistRequestSchema.safeParse(value).success).toBe(false);
    }
    for (const value of [{ ...output, data: { ...output.data, sourceText: input.text } }, { ...output, apiVersion: "v2" }, { ...output, data: { ...output.data, text: "" } }]) {
      expect(response(value)).toBe(false);
      expect(expressionAssistResponseSchema.safeParse(value).success).toBe(false);
    }
  });

  it("documents the assistance route and accepts only the known stream assistance declaration", () => {
    const api = JSON.parse(fs.readFileSync(path.join(process.cwd(), "contracts/openapi/v1/openapi.json"), "utf8"));
    expect(api.paths["/conversations/{characterId}/expression-assist"].post.requestBody.content["application/json"].schema.$ref).toContain("expression-assist-request");
    const validate = new Ajv2020({ strict: true }).compile(read("conversation-stream-request.schema.json"));
    const body = { characterVersion: 2, text: "Hola", clientMessageId: "client-1", generationId: "generation-1", assistance: "translation" };
    expect(validate(body)).toBe(true);
    expect(validate({ ...body, assistance: "independent" })).toBe(false);
  });
});
