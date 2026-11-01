/**
 * CHAT-ASSISTANT-003: deterministic Spanish sense-group segmentation.
 *
 * The in-chat learning assistant used to let the language model decide how to
 * split a sentence into constituents, so the same sentence could come back
 * with a different split on every request. The structure intent now segments
 * the target sentence here, in pure deterministic code, and the model is only
 * asked to label and explain the groups it receives. The same input therefore
 * always produces the same fragments, independently of the model.
 *
 * The rules are deliberately conservative and rule-based: sentence punctuation,
 * pauses, a closed list of discourse markers and a closed list of coordinating
 * connectors. Anything ambiguous stays inside one group instead of being split
 * speculatively. These are teaching aids, not a full syntactic parser.
 */

export type SenseGroupKind = "interjection" | "connector" | "clause";

export type SenseGroup = Readonly<{
  /** Group text with surrounding punctuation trimmed; leading ¿/¡ are kept. */
  fragment: string;
  /**
   * `interjection` and `connector` groups get a fixed Simplified-Chinese role
   * (感叹词/连接词); `clause` groups are labelled by the provider.
   */
  kind: SenseGroupKind;
}>;

/** Mirrors the public structure DTO and keeps an answer readable in the panel. */
const maxSenseGroups = 12;

const sentenceTerminators = new Set([".", "!", "?", "…"]);
const closingPunctuation = new Set(['"', "»", "”", "'", "’", ")", "]", "}"]);
const wordPattern = /[a-záéíóúüñ0-9]+/giu;

/** Common abbreviations whose full stop does not end a sentence. */
const abbreviations = new Set([
  "aprox",
  "av",
  "dr",
  "dra",
  "ej",
  "ejm",
  "núm",
  "num",
  "p",
  "sr",
  "sra",
  "tel",
  "ud",
  "uds",
  "vs",
]);

type Marker = Readonly<{ text: string; words: readonly string[]; kind: SenseGroupKind }>;

function marker(text: string, kind: SenseGroupKind): Marker {
  return { text, words: text.split(/\s+/u), kind };
}

/** Interjections and response words; only tagged when a group is exactly one. */
const interjectionMarkers: readonly Marker[] = [
  "anda",
  "ay",
  "buenas",
  "buenas noches",
  "buenas tardes",
  "bueno",
  "buenos días",
  "claro",
  "estupendo",
  "genial",
  "guay",
  "hola",
  "hombre",
  "jo",
  "mira",
  "ojalá",
  "oye",
  "perfecto",
  "uf",
  "uff",
  "vale",
  "vaya",
  "venga",
].map((text) => marker(text, "interjection"));

/** Discourse connectors; only tagged when a group is exactly one. */
const connectorMarkers: readonly Marker[] = [
  "además",
  "así que",
  "aunque",
  "de todas formas",
  "de modo que",
  "en cambio",
  "en fin",
  "en principio",
  "en realidad",
  "encima",
  "entonces",
  "es decir",
  "finalmente",
  "la verdad",
  "luego",
  "mientras tanto",
  "o sea",
  "pero",
  "por cierto",
  "por ejemplo",
  "por eso",
  "porque",
  "primero",
  "pues",
  "segundo",
  "sin embargo",
  "sino",
  "total",
  "ya que",
].map((text) => marker(text, "connector"));

const wholeMarkerKinds = new Map<string, SenseGroupKind>(
  [...interjectionMarkers, ...connectorMarkers].map((item) => [item.text, item.kind]),
);

/**
 * Discourse markers that are safe to pull out of a group even when the writer
 * did not put a comma after them ("entonces ya estás…"). Ambiguous words that
 * also occur inside fixed expressions ("vale la pena", "claro que sí", "mira
 * la foto") are intentionally not listed here; they are only tagged when a
 * comma already separated them into their own group.
 */
