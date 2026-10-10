/**
 * Owner-authorized AI content-review identity.
 *
 * The platform that performs the owner-authorized review changed from Codex to
 * DSH on 2026-10-10. Review records are append-only audit evidence, so the
 * historical `codex-*` references stay exactly as written and are never
 * rewritten; new records use the DSH reference. Publication gates read both.
 */

/** Historical owner-authorized AI review reference written by the previous agent platform. */
export const LEGACY_OWNER_AUTHORIZED_REVIEWER_REFERENCE = "codex-ai-owner-authorized-review" as const;

/** Current owner-authorized AI review reference. */
export const OWNER_AUTHORIZED_REVIEWER_REFERENCE = "dsh-ai-owner-authorized-review" as const;

/** Historical temporary review reference, kept only so old records stay readable. */
export const LEGACY_TEMPORARY_AI_REVIEWER_REFERENCE = "codex-ai-temporary-review" as const;

/** `dsh-ai-owner-authorized-review` plus up to two `:actor[:runId]` provenance segments. */
const OWNER_AUTHORIZED_REVIEWER_REFERENCE_PATTERN = /^dsh-ai-owner-authorized-review(?::[A-Za-z0-9._-]{1,64}){0,2}$/u;

function provenanceSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const safe = trimmed.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return safe.slice(0, 64);
}

/**
 * The reference written by a new review attempt. Callers may pass a structured
 * actor such as `article-auto-publication:readlang-links-v5`; each colon
 * separated provenance segment is sanitized so the stored reference stays a
 * stable, greppable identifier.
 */
export function ownerAuthorizedReviewerReference(provenance: Readonly<{ actor?: string; runId?: string }> = {}): string {
  const segments = [provenance.actor, provenance.runId]
    .flatMap((value) => (value ?? "").split(":"))
    .flatMap((value) => {
      const segment = provenanceSegment(value);
      return segment ? [segment] : [];
    });
  return segments.length === 0
    ? OWNER_AUTHORIZED_REVIEWER_REFERENCE
    : `${OWNER_AUTHORIZED_REVIEWER_REFERENCE}:${segments.join(":")}`;
}

/** Whether a stored reference satisfies the owner-authorized AI review gate. */
export function isOwnerAuthorizedReviewerReference(value: string | null | undefined): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  return value === LEGACY_OWNER_AUTHORIZED_REVIEWER_REFERENCE || OWNER_AUTHORIZED_REVIEWER_REFERENCE_PATTERN.test(value);
}
