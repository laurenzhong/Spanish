import { describe, expect, it } from "vitest";

import { buildContext } from "@/src/modules/lexicon-corpus/domain";

describe("corpus occurrence context", () => {
  it("creates bounded previous/current/next context", () => {
    expect(buildContext(["Uno", "Dos", "Tres"], 1)).toEqual({ before: "Uno", current: "Dos", after: "Tres" });
    expect(buildContext(["Uno"], 0)).toEqual({ before: "", current: "Uno", after: "" });
  });
});
