import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("daily content workflow is protected and non-publishing", async () => {
  const workflow = await readFile(".github/workflows/content-acquisition-daily.yml", "utf8");
  expect(workflow).toContain("concurrency:");
  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).toContain("article_mode:");
  expect(workflow).toContain("discover-only");
  expect(workflow).toContain("review-only");
  expect(workflow).toContain("auto-publish");
  expect(workflow).toContain("content:pipeline");
  expect(workflow).not.toContain("content:publish");
});
