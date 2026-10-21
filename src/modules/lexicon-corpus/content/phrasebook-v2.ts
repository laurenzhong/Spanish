import { z } from "zod";
import { phrasebookEntrySchema } from "../domain/phrasebook";
import { phrasebookEntries as firstEditionEntries } from "./phrasebook-v1";
import { phrasebookExpansionA } from "./phrasebook-expansion-a";
import { phrasebookExpansionB } from "./phrasebook-expansion-b";

// Preserve the independently reviewed first edition and its bookmark IDs.
export const phrasebookVersion = "2026-10-15.v2";
export const phrasebookEntries = z.array(phrasebookEntrySchema).parse([
  ...firstEditionEntries,
  ...phrasebookExpansionA,
  ...phrasebookExpansionB,
]);
