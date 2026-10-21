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

const STABLE_KEY = "scenario.campus-administration";
const ACTIVITY_PATH = /\/api\/v1\/practice\/sessions\/[^/]+\/activity$/;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  navigationMocks.push.mockReset();
  vi.restoreAllMocks();
});

describe("scenario practice records learning activity", () => {
  it("sends active heartbeats through the workbench and exactly one ended on unmount", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/v1/scenario-practice/sessions") {
        return new Response(JSON.stringify({ data: { persistence: "account" } }), { status: 201 });
      }
      if (url.endsWith("/respond")) {
        return new Response("{\"type\":\"delta\",\"text\":\"Vale.\"}\n{\"type\":\"done\"}\n", { status: 200 });
      }
      return new Response(null, { status: 204 });
    });
    const activityCalls = () =>
      fetchMock.mock.calls.filter(([url]) => ACTIVITY_PATH.test(String(url)));

    const { unmount } = render(
      <ScenarioPracticeWorkbench scenario={getScenarioPracticeDetail(STABLE_KEY)!} />,
    );
    const input = await screen.findByLabelText("用西班牙语完成你的表达");
    fireEvent.change(input, { target: { value: "Buenos días." } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(activityCalls().length).toBeGreaterThan(0));
    expect(JSON.parse(String(activityCalls()[0]![1]!.body))).toMatchObject({
      eventType: "active",
      sequence: 0,
    });

    unmount();
    await waitFor(() => {
      const types = activityCalls().map(
        ([, init]) => (JSON.parse(String(init!.body)) as { eventType: string }).eventType,
      );
      expect(types.filter((type) => type === "ended")).toHaveLength(1);
    });
  });
});
