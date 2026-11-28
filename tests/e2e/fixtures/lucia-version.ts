import { readFileSync } from "node:fs";

const bible = JSON.parse(readFileSync(new URL("../../../content/characters/lucia.json", import.meta.url), "utf8")) as { version: number };

export const luciaVersion = bible.version;
