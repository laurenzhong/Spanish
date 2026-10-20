import { installReadAloud } from "./read-aloud";
import type { Page } from "@playwright/test";

/** Published dictionary and provider fakes; browser checks never bill a provider. */
export async function installMediaWordTools(page: Page) {
  await page.route("**/api/v1/read/word-lookup", async (route) => {
    const { word } = route.request().postDataJSON() as { word: string };
    await route.fulfill({ json: { data: {
      found: true, word, meanings: [{ meaning: word === "café" ? "咖啡" : "好的", usage: "" }],
      meaningSource: "language-reactor", partOfSpeech: "词典词性", cefr: "A1",
      usageNotes: [], collocations: [], examples: [], forms: [],
    } } });
  });
  await page.route("**/api/v1/read/word-explanation", async (route) => {
    await route.fulfill({ contentType: "application/x-ndjson", body: JSON.stringify({ type: "done", explanation: {
      partOfSpeech: "名词", meaning: "咖啡", contextualMeaning: "这里指一杯咖啡。", example: "Quiero un café.",
    } }) + "\n" });
  });
  await installReadAloud(page);
}
