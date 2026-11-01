import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

type Group = { id: string; specs: string[]; port: number };

const groups: Group[] = [
  {
    id: "core-conversation",
    port: 3101,
    specs: [
      "tests/e2e/conversation.spec.ts",
      "tests/e2e/conversation-rhythm.spec.ts",
      "tests/e2e/chat-assistant.spec.ts",
      "tests/e2e/chat-expression-assist.spec.ts",
      "tests/e2e/alpha-flow.spec.ts",
      "tests/e2e/scenario-practice.spec.ts",
      "tests/e2e/training-loop.spec.ts",
      "tests/e2e/ui-011-regression.spec.ts",
    ],
  },
  {
    id: "product-read",
    port: 3102,
    specs: [
      "tests/e2e/product-shell.spec.ts",
      "tests/e2e/public-home.spec.ts",
      "tests/e2e/explore-page.spec.ts",
      "tests/e2e/learn-page.spec.ts",
      "tests/e2e/read-library-unavailable.spec.ts",
      "tests/e2e/read-section-navigation.spec.ts",
      "tests/e2e/article-layout.spec.ts",
      "tests/e2e/article-read-aloud.spec.ts",
      "tests/e2e/article-transfer.spec.ts",
    ],
  },
  {
    id: "media-lexicon",
    port: 3103,
    specs: [
      "tests/e2e/media-browse.spec.ts",
      "tests/e2e/media-library.spec.ts",
      "tests/e2e/media-library-scroll.spec.ts",
      "tests/e2e/media-series.spec.ts",
      "tests/e2e/media-series-after-playback.spec.ts",
      "tests/e2e/podcast-learning.spec.ts",
      "tests/e2e/video-learning.spec.ts",
      "tests/e2e/shared-read-aloud.spec.ts",
      "tests/e2e/lexicon-library.spec.ts",
      "tests/e2e/vocabulary-panel.spec.ts",
      "tests/e2e/corpus-workbench.spec.ts",
    ],
  },
  {
    id: "content-profile",
    port: 3104,
    specs: [
      "tests/e2e/article-acquisition.spec.ts",
      "tests/e2e/content-pack.spec.ts",
      "tests/e2e/content-pipeline-smoke.spec.ts",
      "tests/e2e/content-workflow.spec.ts",
      "tests/e2e/generate-story.spec.ts",
      "tests/e2e/phrasebook.spec.ts",
      "tests/e2e/phrasebook-dialogue.spec.ts",
      "tests/e2e/phrasebook-expansion.spec.ts",
      "tests/e2e/profile-four-capabilities.spec.ts",
    ],
  },
];

const runner = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const tempRoot = process.env.RUNNER_TEMP ?? ".tmp-e2e-matrix";
await mkdir(tempRoot, { recursive: true });

function runGroup(group: Group): Promise<Record<string, unknown>> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const outputDir = join("test-results", group.id);
  const htmlDir = join("playwright-report", group.id);
  const child = spawn(
    runner,
    [
      "exec",
      "playwright",
      "test",
      ...group.specs,
      "--workers=1",
      "--reporter=line",
      `--output=${outputDir}`,
    ],
    {
      env: {
        ...process.env,
        PLAYWRIGHT_PORT: String(group.port),
        NEXT_DIST_DIR: `.next/e2e-matrix-${group.id}`,
        PLAYWRIGHT_HTML_OUTPUT_DIR: htmlDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
    process.stdout.write(`[${group.id}] ${chunk.toString()}`);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
    process.stderr.write(`[${group.id}] ${chunk.toString()}`);
  });

  return new Promise((resolve) => {
    child.on("close", (code, signal) => {
      const result = {
        id: group.id,
        specs: group.specs,
        port: group.port,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        exitCode: code,
        signal,
        stdout,
        stderr,
      };
      void writeFile(join(tempRoot, `e2e-${group.id}.log`), stdout + "\n" + stderr);
      resolve(result);
    });
  });
}

const results = await Promise.all(groups.map(runGroup));
await writeFile(
  join(tempRoot, "e2e-matrix-result.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
);
const failed = results.filter((result) => result.exitCode !== 0 || result.signal);
console.log(`E2E matrix complete: ${results.length - failed.length}/${results.length} groups passed`);
if (failed.length > 0) {
  process.exitCode = 1;
}

