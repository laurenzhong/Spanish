import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { recordLearningActivityInputSchema } from "@/src/modules/profile/application";
import {
  createScenarioPracticeActivityHeartbeat,
  scenarioPracticeHeartbeatSessionId,
  useScenarioPracticeActivityHeartbeat,
} from "@/src/modules/scenario-practice/activity";

const SESSION_ID = "0b6f6f2e-0000-4000-8000-000000000001";
const HEARTBEAT_INTERVAL_MS = 15_000;

type ActivityBody = Readonly<{
  clientInstanceId: string;
  eventType: "active" | "inactive" | "ended";
  sequence: number;
}>;

function activityBodies(calls: readonly unknown[][]): ActivityBody[] {
  return calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)) as ActivityBody);
}

function activityUrls(calls: readonly unknown[][]): string[] {
  return calls.map((call) => String(call[0]));
}

function recordingFetch(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ apiVersion: "v1", data: { status: "inserted" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("scenario practice learning-activity heartbeat", () => {
  it("only heartbeats a hydrated, account-persisted, unfinished session", () => {
    expect(
      scenarioPracticeHeartbeatSessionId(
        { persistence: "account", sessionId: "session-1" },
        { hydrated: true },
      ),
    ).toBe("session-1");
    // Device-only practice has no `practice_sessions` row to attach events to.
    expect(
      scenarioPracticeHeartbeatSessionId(
        { persistence: "device", sessionId: "session-1" },
        { hydrated: true },
      ),
    ).toBeNull();
    expect(
      scenarioPracticeHeartbeatSessionId(
        { completed: true, persistence: "account", sessionId: "session-1" },
        { hydrated: true },
      ),
    ).toBeNull();
    expect(
      scenarioPracticeHeartbeatSessionId(
        { persistence: "account", sessionId: "session-1" },
        { hydrated: false },
      ),
    ).toBeNull();
    expect(
      scenarioPracticeHeartbeatSessionId({ sessionId: "" }, { hydrated: true }),
    ).toBeNull();
  });

  it("posts events to the existing endpoint using only schema-accepted fields", () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(recordingFetch());
    const recorder = createScenarioPracticeActivityHeartbeat(SESSION_ID, { fetcher });

    recorder.start();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    recorder.stop();

    expect(activityUrls(fetcher.mock.calls)).toEqual([
      `/api/v1/practice/sessions/${SESSION_ID}/activity`,
      `/api/v1/practice/sessions/${SESSION_ID}/activity`,
      `/api/v1/practice/sessions/${SESSION_ID}/activity`,
    ]);
    // The client never sends durations or minutes: exactly the schema's fields,
    // and every body parses, so the endpoint can never reject our own events.
    const bodies = activityBodies(fetcher.mock.calls).map((body) =>
      recordLearningActivityInputSchema.parse(body),
    );
    expect(bodies.map((body) => body.eventType)).toEqual(["active", "active", "ended"]);
    expect(bodies.map((body) => body.sequence)).toEqual([0, 1, 2]);
    expect(Object.keys(activityBodies(fetcher.mock.calls)[0]!).sort()).toEqual([
      "clientInstanceId",
      "eventType",
      "sequence",
    ]);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({
      credentials: "same-origin",
      method: "POST",
    });
    expect(fetcher.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("never breaks the practice flow when the activity endpoint fails", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const recorder = createScenarioPracticeActivityHeartbeat(SESSION_ID, { fetcher });

    expect(() => recorder.start()).not.toThrow();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(() => recorder.stop()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);

    const rejectedEndpoint = vi.fn(
      async () => new Response(null, { status: 503 }),
    ) as unknown as typeof fetch;
    const second = createScenarioPracticeActivityHeartbeat(SESSION_ID, {
      fetcher: rejectedEndpoint,
    });
    expect(() => second.start()).not.toThrow();
    expect(() => second.stop()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
  });

  it("collects while the practice page is open and ends exactly once on unmount", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ apiVersion: "v1", data: { status: "inserted" } }), {
        status: 200,
      }),
    );
    const { unmount } = renderHook(
      (props: { sessionId: string | null }) =>
        useScenarioPracticeActivityHeartbeat(props.sessionId),
      { initialProps: { sessionId: SESSION_ID } },
    );

    expect(activityBodies(fetchMock.mock.calls).map((body) => body.eventType)).toEqual([
      "active",
    ]);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(activityBodies(fetchMock.mock.calls).map((body) => body.eventType)).toEqual([
      "active",
      "active",
    ]);

    unmount();
    const callsAfterUnmount = fetchMock.mock.calls.length;
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);
    await vi.advanceTimersByTimeAsync(0);

    const endTypes = activityBodies(fetchMock.mock.calls).map((body) => body.eventType);
    expect(endTypes.filter((type) => type === "ended")).toHaveLength(1);
    expect(endTypes.at(-1)).toBe("ended");
    // Nothing after `ended`: no timer leak, no post-teardown traffic.
    expect(fetchMock.mock.calls.length).toBe(callsAfterUnmount);
  });

  it("sends nothing for a practice without a server session and stops when it closes", () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const { rerender } = renderHook(
      (props: { sessionId: string | null }) =>
        useScenarioPracticeActivityHeartbeat(props.sessionId),
      { initialProps: { sessionId: null } as { sessionId: string | null } },
    );

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();

    rerender({ sessionId: SESSION_ID });
    expect(activityBodies(fetchMock.mock.calls).map((body) => body.eventType)).toEqual([
      "active",
    ]);

    rerender({ sessionId: null });
    const callsAfterClose = fetchMock.mock.calls.length;
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    const types = activityBodies(fetchMock.mock.calls).map((body) => body.eventType);
    expect(types).toEqual(["active", "ended"]);
    expect(fetchMock.mock.calls.length).toBe(callsAfterClose);
  });

  it("keeps one client instance and a monotonic sequence when a completion is rolled back", () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const { rerender } = renderHook(
      (props: { sessionId: string | null }) =>
        useScenarioPracticeActivityHeartbeat(props.sessionId),
      { initialProps: { sessionId: SESSION_ID } as { sessionId: string | null } },
    );

    // A failed completion rolls `completed` back to false in the practice UI.
    rerender({ sessionId: null });
    rerender({ sessionId: SESSION_ID });

    const bodies = activityBodies(fetchMock.mock.calls);
    expect(bodies.map((body) => body.eventType)).toEqual(["active", "ended", "active"]);
    expect(bodies.map((body) => body.sequence)).toEqual([0, 1, 2]);
    expect(new Set(bodies.map((body) => body.clientInstanceId)).size).toBe(1);
  });
});
