import { describe, expect, it } from "vitest";

import { formatNaturalDate, getDueLuciaProactiveSlots, getLuciaProactiveSlots, parseLuciaProactiveUserIds } from "@/src/modules/conversation/application/proactive-runner-utils";

describe("Lucía proactive daily runner", () => {
  it("requires an explicit UUID allowlist and removes duplicate ids", () => {
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";
    expect(parseLuciaProactiveUserIds(`${first}, ${first},${second}`)).toEqual([first, second]);
    expect(() => parseLuciaProactiveUserIds("")).toThrow("LUCIA_PROACTIVE_USER_IDS");
    expect(() => parseLuciaProactiveUserIds("not-a-uuid")).toThrow("comma-separated list of UUIDs");
  });

  it("uses the configured product timezone for the daily dedupe date", () => {
    expect(formatNaturalDate(new Date("2026-09-24T01:00:00.000Z"))).toBe("2026-09-24");
    expect(formatNaturalDate(new Date("2026-09-24T16:00:00.000Z"))).toBe("2026-09-25");
  });

  it("assigns stable multiple daily slots per user", () => {
    const slots = getLuciaProactiveSlots("00000000-0000-4000-8000-000000000001", "2026-09-24");
    expect(slots).toHaveLength(3);
    expect(slots).toEqual(getLuciaProactiveSlots("00000000-0000-4000-8000-000000000001", "2026-09-24"));
    expect(slots.map((slot) => slot.sourceEventId)).toEqual(["2026-09-24:slot-1", "2026-09-24:slot-2", "2026-09-24:slot-3"]);
    expect(getDueLuciaProactiveSlots({ userId: "00000000-0000-4000-8000-000000000001", now: new Date("2026-09-24T02:00:00.000Z") }).length).toBe(1);
  });
});
