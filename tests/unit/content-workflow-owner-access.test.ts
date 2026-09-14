// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";

import {
  ContentWorkflowForbiddenError,
  assertContentWorkflowOwner,
  isContentWorkflowOwner,
} from "@/src/shared/auth/content-workflow-owner";

describe("content workflow owner access", () => {
  const previous = process.env.CONTENT_WORKFLOW_OWNER_USER_IDS;
  const ownerId = "00000000-0000-4000-8000-000000000701";

  afterEach(() => {
    if (previous === undefined) delete process.env.CONTENT_WORKFLOW_OWNER_USER_IDS;
    else process.env.CONTENT_WORKFLOW_OWNER_USER_IDS = previous;
  });

  it("fails closed when the server allowlist is absent or malformed", () => {
    delete process.env.CONTENT_WORKFLOW_OWNER_USER_IDS;
    expect(isContentWorkflowOwner(ownerId)).toBe(false);
    process.env.CONTENT_WORKFLOW_OWNER_USER_IDS = "owner@example.test,not-a-uuid";
    expect(isContentWorkflowOwner(ownerId)).toBe(false);
  });

  it("accepts only exact UUIDs from the server allowlist", () => {
    process.env.CONTENT_WORKFLOW_OWNER_USER_IDS = `${ownerId}, 00000000-0000-4000-8000-000000000702`;
    expect(isContentWorkflowOwner(ownerId)).toBe(true);
    expect(isContentWorkflowOwner("00000000-0000-4000-8000-000000000799")).toBe(false);
  });

  it("does not trust a client supplied role", () => {
    process.env.CONTENT_WORKFLOW_OWNER_USER_IDS = "00000000-0000-4000-8000-000000000702";
    expect(() => assertContentWorkflowOwner(ownerId, { role: "owner" })).toThrow(
      ContentWorkflowForbiddenError,
    );
  });
});
