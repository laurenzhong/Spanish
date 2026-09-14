import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), verifyRequestUser: vi.fn(), getDatabase: vi.fn(), createRepository: vi.fn(), repository: { listSkillStates: vi.fn(), listEvidence: vi.fn() } }));
vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: mocks.getCurrentUser, verifyRequestUser: mocks.verifyRequestUser }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/src/modules/profile/repositories", () => ({ createDrizzleProfileRepository: mocks.createRepository }));

import { GET } from "@/app/api/v1/profile/route";

describe("GET /api/v1/profile four capability projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyRequestUser.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000031" });
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.getDatabase.mockReturnValue({});
    mocks.createRepository.mockReturnValue(mocks.repository);
    mocks.repository.listSkillStates.mockResolvedValue([]);
    mocks.repository.listEvidence.mockResolvedValue([]);
  });

  it("returns legacy axes and explicit capabilityGroups without changing legacy summary", async () => {
    const response = await GET(new NextRequest("http://localhost/api/v1/profile", { headers: { "x-request-id": "profile_12345678" } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.axes).toHaveLength(8);
    expect(body.data.summary).toEqual({ totalAxes: 8, totalEvidence: 0, verifiedAxes: 0 });
    expect(body.data.capabilityGroups).toHaveLength(4);
    expect(body.data.capabilitySummary).toEqual({ totalEvidence: 0, totalGroups: 4, verifiedGroups: 0 });
  });
});
