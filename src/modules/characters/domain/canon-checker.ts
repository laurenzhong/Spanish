import {
  characterBibleSchema,
  type CharacterBible,
  type CharacterCanonFact,
} from "../schemas";

export const characterCanonIssueCodes = [
  "character-bible-invalid",
  "duplicate-fact-key",
  "duplicate-fact-version",
  "fact-version-ahead",
  "sensitive-reveal-expansion",
  "stable-key-mismatch",
  "initial-version-must-be-one",
  "version-not-incremented",
  "change-reason-required",
  "identity-change-requires-version",
  "revealed-fact-conflict",
  "draft-not-publishable",
  "review-required",
] as const;

export type CharacterCanonIssueCode = (typeof characterCanonIssueCodes)[number];

export type CharacterCanonIssue = Readonly<{
  code: CharacterCanonIssueCode;
  path: readonly (string | number)[];
  message: string;
}>;

export type CharacterCanonResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; issues: readonly CharacterCanonIssue[] }>;

export type CharacterRevisionContext = Readonly<{
  allowDraftEdit?: boolean;
  revealedFactKeys?: readonly string[];
  approvedReview?: boolean;
}>;

export class CharacterCanonValidationError extends Error {
  readonly issues: readonly CharacterCanonIssue[];

  constructor(issues: readonly CharacterCanonIssue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "CharacterCanonValidationError";
    this.issues = issues;
  }
}

const coreIdentityPaths = [
  "displayName",
  "homeLocation",
  "identity.age",
  "identity.growthLocation",
  "identity.education",
  "identity.occupation",
] as const;

const revealModeRank: Record<CharacterCanonFact["reveal"]["mode"], number> = {
  never: 0,
  contextual: 1,
  gradual: 2,
  direct: 3,
};

function issue(
  code: CharacterCanonIssueCode,
  path: readonly (string | number)[],
  message: string,
): CharacterCanonIssue {
  return { code, path, message };
}

function semanticIssues(character: CharacterBible): CharacterCanonIssue[] {
  const issues: CharacterCanonIssue[] = [];
  const seenKeys = new Map<string, number>();
  const seenVersions = new Set<string>();

  character.facts.forEach((fact, index) => {
    const versionedKey = `${fact.factKey}@${fact.version}`;
    if (seenVersions.has(versionedKey)) {
      issues.push(
        issue(
          "duplicate-fact-version",
          ["facts", index, "factKey"],
          `Fact ${versionedKey} is duplicated.`,
        ),
      );
    }
    seenVersions.add(versionedKey);

    if (fact.isActive && seenKeys.has(fact.factKey)) {
      issues.push(
        issue(
          "duplicate-fact-key",
          ["facts", index, "factKey"],
          `Only one active fact may use ${fact.factKey}.`,
        ),
      );
    }
    if (fact.isActive) seenKeys.set(fact.factKey, index);

    if (fact.version > character.version) {
      issues.push(
        issue(
          "fact-version-ahead",
          ["facts", index, "version"],
          `Fact ${fact.factKey} cannot be newer than character version ${character.version}.`,
        ),
      );
    }

    if (
      fact.sensitivity !== "normal" &&
      (fact.reveal.mode === "direct" || fact.reveal.audience === "any-user")
    ) {
      issues.push(
        issue(
          "sensitive-reveal-expansion",
          ["facts", index, "reveal"],
          `Sensitive fact ${fact.factKey} cannot be directly available to every user.`,
        ),
      );
    }
  });

  const changeVersions = new Set<number>();
  character.changeLog.forEach((entry, index) => {
    if (changeVersions.has(entry.version)) {
      issues.push(
        issue(
          "duplicate-fact-version",
          ["changeLog", index, "version"],
          `Change log version ${entry.version} is duplicated.`,
        ),
      );
    }
    changeVersions.add(entry.version);
  });

  return issues;
}

function schemaIssues(input: unknown): CharacterCanonIssue[] {
  const parsed = characterBibleSchema.safeParse(input);
  if (parsed.success) return semanticIssues(parsed.data);
  return parsed.error.issues.map((entry) =>
    issue(
      "character-bible-invalid",
      entry.path.filter((part): part is string | number => typeof part === "string" || typeof part === "number"),
      entry.message,
    ),
  );
}

