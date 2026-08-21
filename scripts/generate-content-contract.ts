import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { contentBundleSchema } from "../src/modules/content/schemas/content-bundle";

const outputPath = path.join(
  process.cwd(),
  "contracts",
  "schemas",
  "v1",
  "content-bundle.schema.json",
);
const generated = JSON.parse(
  JSON.stringify(
    z.toJSONSchema(contentBundleSchema, {
      target: "draft-2020-12",
      reused: "ref",
    }),
  ),
) as Record<string, unknown>;
const contract = {
  ...generated,
  $id: "https://spanish.local/contracts/v1/content-bundle.schema.json",
  title: "Spanish content bundle v1",
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