const isolatableMarkers: readonly Marker[] = [
  "además",
  "así que",
  "ay",
  "buenas noches",
  "buenas tardes",
  "buenos días",
  "de todas formas",
  "en cambio",
  "en fin",
  "en realidad",
  "entonces",
  "es decir",
  "estupendo",
  "genial",
  "la verdad",
  "o sea",
  "ojalá",
  "perfecto",
  "por cierto",
  "por ejemplo",
  "por eso",
  "pues",
  "sin embargo",
  "uf",
  "uff",
  "venga",
].map((text) => marker(text, wholeMarkerKinds.get(text) ?? "connector"));

/** Connectors that separate two clauses; only split when both sides are real clauses. */
const clauseConnectors: readonly Readonly<{ text: string; words: readonly string[] }>[] = [
  "así que",
  "de modo que",
  "por eso",
  "ya que",
  "aunque",
  "mientras",
  "porque",
  "pero",
  "sino",
  "o",
].map((text) => ({ text, words: text.split(/\s+/u) }));

type WordSpan = Readonly<{ start: number; end: number; word: string }>;

function wordSpans(text: string): WordSpan[] {
  const spans: WordSpan[] = [];
  for (const match of text.matchAll(wordPattern)) {
    spans.push({ start: match.index, end: match.index + match[0].length, word: match[0].toLowerCase() });
  }
  return spans;
}

function hasContent(text: string): boolean {
  return /[a-z0-9áéíóúüñ]/iu.test(text);
}

function cleanFragment(raw: string): string {
  // Trim separators, quotes and emoji at the edges, but keep the Spanish
  // opening marks so "¿El día va tranquilo" still reads as a question.
  const cleaned = raw
    .trim()
    .replace(/^[^\p{L}\p{N}¿¡]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "")
    .trim();
  return hasContent(cleaned) ? cleaned : "";
}

