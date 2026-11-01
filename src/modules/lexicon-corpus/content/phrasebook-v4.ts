import { z } from "zod";
import { phrasebookEntrySchema } from "../domain/phrasebook";
import { phrasebookEntries as thirdEditionEntries } from "./phrasebook-v3";
import { phrasebookV4Expansion } from "./phrasebook-v4-expansion";

// Earlier editions remain immutable; v4 appends the owner-authorized expansion.
export const phrasebookVersion = "2026-11-01.v4";
export const phrasebookEntries = z.array(phrasebookEntrySchema).parse([
  ...thirdEditionEntries,
  ...phrasebookV4Expansion,
]);
