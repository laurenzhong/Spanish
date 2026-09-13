export type CandidateIdentity = Readonly<{
  candidateId?: string;
  sourceId: string;
  externalItemId: string;
  normalizedUrl: string;
  contentHash: string | null;
}>;

export type CandidateIdentityResolution =
  | Readonly<{ kind: "new" }>
  | Readonly<{ kind: "duplicate"; candidateId: string | undefined; matchedBy: "source-item" | "url" | "hash" }>
  | Readonly<{ kind: "conflict"; candidateId: string | undefined; matchedBy: "source-item" | "url" }>;

const ignoredQueryParameters = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
]);

export function normalizeCandidateUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("Candidate URL must use HTTP or HTTPS.");
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || ignoredQueryParameters.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/u, "");
  }
  return url.toString().replace(/\?$/u, "").replace(/\/$/u, url.pathname === "/" ? "/" : "");
}

function hashesConflict(left: string | null, right: string | null): boolean {
  return left !== null && right !== null && left !== right;
}

export function resolveCandidateIdentity(
  existing: readonly CandidateIdentity[],
  incoming: CandidateIdentity,
): CandidateIdentityResolution {
  for (const candidate of existing) {
    if (
      candidate.sourceId === incoming.sourceId &&
      candidate.externalItemId === incoming.externalItemId
    ) {
      return hashesConflict(candidate.contentHash, incoming.contentHash)
        ? { kind: "conflict", candidateId: candidate.candidateId, matchedBy: "source-item" }
        : { kind: "duplicate", candidateId: candidate.candidateId, matchedBy: "source-item" };
    }
  }
  for (const candidate of existing) {
    if (candidate.normalizedUrl === incoming.normalizedUrl) {
      return hashesConflict(candidate.contentHash, incoming.contentHash)
        ? { kind: "conflict", candidateId: candidate.candidateId, matchedBy: "url" }
        : { kind: "duplicate", candidateId: candidate.candidateId, matchedBy: "url" };
    }
  }
  if (incoming.contentHash !== null) {
    const matched = existing.find((candidate) => candidate.contentHash === incoming.contentHash);
    if (matched) {
      return { kind: "duplicate", candidateId: matched.candidateId, matchedBy: "hash" };
    }
  }
  return { kind: "new" };
}
