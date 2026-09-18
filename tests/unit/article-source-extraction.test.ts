import { describe, expect, it } from "vitest";

import { extractArticlePage } from "@/src/modules/content-acquisition/adapters/articles/article-source-adapter";

describe("article source extraction", () => {
  it("keeps article paragraphs while excluding navigation, ads, and footer noise", () => {
    const page = extractArticlePage(`
      <html><head><title>Noticia</title></head><body>
        <header><p>Cabecera</p></header>
        <nav><p>Menú</p></nav>
        <main>
          <p>Primer párrafo.</p>
          <div class="advertisement"><p>Anuncio</p></div>
          <p>Segundo párrafo.</p>
          <aside id="social-share"><p>Compartir</p></aside>
        </main>
        <footer><p>Pie legal</p></footer>
      </body></html>
    `, "https://example.test/article", "2026-09-18T00:00:00.000Z");

    expect(page.paragraphs).toEqual(["Primer párrafo.", "Segundo párrafo."]);
  });

  it("does not fall back to page chrome when the preferred article root is empty", () => {
    const page = extractArticlePage("<html><body><article></article><footer><p>Legal</p></footer></body></html>", "https://example.test/article", "2026-09-18T00:00:00.000Z");
    expect(page.paragraphs).toEqual([]);
  });
});
