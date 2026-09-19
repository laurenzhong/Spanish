import { describe, expect, it } from "vitest";

import { classifyYoutubeRecoveryFailure } from "@/src/modules/media/storage/youtube-recovery-failure";

describe("YouTube recovery failure classification", () => {
  const base = { code: 1, exceededOutput: false, timedOut: false, aborted: false };

  it("treats age/login gates as permanently unhostable", () => {
    expect(classifyYoutubeRecoveryFailure({ ...base, diagnostic: "Sign in to confirm your age" })).toBe("AGE_RESTRICTED");
    expect(classifyYoutubeRecoveryFailure({ ...base, diagnostic: "This video is age-restricted" })).toBe("AGE_RESTRICTED");
  });

  it("keeps bot checks and transient failures retryable", () => {
    expect(classifyYoutubeRecoveryFailure({ ...base, diagnostic: "Sign in to confirm you are not a bot" })).toBe("MANUAL_SIGNIN_REQUIRED");
    expect(classifyYoutubeRecoveryFailure({ ...base, diagnostic: "network connection timed out" })).toBe("NETWORK_FAILED");
  });
});
