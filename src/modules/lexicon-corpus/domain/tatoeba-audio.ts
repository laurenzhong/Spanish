import { z } from "zod";

// NC recordings are usable only in the current owner's noncommercial Alpha.
// ND recordings are played whole and unchanged; they are never clipped or remixed.
export const tatoebaAudioLicenses = [
  "CC0 1.0", "CC BY 2.0", "CC BY 2.0 FR", "CC BY 3.0", "CC BY 4.0",
  "CC BY-SA 3.0", "CC BY-SA 4.0", "CC BY-NC 3.0", "CC BY-NC 4.0",
  "CC BY-NC-SA 3.0", "CC BY-NC-SA 4.0", "CC BY-NC-ND 3.0", "CC BY-NC-ND 4.0",
] as const;

const audioSchema = z.object({
  id: z.number().int().positive(),
  author: z.string().trim().min(1).max(100),
  license: z.enum(tatoebaAudioLicenses),
  attributionUrl: z.url().refine((value) => {
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
    catch { return false; }
  }),
});

export type TatoebaAudio = z.infer<typeof audioSchema> & Readonly<{ url: string }>;

/** The documented export binds an audio ID to its sentence ID, not vice versa. */
export function parseTatoebaAudio(value: unknown): TatoebaAudio | null {
  const parsed = audioSchema.safeParse(value);
  if (!parsed.success) return null;
  return { ...parsed.data, url: `https://api.tatoeba.org/v1/audios/${parsed.data.id}/file` };
}
