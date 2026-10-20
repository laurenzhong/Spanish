import { z } from "zod";

export const mediaProcessingAuthorizationSchema = z.strictObject({
  version: z.literal(1),
  allowedOperations: z.array(z.enum(["acquire-audio", "asr", "translate"])).min(1).max(3)
    .refine((operations) => new Set(operations).size === operations.length),
  audience: z.enum(["owner-private", "shared-learning"]),
  thirdPartyProcessing: z.boolean(),
  evidenceUrl: z.url().startsWith("https://").refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password;
  }),
  expiresAt: z.iso.datetime().nullable(),
});
