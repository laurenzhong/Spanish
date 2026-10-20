import { z } from "zod";
import { phrasebookEntrySchema } from "../domain/phrasebook";
import { phrasebookEntries as secondEditionEntries } from "./phrasebook-v2";
import { phrasebookV3Social } from "./phrasebook-v3-social";
import { phrasebookV3Practical } from "./phrasebook-v3-practical";

// Earlier editions and their review manifests are preserved unchanged.
export const phrasebookVersion = "2026-10-15.v3";
export const phrasebookEntries = z.array(phrasebookEntrySchema).parse([
  ...secondEditionEntries,
  ...phrasebookV3Social,
  ...phrasebookV3Practical,
]);
