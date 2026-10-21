import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigationMocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigationMocks.push }),
}));

import {
  getScenarioPracticeDetail,
  ScenarioPracticeWorkbench,
} from "@/src/modules/scenario-practice";
import { scenarioPracticeHeartbeatSessionId } from "@/src/modules/scenario-practice/activity";

const STABLE_KEY = "scenario.campus-administration";

type StoredPractice = Readonly<{
  completed?: boolean;
  persistence?: "account" | "device";
  sessionId: string;
}>;

function storedPractice(): StoredPractice | null {
  const raw = window.localStorage.getItem(`scenario-practice:v1:${STABLE_KEY}`);
  return raw ? (JSON.parse(raw) as StoredPractice) : null;
}

async function runOneTurn(): Promise<void> {
  render(<ScenarioPracticeWorkbench scenario={getScenarioPracticeDetail(STABLE_KEY)!} />);
  const input = await screen.findByLabelText("用西班牙语完成你的表达");
  fireEvent.change(input, { target: { value: "Buenos días, quisiera solicitar el certificado." } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  navigationMocks.push.mockReset();
  vi.restoreAllMocks();
});

/**
 * The heartbeat itself is started by the practice UI; these cases pin the two
 * facts that wiring depends on, so a change to the practice checkpoint cannot
 * silently make learning activity uncollectable again.
 */
describe("scenario practice heartbeat eligibility", () => {
  it("persists a heartbeat-eligible account session once a turn is synced", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/v1/scenario-practice/sessions") {
        return new Response(JSON.stringify({ data: { persistence: "account" } }), { status: 201 });
      }
      if (url.endsWith("/respond")) {
        return new Response("{\"type\":\"delta\",\"text\":\"Vale.\"}\n{\"type\":\"done\"}\n", { status: 200 });
      }
      return new Response(null, { status: 204 });
    });

    await runOneTurn();

    await waitFor(() => {
      const session = storedPractice();
      expect(session?.persistence).toBe("account");
      expect(session?.completed).toBe(false);
      expect(scenarioPracticeHeartbeatSessionId(session!, { hydrated: true })).toBe(
        session!.sessionId,
      );
    });
  });

  it("stays ineligible for device-only practice, which has no server session", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/respond")) {
        return new Response("{\"type\":\"delta\",\"text\":\"Vale.\"}\n{\"type\":\"done\"}\n", { status: 200 });
      }
      return new Response(null, { status: 503 });
    });

    await runOneTurn();

    await waitFor(() => {
      const session = storedPractice();
      expect(session?.sessionId).toBeTruthy();
      expect(session?.persistence).toBe("device");
      expect(scenarioPracticeHeartbeatSessionId(session!, { hydrated: true })).toBeNull();
    });
  });
});
