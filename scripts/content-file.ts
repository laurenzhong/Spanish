import { readFile } from "node:fs/promises";
import path from "node:path";

export function requireContentFileArgument(): string {
  const argument = process.argv.slice(2).find((value) => value.trim() !== "--");
  if (!argument) {
    throw new Error("Provide a content bundle JSON file path.");
  }
  return path.resolve(process.cwd(), argument);
}

export async function readContentFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}