function normalizeMarkerText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[¿¡.,;:!?…"'«»“”‘’()[\]{}—–]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function isAbbreviation(before: string): boolean {
  const match = /([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)$/u.exec(before);
  if (!match) return false;
  const word = match[1]!;
  const lower = word.toLowerCase();
  return abbreviations.has(lower) || (word.length === 1 && word === word.toUpperCase());
}

function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  let index = 0;
  while (index < text.length) {
    const character = text[index]!;
    if (character === "\n") {
      const sentence = text.slice(start, index).trim();
      if (sentence) sentences.push(sentence);
      start = index + 1;
      index += 1;
      continue;
    }
    if (!sentenceTerminators.has(character)) {
      index += 1;
      continue;
    }
    const decimal = character === "." && isDigit(text[index - 1]) && isDigit(text[index + 1]);
    const abbreviation = character === "." && isAbbreviation(text.slice(start, index));
    if (decimal || abbreviation) {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < text.length && (sentenceTerminators.has(text[end]!) || closingPunctuation.has(text[end]!))) {
      end += 1;
    }
    const sentence = text.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
    index = end;
  }
  const tail = text.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

function splitOnPunctuation(sentence: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  for (let index = 0; index < sentence.length; index += 1) {
    const character = sentence[index]!;
    if (character !== "," && character !== ";" && character !== ":") continue;
    // Keep Spanish decimal commas and clock times inside one group.
    if (isDigit(sentence[index - 1]) && isDigit(sentence[index + 1])) continue;
    const chunk = sentence.slice(start, index).trim();
    if (chunk) chunks.push(chunk);
    start = index + 1;
  }
  const tail = sentence.slice(start).trim();
  if (tail) chunks.push(tail);
  return chunks;
}

/**
 * Splits one comma-delimited chunk before a clause connector. Both sides must
 * contain at least two words, so "3 o 4 personas" or "¿Vienes o no?" stay whole.
 */
function findConnectorSplit(chunk: string): { index: number } | null {
  const spans = wordSpans(chunk);
  for (let start = 2; start < spans.length; start += 1) {
    for (const connector of clauseConnectors) {
      const end = start + connector.words.length;
      if (end > spans.length - 1) continue;
      let matches = true;
      for (let offset = 0; offset < connector.words.length; offset += 1) {
        if (spans[start + offset]!.word !== connector.words[offset]) {
          matches = false;
          break;
        }
        if (offset > 0) {
          const gap = chunk.slice(spans[start + offset - 1]!.end, spans[start + offset]!.start);
          if (!/^\s*$/u.test(gap)) {
            matches = false;
            break;
          }
        }
      }
      if (matches) return { index: spans[start]!.start };
    }
  }
  return null;
}

function splitAtConnectors(chunk: string): string[] {
  const pieces: string[] = [];
  let remaining = chunk;
  for (;;) {
    const split = findConnectorSplit(remaining);
    if (!split) {
      pieces.push(remaining);
      return pieces;
    }
    pieces.push(remaining.slice(0, split.index));
    remaining = remaining.slice(split.index).trim();
    if (!remaining) return pieces;
  }
}

function isIsolatableMarkerAtStart(piece: string, spans: readonly WordSpan[]): { wordCount: number; kind: SenseGroupKind } | null {
  for (const candidate of isolatableMarkers) {
    const wordCount = candidate.words.length;
    // At least two words must remain after the marker, otherwise the marker is
    // part of the group's meaning ("Pues sí", "Ojalá llueva").
    if (spans.length < wordCount + 2) continue;
    let matches = true;
    for (let offset = 0; offset < wordCount; offset += 1) {
      if (spans[offset]!.word !== candidate.words[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return { wordCount, kind: candidate.kind };
  }
  return null;
}

function pushGroup(groups: SenseGroup[], raw: string, kind: SenseGroupKind): void {
  const fragment = cleanFragment(raw);
  if (fragment) groups.push({ fragment, kind });
}

function addPieceGroups(piece: string, groups: SenseGroup[]): void {
  const wholeKind = wholeMarkerKinds.get(normalizeMarkerText(piece));
  if (wholeKind) {
    pushGroup(groups, piece, wholeKind);
    return;
  }
  const spans = wordSpans(piece);
  const isolatable = isIsolatableMarkerAtStart(piece, spans);
  if (isolatable) {
    const markerEnd = spans[isolatable.wordCount - 1]!.end;
    const rest = piece.slice(markerEnd).trim();
    pushGroup(groups, piece.slice(0, markerEnd), isolatable.kind);
    if (rest) addPieceGroups(rest, groups);
    return;
  }
  pushGroup(groups, piece, "clause");
}

function mergeToLimit(groups: readonly SenseGroup[]): SenseGroup[] {
  const merged = [...groups];
  while (merged.length > maxSenseGroups) {
    let bestIndex = 0;
    let bestLength = Number.POSITIVE_INFINITY;
    for (let index = 0; index < merged.length - 1; index += 1) {
      const length = merged[index]!.fragment.length + merged[index + 1]!.fragment.length;
      if (length < bestLength) {
        bestLength = length;
        bestIndex = index;
      }
    }
    const left = merged[bestIndex]!;
    const right = merged[bestIndex + 1]!;
    merged.splice(bestIndex, 2, {
      fragment: `${left.fragment} ${right.fragment}`,
      kind: left.kind === right.kind ? left.kind : "clause",
    });
  }
  return merged;
}

/**
 * Segments a Spanish sentence into sense groups deterministically.
 *
 * Boundaries: sentence punctuation, newlines, commas/semicolons/colons,
 * a closed list of clause connectors and isolated discourse markers. Output is
 * capped at twelve groups by merging the shortest neighbouring pair, so it
 * always fits the public structure DTO.
 */
export function segmentSpanishSenseGroups(text: string): readonly SenseGroup[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const groups: SenseGroup[] = [];
  for (const sentence of splitSentences(text)) {
    for (const chunk of splitOnPunctuation(sentence)) {
      for (const piece of splitAtConnectors(chunk)) {
        addPieceGroups(piece, groups);
      }
    }
  }
  return mergeToLimit(groups);
}
