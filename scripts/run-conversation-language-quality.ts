import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { parseLanguageQualityArgs, runLanguageQualityBatch } from "./conversation-evaluation/language-quality-cli";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const abort = new AbortController();
const cancel = () => abort.abort();
process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
try {
  const options = parseLanguageQualityArgs(process.argv.slice(2));
  if (!options.exportOnly) { config({ path: path.join(repoRoot, ".env.local"), quiet: true }); config({ path: path.join(repoRoot, ".env"), quiet: true }); }
  const result = await runLanguageQualityBatch({ ...options, repoRoot, apiKey: process.env.MINIMAX_API_KEY, signal: abort.signal,
    onProgress: progress => console.log(JSON.stringify(progress)) });
  console.log(JSON.stringify(result, null, 2));
  if (result.archive.status !== "complete" || (!options.exportOnly && result.status !== "completed")) process.exitCode = 1;
} catch (error) { console.error(error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "LANGUAGE_QUALITY_FAILED"); process.exitCode = 1; }
finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }

