import fs from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const schemaDirectory = path.join(root, "contracts", "schemas", "v1");
const openApiPath = path.join(root, "contracts", "openapi", "v1", "openapi.json");

function readJson<T>(fileName: string): T {
  return JSON.parse(fs.readFileSync(path.join(schemaDirectory, fileName), "utf8")) as T;
}

function validator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const fileName of fs.readdirSync(schemaDirectory).filter((name) => name.endsWith(".schema.json"))) {
    ajv.addSchema(readJson(fileName));
  }
  return ajv;
}

const ids = {
  conversationId: "10000000-0000-4000-8000-000000000001",
  messageId: "20000000-0000-4000-8000-000000000001",
  createdAt: "2026-09-27T08:00:00.000Z",
};

describe("conversation v1 contracts", () => {
  it("compiles and validates list, history, search, stream, and mutation payloads", () => {
    const ajv = validator();
    const valid = (fileName: string, payload: unknown) => {
      const schema = readJson<{ $id: string }>(fileName);
      const validate = ajv.getSchema(schema.$id);
      expect(validate, fileName).toBeDefined();
      expect(validate?.(payload), JSON.stringify(validate?.errors)).toBe(true);
    };

    valid("conversation-list-response.schema.json", {
      apiVersion: "v1",
      data: {
        conversations: [{
          conversationId: ids.conversationId,
          characterKey: "lucia",
          characterName: "Lucía Martín",
          avatarUrl: null,
          avatarClass: "avatar--lucia",
          roleLabel: "主要好友",
          lastMessageAt: ids.createdAt,
          lastMessage: { role: "user", snippet: "Hola", createdAt: ids.createdAt },
          isPinned: true,
          isMuted: false,
          sortRank: null,
          unreadCount: 2,
        }],
      },
    });

    valid("conversation-history-response.schema.json", {
      apiVersion: "v1",
      data: {
        characterKey: "lucia",
        readOnly: true,
        messages: [{
          id: ids.messageId,
          clientMessageId: "client-1",
          generationId: "generation-1",
          role: "user",
          text: "Hola",
          complete: true,
          status: "completed",
          withdrawn: false,
          createdAt: ids.createdAt,
          sourceType: "conversation",
        }],
      },
    });

    valid("conversation-search-response.schema.json", {
      apiVersion: "v1",
      data: {
        query: "café",
        results: [{
          messageId: ids.messageId,
          characterKey: "lucia",
          characterName: "Lucía Martín",
          role: "character",
          snippet: "Hablamos del café…",
          createdAt: ids.createdAt,
        }],
      },
    });

    valid("conversation-stream-request.schema.json", {
      characterVersion: 1,
      text: "Hola",
      clientMessageId: "client-1",
      generationId: "generation-1",
    });

    const frameSchema = readJson<{ $id: string }>("conversation-stream-frame.schema.json");
    const validateFrame = ajv.getSchema(frameSchema.$id);
    expect(validateFrame).toBeDefined();
    for (const frame of [
      { type: "meta", protocolVersion: "v1", characterKey: "lucia", characterVersion: 1, generationId: "generation-1", messageId: ids.messageId },
      { type: "delta", generationId: "generation-1", messageId: ids.messageId, text: "¡Hola!" },
      { type: "done", generationId: "generation-1", messageId: ids.messageId },
      { type: "error", generationId: "generation-1", messageId: null, code: "stream-failed", retryable: true },
    ]) {
      expect(validateFrame?.(frame), JSON.stringify(validateFrame?.errors)).toBe(true);
    }

    valid("conversation-message-withdraw-request.schema.json", { action: "withdraw" });
    valid("conversation-message-delete-response.schema.json", { apiVersion: "v1", data: { deleted: true } });
    valid("conversation-message-withdraw-response.schema.json", { apiVersion: "v1", data: { withdrawn: true } });
  });

  it("rejects forged fields and unsupported stream frames", () => {
    const ajv = validator();
    const requestSchema = readJson<{ $id: string }>("conversation-stream-request.schema.json");
    const validateRequest = ajv.getSchema(requestSchema.$id);
    expect(validateRequest?.({ text: "Hola", clientMessageId: "c1", generationId: "g1", attemptId: "future" })).toBe(false);

    const frameSchema = readJson<{ $id: string }>("conversation-stream-frame.schema.json");
    const validateFrame = ajv.getSchema(frameSchema.$id);
    expect(validateFrame?.({ type: "delta", generationId: "g1", messageId: "m1", text: "Hola", provider: "minimax" })).toBe(false);

    const withdrawSchema = readJson<{ $id: string }>("conversation-message-withdraw-request.schema.json");
    const validateWithdraw = ajv.getSchema(withdrawSchema.$id);
    expect(validateWithdraw?.({ action: "withdraw", messageId: "m1" })).toBe(false);
  });

  it("accepts a bounded unanswered batch and recoverable prefixes while rejecting forged assistant content", () => {
    const ajv = validator();
    const validateRequest = ajv.getSchema(readJson<{ $id: string }>("conversation-stream-request.schema.json").$id)!;
    const batch = { text: "He comprado un libro.", clientMessageId: "latest", generationId: "new", pendingMessages: [{ text: "Me gusta la fotografía.", clientMessageId: "earlier", assistance: "translation" }], supersedes: { generationId: "old", visibleBubbleCount: 2 } };
    expect(validateRequest(batch)).toBe(true);
    expect(validateRequest({ ...batch, pendingMessages: Array.from({ length: 20 }, () => batch.pendingMessages[0]) })).toBe(false);
    expect(validateRequest({ ...batch, supersedes: { ...batch.supersedes, text: "forged character reply" } })).toBe(false);
    expect(validateRequest({ ...batch, supersedes: { ...batch.supersedes, visibleBubbleCount: -1 } })).toBe(false);
    const validateMessage = ajv.getSchema(readJson<{ $id: string }>("conversation-message.schema.json").$id)!;
    for (const status of ["streaming", "cancelled"]) {
      expect(validateMessage({ id: ids.messageId, generationId: "old", role: "character", text: "Una idea.\n\nOtra idea.", complete: status === "cancelled", status, withdrawn: false, createdAt: ids.createdAt })).toBe(true);
    }
  });

  it("exposes every conversation operation and resolves its local schema references", () => {
    const openApi = JSON.parse(fs.readFileSync(openApiPath, "utf8")) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const expected: Record<string, string> = {
      "/conversations": "conversation-list-response.schema.json",
      "/conversations/search": "conversation-search-response.schema.json",
      "/conversations/{characterId}": "conversation-history-response.schema.json",
      "/conversations/{characterId}/stream": "conversation-stream-frame.schema.json",
      "/conversations/{characterId}/messages/{messageId}": "conversation-message-delete-response.schema.json",
    };
    for (const [route, schemaName] of Object.entries(expected)) {
      expect(openApi.paths[route], route).toBeDefined();
      const operation = route.endsWith("/stream")
        ? openApi.paths[route]?.post
        : route.includes("messages/{messageId}")
          ? openApi.paths[route]?.delete
          : openApi.paths[route]?.get;
      expect(operation, `${route} operation`).toBeDefined();
      const responses = (operation as { responses: Record<string, unknown> }).responses;
      const success = responses["200"] as { content: Record<string, { schema?: { $ref?: string } }> };
      expect(success.content[route.endsWith("/stream") ? "application/x-ndjson" : "application/json"]?.schema?.$ref).toContain(schemaName);
    }

    const mutation = openApi.paths["/conversations/{characterId}/messages/{messageId}"];
    expect((mutation?.patch as { requestBody?: { content?: { "application/json"?: { schema?: { $ref?: string } } } } }).requestBody?.content?.["application/json"]?.schema?.$ref).toContain("conversation-message-withdraw-request.schema.json");
  });
});
