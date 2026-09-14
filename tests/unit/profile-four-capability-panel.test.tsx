import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FourCapabilityPanel } from "@/src/modules/profile/ui/four-capability-panel";
import { buildFourCapabilityOverview } from "@/src/modules/profile/domain";

const overview = buildFourCapabilityOverview("00000000-0000-4000-8000-000000000031", [], [], new Date("2026-08-23T00:00:00.000Z"));

describe("FourCapabilityPanel", () => {
  it("renders four empty capability groups without old eight-axis radar labels", () => {
    render(<FourCapabilityPanel overview={overview} />);
    expect(screen.getByRole("region", { name: "四板块能力摘要" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "四板块能力" })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.getByRole("region", { name: "四板块能力" }).querySelectorAll(".capability-group__status")).toHaveLength(4);
    expect(screen.queryByText("八维能力")).not.toBeInTheDocument();
  });
});
