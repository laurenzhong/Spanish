import { validateContentBundle } from "../src/modules/content/import/validate-content";
import {
  readContentFile,
  requireContentFileArgument,
} from "./content-file";

const filePath = requireContentFileArgument();
const bundle = validateContentBundle(await readContentFile(filePath));

process.stdout.write(
  `Valid content bundle: ${bundle.bundle.stableKey}@${bundle.bundle.version}\n`,
);