export function validateCharacterBible(input: unknown): CharacterBible {
  const parsed = characterBibleSchema.safeParse(input);
  if (!parsed.success) {
    throw new CharacterCanonValidationError(schemaIssues(input));
  }
  const issues = semanticIssues(parsed.data);
  if (issues.length > 0) throw new CharacterCanonValidationError(issues);
  return parsed.data;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function contentFingerprint(character: CharacterBible): string {
  const content = JSON.parse(JSON.stringify(character)) as Record<string, unknown>;
  delete content.status;
  delete content.changeLog;
  return stableSerialize(content);
}

function valueAtPath(character: CharacterBible, path: string): unknown {
  if (path === "displayName") return character.displayName;
  if (path === "homeLocation") return character.homeLocation;
  if (path === "identity.age") return character.identity.age;
  if (path === "identity.growthLocation") return character.identity.growthLocation;
  if (path === "identity.education") return character.identity.education;
  if (path === "identity.occupation") return character.identity.occupation;
  return undefined;
}

function changedCoreIdentityPaths(
  current: CharacterBible,
  candidate: CharacterBible,
): readonly string[] {
  return coreIdentityPaths.filter(
    (path) => stableSerialize(valueAtPath(current, path)) !== stableSerialize(valueAtPath(candidate, path)),
  );
}

function activeFactMap(character: CharacterBible): Map<string, CharacterCanonFact> {
  return new Map(character.facts.filter((fact) => fact.isActive).map((fact) => [fact.factKey, fact]));
}

function factChanged(current: CharacterCanonFact | undefined, candidate: CharacterCanonFact | undefined): boolean {
  return stableSerialize(current) !== stableSerialize(candidate);
}

function revisionIssues(
  current: CharacterBible,
  candidate: CharacterBible,
  context: CharacterRevisionContext,
): CharacterCanonIssue[] {
  const issues: CharacterCanonIssue[] = [];
  const revealed = new Set(context.revealedFactKeys ?? []);
  const identityChanges = changedCoreIdentityPaths(current, candidate);
  const contentChanged = contentFingerprint(current) !== contentFingerprint(candidate);

  if (current.stableKey !== candidate.stableKey) {
    issues.push(issue("stable-key-mismatch", ["stableKey"], "Character stableKey cannot change between revisions."));
  }
  if (candidate.version < current.version) {
    issues.push(issue("version-not-incremented", ["version"], "Character version must not move backwards."));
  }

  if (candidate.version === current.version && contentChanged) {
    if (current.status === "draft" && context.allowDraftEdit && revealed.size === 0) {
      return issues;
    }
    issues.push(issue("version-not-incremented", ["version"], "Semantic character changes require a new version."));
    if (identityChanges.length > 0) {
      issues.push(issue("identity-change-requires-version", ["identity"], "Core identity changes require a new character version."));
    }
  }

  if (candidate.version > current.version) {
    const change = candidate.changeLog.find(
      (entry) => entry.version === candidate.version && entry.supersedesVersion === current.version,
    );
    if (!change) {
      issues.push(issue("change-reason-required", ["changeLog"], "A revision must record why it supersedes the current version."));
    }
  }

  identityChanges.forEach((path) => {
    if (revealed.has(path)) {
      issues.push(issue("revealed-fact-conflict", [path], `Revising revealed identity fact ${path} requires explicit conflict handling.`));
    }
  });

  const currentFacts = activeFactMap(current);
  const candidateFacts = activeFactMap(candidate);
  new Set([...currentFacts.keys(), ...candidateFacts.keys()]).forEach((factKey) => {
    const previous = currentFacts.get(factKey);
    const next = candidateFacts.get(factKey);
    if (revealed.has(factKey) && factChanged(previous, next)) {
      issues.push(issue("revealed-fact-conflict", ["facts", factKey], `Revising revealed fact ${factKey} requires explicit conflict handling.`));
    }
    if (
      previous &&
      next &&
      next.sensitivity !== "normal" &&
      revealModeRank[next.reveal.mode] > revealModeRank[previous.reveal.mode]
    ) {
      issues.push(issue("sensitive-reveal-expansion", ["facts", factKey, "reveal"], `Sensitive fact ${factKey} cannot broaden its reveal mode silently.`));
    }
  });

  return issues;
}

export function checkCharacterRevision(
  current: CharacterBible,
  candidate: CharacterBible,
  context: CharacterRevisionContext = {},
): CharacterCanonResult {
  const candidateIssues = semanticIssues(candidate);
  const issues = [...candidateIssues, ...revisionIssues(current, candidate, context)];
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

export function canPublishCharacterRevision(
  current: CharacterBible | null,
  candidate: CharacterBible,
  context: CharacterRevisionContext = {},
): CharacterCanonResult {
  const issues = semanticIssues(candidate);
  if (candidate.status !== "published") {
    issues.push(issue("draft-not-publishable", ["status"], "Only a published candidate can pass the production publish gate."));
  }
  if (!context.approvedReview) {
    issues.push(issue("review-required", ["status"], "Character publication requires an approved language, pedagogy, and canon review."));
  }
  if (current) {
    issues.push(...revisionIssues(current, candidate, context));
  } else if (candidate.version !== 1) {
    issues.push(issue("initial-version-must-be-one", ["version"], "The first character version must be 1."));
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
