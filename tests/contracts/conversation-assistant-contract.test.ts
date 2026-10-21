import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  conversationAssistantDataSchema,
  conversationAssistantRequestSchema,
  conversationAssistantResponseSchema,
} from "@/src/modules/conversation/schemas/conversation-assistant";

const read = (file: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "contracts/schemas/v1", file), "utf8"));
const readOpenApi = () => JSON.parse(fs.readFileSync(path.join(process.cwd(), "contracts/openapi/v1/openapi.json"), "utf8"));

describe("conversation assistant public contract", () => {
  it("keeps strict request/response Zod and JSON Schema boundaries compatible", () => {
    const ajv = new Ajv2020({ strict: true });
    const request = ajv.compile(read("conversation-assistant-request.schema.json"));
    const response = ajv.compile(read("conversation-assistant-response.schema.json"));

    const base = { intent: "reply", characterVersion: 3, attemptId: "attempt-1", question: "怎么礼貌地拒绝？" };
    const validRequests = [
      base,
      { ...base, targetText: "  " },
      { intent: "grammar", characterVersion: 3, attemptId: "attempt-2", targetText: "Yo soy cansado." },
      { intent: "structure", characterVersion: 3, attemptId: "attempt-3" },
      { intent: "structure", characterVersion: 3, attemptId: "attempt-3", targetText: "a".repeat(2_000) },
      { intent: "question", characterVersion: 1, attemptId: "attempt-4", question: "querer 和 amar 有什么区别？" },
      { ...base, attemptId: " a ".repeat(60).slice(0, 128) },
    ];
    for (const value of validRequests) {
      expect(request(value), JSON.stringify(value)).toBe(true);
      expect(conversationAssistantRequestSchema.safeParse(value).success, JSON.stringify(value)).toBe(true);
    }

    const invalidRequests = [
      { ...base, intent: "chat" },
      { ...base, intent: "" },
      { ...base, characterVersion: 0 },
      { ...base, characterVersion: 1.5 },
      { ...base, attemptId: " " },
      { ...base, attemptId: "x".repeat(129) },
      { ...base, question: "x".repeat(801) },
      { ...base, targetText: "x".repeat(2_001) },
      { ...base, userId: "another-user" },
      { ...base, autoSend: true },
      { intent: "question", characterVersion: 3, attemptId: "attempt-5" },
      { intent: "question", characterVersion: 3, attemptId: "attempt-5", question: "   " },
      { intent: "grammar", characterVersion: 3, attemptId: "attempt-6" },
      { intent: "grammar", characterVersion: 3, attemptId: "attempt-6", targetText: "   " },
    ];
    for (const value of invalidRequests) {
      expect(request(value), JSON.stringify(value)).toBe(false);
      expect(conversationAssistantRequestSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }

    const data = {
      attemptId: "attempt-1",
      intent: "reply",
      answer: "可以委婉拒绝，同时保持友好。",
      suggestions: [{ spanish: "Me encantaría, pero el sábado ya tengo planes.", chinese: "我很想去，但周六已经有安排了。" }],
      corrections: [{ original: "Yo soy cansado.", corrected: "Estoy cansado.", explanation: "ser 表示身份，estar 表示状态。" }],
      structure: [{ fragment: "Lucía", role: "主语", explanation: "动作的执行者。" }],
      correctedSentence: null,
    };
    const output = { apiVersion: "v1", data };
    const validResponses = [
      output,
      { apiVersion: "v1", data: { ...data, correctedSentence: "Estoy cansado." } },
      { apiVersion: "v1", data: { ...data, correctedSentence: "" } },
      { apiVersion: "v1", data: { ...data, suggestions: [], corrections: [], structure: [] } },
    ];
    for (const value of validResponses) {
      expect(response(value), JSON.stringify(value)).toBe(true);
      expect(conversationAssistantResponseSchema.safeParse(value).success, JSON.stringify(value)).toBe(true);
    }

    const invalidResponses = [
      { ...output, apiVersion: "v2" },
      { ...output, data: { ...data, sourceText: "private draft" } },
      { ...output, data: { ...data, answer: "" } },
      { ...output, data: { ...data, answer: "   " } },
      { ...output, data: { ...data, answer: "x".repeat(4_001) } },
      { ...output, data: { ...data, intent: "chat" } },
      { ...output, data: { ...data, correctedSentence: 5 } },
      { ...output, data: { ...data, correctedSentence: "x".repeat(2_001) } },
      { ...output, data: { ...data, suggestions: Array.from({ length: 4 }, () => ({ spanish: "Hola", chinese: "你好" })) } },
      { ...output, data: { ...data, corrections: Array.from({ length: 9 }, () => ({ original: "a", corrected: "b", explanation: "c" })) } },
      { ...output, data: { ...data, structure: Array.from({ length: 13 }, () => ({ fragment: "a", role: "主语", explanation: "b" })) } },
      { ...output, data: { ...data, suggestions: [{ spanish: "Hola" }] } },
      { ...output, data: { ...data, structure: [{ fragment: "Lucía", role: "", explanation: "主语。" }] } },
    ];
    for (const value of invalidResponses) {
      expect(response(value), JSON.stringify(value)).toBe(false);
      expect(conversationAssistantResponseSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });

  it("fills optional provider blocks with empty defaults, but the wire schema always lists them", () => {
    const minimal = conversationAssistantDataSchema.parse({
      attemptId: "attempt-1",
      intent: "question",
      answer: "这是一句解释。",
    });
    expect(minimal).toEqual({
      attemptId: "attempt-1",
      intent: "question",
      answer: "这是一句解释。",
      suggestions: [],
      corrections: [],
      structure: [],
      correctedSentence: null,
    });
    // The server always serializes the defaulted blocks, so the public response
    // schema requires them even though provider output may omit them.
    const request = JSON.parse(fs.readFileSync(path.join(process.cwd(), "contracts/schemas/v1/conversation-assistant-response.schema.json"), "utf8"));
    expect(request.properties.data.required).toContain("suggestions");
    expect(request.properties.data.required).toContain("correctedSentence");
  });

  it("documents the private, no-store assistant route next to expression assistance", () => {
    const api = readOpenApi() as {
      paths: Record<string, { post?: { description?: string; requestBody?: { content: Record<string, { schema: { $ref: string } }> }; responses: Record<string, { content?: Record<string, { schema: { $ref: string } }> }> } }>;
    };
    const post = api.paths["/conversations/{characterId}/assistant"]?.post;
    expect(post).toBeDefined();
    expect(post?.requestBody?.content["application/json"]?.schema.$ref).toContain("conversation-assistant-request");
    expect(post?.responses["200"]?.content?.["application/json"]?.schema.$ref).toContain("conversation-assistant-response");
    expect(Object.keys(api.paths)).toContain("/conversations/{characterId}/expression-assist");
    expect(post?.responses["400"]).toBeDefined();
    expect(post?.responses["401"]).toBeDefined();
    expect(post?.responses["403"]).toBeDefined();
    expect(post?.responses["404"]).toBeDefined();
    expect(post?.responses["429"]).toBeDefined();
    expect(post?.responses["499"]).toBeDefined();
    expect(post?.responses["503"]).toBeDefined();
    expect(post?.responses["504"]).toBeDefined();
    const description = (post?.description ?? "").toLowerCase();
    expect(description).toContain("private");
    expect(description).toContain("no-store");
    expect(description).toContain("no message");
    expect(description).toContain("learning evidence");
    expect(description).toContain("never logged or stored");
  });
});
