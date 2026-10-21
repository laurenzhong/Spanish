import { type Page } from "@playwright/test";
import type { CorpusExampleItem } from "@/src/modules/lexicon-corpus/schemas/corpus-examples";

export const corpusFixtures: CorpusExampleItem[] = [
  { id: "article:1", text: "A veces quedamos en el café de la esquina para hablar de nuestros planes.", translation: null, before: "El viernes termino de trabajar a las seis.", after: "Luego damos un paseo por el barrio.", sourceTitle: "Una tarde en el barrio", sourceName: "Lecturas de Sueño", contentKind: "article", document: { kind: "article", stableKey: "article.sueno-first-cafe", version: 1 }, location: { kind: "text", paragraphId: "segment-1", segmentIndex: 1 } },
  { id: "video:2", text: "Por eso prefiero quedar un poco antes y tomar un café sin prisas.", translation: "所以我更愿意早一点见面，不慌不忙地喝杯咖啡。", before: "Siempre hay mucha gente a partir de las siete.", after: "¿Te viene bien a las cinco?", sourceTitle: "Una conversación en la cafetería", sourceName: "Charlas cotidianas", contentKind: "video", document: { kind: "media", stableKey: "youtube.e2e-cafe", version: 1 }, location: { kind: "media", startMs: 3000, endMs: 6000, segmentIndex: 1 } },
  { id: "podcast:3", text: "A veces no hace falta tener un plan perfecto; basta con escuchar lo que le apetece a la otra persona.", translation: "有时候不必有一个完美的计划；听听对方想做什么就够了。", before: "Hoy hablamos de cómo organizar una tarde con amigos.", after: "Lo importante es encontrar un momento para estar juntos.", sourceTitle: "Planes sencillos, buenas conversaciones", sourceName: "Español de cerca", contentKind: "podcast", document: { kind: "media", stableKey: "podcast.e2e-cafe", version: 1 }, location: { kind: "media", startMs: 12000, endMs: 19000, segmentIndex: 2 } },
];

export async function installCorpusExamples(page: Page) {
  await page.route("**/api/v1/corpus/examples*", async (route) => {
    const query = new URL(route.request().url());
    const pageNumber = Number(query.searchParams.get("page") ?? "1");
    const text = query.searchParams.get("query");
    const kind = query.searchParams.get("contentKind");
    const items = text === "missing" ? [] : corpusFixtures.filter((item) => !kind || item.contentKind === kind).map((item) => pageNumber > 1 ? { ...item, id: `${item.id}:2`, sourceTitle: `${item.sourceTitle} · 第二页` } : item);
    await route.fulfill({ status: 200, json: { apiVersion: "v1", data: { items, page: pageNumber, pageSize: 12, total: !items.length ? 0 : text ? 15 : items.length } } });
  });
}

export { installReadAloud as installCorpusSpeech } from "./read-aloud";
