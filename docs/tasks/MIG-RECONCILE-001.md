# MIG-RECONCILE-001: Content Pipeline Migration Reconciliation

Status: blocked on canonical migration selection

## Scope

Reconcile the `drizzle` journal used by the release branch with the migration
history already recorded by the configured content database. This is required
before applying the Readlang source migration or any new schema migration.

## Evidence

- The release branch journal ends with `0029_safe_switch`; its source adapter
  check allows `readlang-links` but not `language-reactor`.
- The target database has 37 recorded migrations from the OPS-002 lineage. Its
  current adapter check allows `language-reactor` but not `readlang-links`.
- The target database does not contain the release branch's lexicon tables,
  confirming that the histories are not merely different filenames for an
  equivalent schema.
- Running the release journal against that database would attempt migrations
  whose historical assumptions are false. It must not be used to alter the
  target database or to insert synthetic migration records.

## Current Containment

- `media-daily` now recognizes an existing verified `language-reactor` media
  source and can only progress it through `disabled`, `discover-only`, or
  `review-only`. It cannot auto-publish media.
- The compatibility adapter performs bounded API and audio metadata requests
  against the registered policy allowlists. It does not extend those allowlists
  from API responses.
- Readlang registration remains blocked. The registered policy still keeps
  automated article publication disabled, so a future registration is limited
  to review-only until the separately required 7-day observation completes.

## Required Decision And Work

1. Select the OPS-002 journal as the target database baseline, because it is
   the only journal with hashes recorded by that database.
2. Build a forward-only reconciliation migration set from that baseline that
   includes the current lexicon schema and an adapter check allowing both
   `language-reactor` and `readlang-links`.
3. Validate the resulting schema with an empty database and a disposable copy
   of the target schema. Do not hand-edit the target database.
4. Require a migration review before applying the reconciled journal to the
   configured target database. Only after that succeeds may
   `pnpm content:register-readlang-links` run.
5. Configure the protected GitHub `content-production` Environment with its
   database secret and staged article variables. The current workflow evidence
   shows these are not available to the runner.
6. Run one real Readlang `review-only` candidate with MiniMax, then complete
   the ADR-0010 seven-day observation before any article auto-publication.
7. Run Language Reactor media in `review-only`, complete the required three
   reviews, and use the existing explicit publishers. The published records
   will use `MediaCardView`; no separate daily-media UI is permitted.

## Non-Goals

- No direct production SQL workaround.
- No insertion or deletion in `drizzle.__drizzle_migrations`.
- No Readlang collection, MiniMax call, media download, or publication before
  the reconciled schema and protected runner configuration are verified.
