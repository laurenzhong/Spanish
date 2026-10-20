/** Join the official audio metadata export to existing example sentence IDs.
 * Usage: pnpm exec tsx scripts/build-tatoeba-audio-asset.ts <sentences_with_audio.csv>
 * Download metadata only from https://downloads.tatoeba.org/exports/sentences_with_audio.tar.bz2.
 * Empty/unknown licences fail closed. Audio files are never downloaded by this script.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { parseTatoebaAudio, type TatoebaAudio } from "@/src/modules/lexicon-corpus/domain/tatoeba-audio";

const input = process.argv[2];
if (!input) throw new Error("Pass the official sentences_with_audio.csv metadata export");
const root = path.join(process.cwd(), "content", "word-lists");
const examples = JSON.parse(readFileSync(path.join(root, "es-examples-tatoeba-v1.json"), "utf8")) as {
  examples: Record<string, { examples: { sentenceId: number }[] }>;
};
const wanted = new Set(Object.values(examples.examples).flatMap((entry) => entry.examples.map((example) => example.sentenceId)));
const bytes = readFileSync(input);
const audios: Record<string, TatoebaAudio> = {};
let restricted = 0;
for (const line of bytes.toString("utf8").split(/\r?\n/u)) {
  const [sentenceId, audioId, author, license, attributionUrl] = line.split("\t");
  if (!wanted.has(Number(sentenceId))) continue;
  // The official export currently leaves attribution URL blank for these authors;
  // link their Tatoeba profile, as the API's audio metadata does. Never infer licence.
  const creditUrl = attributionUrl || (author ? `https://tatoeba.org/en/users/show/${encodeURIComponent(author)}` : "");
  const audio = parseTatoebaAudio({ id: Number(audioId), author, license, attributionUrl: creditUrl });
  if (!audio) { restricted += 1; continue; }
  // Keep one recording per sentence. Prefer unrestricted licences over NC/ND.
  const previous = audios[sentenceId!];
  if (!previous || (/NC|ND/u.test(previous.license) && !/NC|ND/u.test(audio.license))) audios[sentenceId!] = audio;
}
const output = path.join(root, "es-audio-tatoeba-v1.json");
const asset = {
  source: "tatoeba", sourceUrl: "https://downloads.tatoeba.org/exports/sentences_with_audio.tar.bz2",
  generatedAt: new Date().toISOString(), exportSha256: createHash("sha256").update(bytes).digest("hex"),
  usage: "owner-only-noncommercial-unmodified-playback", audios,
};
writeFileSync(`${output}.tmp`, `${JSON.stringify(asset)}\n`, "utf8");
renameSync(`${output}.tmp`, output);
console.log(JSON.stringify({ uniqueExampleSentences: wanted.size, recordings: Object.keys(audios).length, restricted,
  wordsWithAudio: Object.values(examples.examples).filter((entry) => entry.examples.some((example) => audios[example.sentenceId])).length }));
