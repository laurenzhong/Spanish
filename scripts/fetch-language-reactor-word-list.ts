/**
 * Fetch the Spanish word list from Language Reactor's language dictionary.
 *
 * `base_dict_getAllWordsForLang` is the data source behind that site's own
 * ALL_WORDS tab: a language-level frequency list, not a statistic over anyone's
 * content. It needs no credentials — the research session confirmed an anonymous
 * `credentials: omit` request returns it — and the project owner has authorised
 * capturing data from the site.
 *
 * Writes `content/word-lists/es-frequency-v1.json` plus a provenance manifest.
 * Run through the proxy, since the host is not reachable directly here:
 *
 *   $env:HTTPS_PROXY="http://127.0.0.1:7897"
 *   node --use-env-proxy --conditions=react-server --import tsx/esm \
 *     scripts/fetch-language-reactor-word-list.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const endpoint = "https://api-cdn.dioco.io/base_dict_getAllWordsForLang?lang_G=es&numWords=8000";
const outputDir = path.join(process.cwd(), "content/word-lists");
const outputFile = path.join(outputDir, "es-frequency-v1.json");
const manifestFile = path.join(outputDir, "es-frequency-v1.provenance.json");

console.log("fetching:", endpoint);

const response = await fetch(endpoint, {
  // Anonymous on purpose: this endpoint is a public language dictionary and does
  // not consult any account.
  credentials: "omit",
  headers: { accept: "application/json" },
});

console.log("status:", response.status);
if (!response.ok) {
  console.log("body:", (await response.text()).slice(0, 400));
  process.exit(1);
}

const payload = (await response.json()) as {
  status?: string;
  data?: { words?: { text?: unknown }[] };
};

const words = payload.data?.words;
if (!Array.isArray(words)) {
  console.log("unexpected shape; top-level keys:", Object.keys(payload));
  console.log(JSON.stringify(payload).slice(0, 400));
  process.exit(1);
}

const cleaned = words
  .map((entry) => (typeof entry?.text === "string" ? entry.text.trim() : ""))
  .filter((text) => text.length > 0);

console.log("status field:", payload.status);
console.log("words returned:", words.length, "| usable:", cleaned.length);
console.log("distinct:", new Set(cleaned).size);
console.log("first 20:", cleaned.slice(0, 20).join(" · "));
console.log("last 10:", cleaned.slice(-10).join(" · "));

await mkdir(outputDir, { recursive: true });
await writeFile(
  outputFile,
  `${JSON.stringify(
    {
      version: 1,
      locale: "es",
      // Rank order is the data: index 0 is the most frequent word.
      words: cleaned,
    },
    null,
    0,
  )}\n`,
  "utf8",
);

await writeFile(
  manifestFile,
  `${JSON.stringify(
    {
      source: "Language Reactor (language-reactor.com), ALL_WORDS language dictionary",
      endpoint,
      fetchedAt: new Date().toISOString(),
      httpStatus: response.status,
      wordsReturned: words.length,
      wordsStored: cleaned.length,
      note:
        "Language-level frequency list, anonymous and credential-free. Captured with the project owner's authorisation. " +
        "Rank order is meaningful; the list is a ranked reference, not derived from this project's content.",
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log("wrote:", outputFile, "and", manifestFile);
