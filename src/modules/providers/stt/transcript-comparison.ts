export type TranscriptDifferenceKind = "substitution" | "omission" | "addition";

export type TranscriptDifferenceClassification =
  | "token-mismatch"
  | "possible-language-mismatch";

export type TranscriptDifference = Readonly<{
  kind: TranscriptDifferenceKind;
  classification: TranscriptDifferenceClassification;
  expectedText: string;
  actualText: string;
  expectedTokenStart: number;
  expectedTokenCount: number;
  actualTokenStart: number;
  actualTokenCount: number;
}>;

export type TranscriptComparison = Readonly<{
  expectedTokenCount: number;
  actualTokenCount: number;
  matchedTokenCount: number;
  matchRatio: number;
  summary: Readonly<{
    substitutionCount: number;
    omissionCount: number;
    additionCount: number;
    possibleLanguageMismatchCount: number;
  }>;
  differences: readonly TranscriptDifference[];
}>;

type AlignmentOperation = Readonly<{
  kind: "match" | TranscriptDifferenceKind;
  expectedIndex: number;
  actualIndex: number;
}>;

const commonEnglishWords = new Set([
  "and", "are", "be", "because", "but", "can", "data", "family", "for",
  "future", "health", "however", "important", "incomes", "is", "life",
  "more", "not", "of", "only", "our", "people", "robots", "that", "than",
  "this", "to", "will", "with", "work", "your",
]);

const tokenPattern = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;

export function compareTranscripts(
  expectedText: string,
  actualText: string,
): TranscriptComparison {
  const expectedTokens = tokenize(expectedText);
  const actualTokens = tokenize(actualText);
  const operations = alignTokens(expectedTokens, actualTokens);
  const differences: TranscriptDifference[] = [];
  let matchedTokenCount = 0;

  for (let index = 0; index < operations.length; ) {
    const operation = operations[index]!;
    if (operation.kind === "match") {
      matchedTokenCount += 1;
      index += 1;
      continue;
    }

    const group: AlignmentOperation[] = [];
    while (index < operations.length && operations[index]!.kind !== "match") {
      group.push(operations[index]!);
      index += 1;
    }
    differences.push(createDifference(group, expectedTokens, actualTokens));
  }

  const summary = {
    substitutionCount: differences.filter((difference) => difference.kind === "substitution").length,
    omissionCount: differences.filter((difference) => difference.kind === "omission").length,
    additionCount: differences.filter((difference) => difference.kind === "addition").length,
    possibleLanguageMismatchCount: differences.filter(
      (difference) => difference.classification === "possible-language-mismatch",
    ).length,
  };

  return {
    expectedTokenCount: expectedTokens.length,
    actualTokenCount: actualTokens.length,
    matchedTokenCount,
    matchRatio: roundRatio(matchedTokenCount, expectedTokens.length),
    summary,
    differences,
  };
}

function tokenize(text: string): string[] {
  return text.normalize("NFKC").match(tokenPattern) ?? [];
}

function normalizedToken(token: string): string {
  return token
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es-ES");
}

function alignTokens(expectedTokens: string[], actualTokens: string[]): AlignmentOperation[] {
  const rows = expectedTokens.length + 1;
  const columns = actualTokens.length + 1;
  const costs = Array.from({ length: rows }, () => new Array<number>(columns).fill(0));

  for (let row = 1; row < rows; row += 1) costs[row]![0] = row;
  for (let column = 1; column < columns; column += 1) costs[0]![column] = column;

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const same = normalizedToken(expectedTokens[row - 1]!) === normalizedToken(actualTokens[column - 1]!);
      const substitution = costs[row - 1]![column - 1]! + (same ? 0 : 1);
      const omission = costs[row - 1]![column]! + 1;
      const addition = costs[row]![column - 1]! + 1;
      costs[row]![column] = Math.min(substitution, omission, addition);
    }
  }

  const operations: AlignmentOperation[] = [];
  let row = expectedTokens.length;
  let column = actualTokens.length;
  while (row > 0 || column > 0) {
    if (
      row > 0 &&
      column > 0 &&
      normalizedToken(expectedTokens[row - 1]!) === normalizedToken(actualTokens[column - 1]!) &&
      costs[row]![column] === costs[row - 1]![column - 1]!
    ) {
      operations.push({ kind: "match", expectedIndex: row - 1, actualIndex: column - 1 });
      row -= 1;
      column -= 1;
      continue;
    }

    if (row > 0 && costs[row]![column] === costs[row - 1]![column]! + 1) {
      operations.push({ kind: "omission", expectedIndex: row - 1, actualIndex: column });
      row -= 1;
      continue;
    }

    if (column > 0 && costs[row]![column] === costs[row]![column - 1]! + 1) {
      operations.push({ kind: "addition", expectedIndex: row, actualIndex: column - 1 });
      column -= 1;
      continue;
    }

    operations.push({ kind: "substitution", expectedIndex: row - 1, actualIndex: column - 1 });
    row -= 1;
    column -= 1;
  }

  return operations.reverse();
}

function createDifference(
  operations: AlignmentOperation[],
  expectedTokens: string[],
  actualTokens: string[],
): TranscriptDifference {
  const substitutions = operations.filter((operation) => operation.kind === "substitution");
  const omissions = operations.filter((operation) => operation.kind === "omission");
  const kind = substitutions.length > 0
    ? "substitution"
    : omissions.length > 0
      ? "omission"
      : "addition";
  const expectedIndexes = operations
    .filter((operation) => operation.kind !== "addition")
    .map((operation) => operation.expectedIndex);
  const actualIndexes = operations
    .filter((operation) => operation.kind !== "omission")
    .map((operation) => operation.actualIndex);
  const expectedTokenStart = expectedIndexes.length > 0 ? Math.min(...expectedIndexes) : operations[0]!.expectedIndex;
  const actualTokenStart = actualIndexes.length > 0 ? Math.min(...actualIndexes) : operations[0]!.actualIndex;
  const expected = expectedIndexes.map((index) => expectedTokens[index]!);
  const actual = actualIndexes.map((index) => actualTokens[index]!);
  const classification = actual.some((token) => commonEnglishWords.has(normalizedToken(token)))
    ? "possible-language-mismatch"
    : "token-mismatch";

  return {
    kind,
    classification,
    expectedText: expected.join(" "),
    actualText: actual.join(" "),
    expectedTokenStart,
    expectedTokenCount: expected.length,
    actualTokenStart,
    actualTokenCount: actual.length,
  };
}

function roundRatio(value: number, total: number): number {
  if (total === 0) return 1;
  return Math.round((value / total) * 1000) / 1000;
}
