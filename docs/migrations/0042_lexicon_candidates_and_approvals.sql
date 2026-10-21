CREATE TABLE "lexicon_candidate_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"mode" text NOT NULL,
	"batch_id" text,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"document_kind" text NOT NULL,
	"document_stable_key" text NOT NULL,
	"document_version" integer NOT NULL,
	"segment_index" integer NOT NULL,
	"reviews" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lexeme_count" integer DEFAULT 0 NOT NULL,
	"phrase_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lexicon_candidate_approvals_mode_check" CHECK ("lexicon_candidate_approvals"."mode" in ('single', 'batch')),
	CONSTRAINT "lexicon_candidate_approvals_revision_positive_check" CHECK ("lexicon_candidate_approvals"."revision" > 0),
	CONSTRAINT "lexicon_candidate_approvals_document_kind_check" CHECK ("lexicon_candidate_approvals"."document_kind" in ('article', 'media')),
	CONSTRAINT "lexicon_candidate_approvals_batch_id_check" CHECK (("lexicon_candidate_approvals"."mode" = 'batch' and "lexicon_candidate_approvals"."batch_id" is not null) or ("lexicon_candidate_approvals"."mode" = 'single' and "lexicon_candidate_approvals"."batch_id" is null)),
	CONSTRAINT "lexicon_candidate_approvals_counts_check" CHECK ("lexicon_candidate_approvals"."lexeme_count" >= 0 and "lexicon_candidate_approvals"."phrase_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lexicon_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_kind" text NOT NULL,
	"document_kind" text NOT NULL,
	"document_stable_key" text NOT NULL,
	"document_version" integer NOT NULL,
	"segment_index" integer NOT NULL,
	"source_text" text NOT NULL,
	"normalized_text" text NOT NULL,
	"lemma" text,
	"part_of_speech" text,
	"meaning_zh" text,
	"context_before" text DEFAULT '' NOT NULL,
	"context_after" text DEFAULT '' NOT NULL,
	"source_title" text NOT NULL,
	"source_kind" text NOT NULL,
	"provider" text NOT NULL,
	"model_version" text,
	"confidence" integer,
	"status" text DEFAULT 'discovered' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"reviews" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"rejected_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lexicon_candidates_kind_check" CHECK ("lexicon_candidates"."candidate_kind" in ('lexeme', 'phrase')),
	CONSTRAINT "lexicon_candidates_status_check" CHECK ("lexicon_candidates"."status" in ('discovered', 'review_submitted', 'review_ready', 'approved', 'rejected')),
	CONSTRAINT "lexicon_candidates_document_kind_check" CHECK ("lexicon_candidates"."document_kind" in ('article', 'media')),
	CONSTRAINT "lexicon_candidates_version_positive_check" CHECK ("lexicon_candidates"."document_version" > 0),
	CONSTRAINT "lexicon_candidates_segment_index_check" CHECK ("lexicon_candidates"."segment_index" >= 0),
	CONSTRAINT "lexicon_candidates_revision_positive_check" CHECK ("lexicon_candidates"."revision" > 0),
	CONSTRAINT "lexicon_candidates_confidence_check" CHECK ("lexicon_candidates"."confidence" is null or "lexicon_candidates"."confidence" between 0 and 100),
	CONSTRAINT "lexicon_candidates_approved_audit_check" CHECK ("lexicon_candidates"."status" <> 'approved' or ("lexicon_candidates"."approved_by" is not null and "lexicon_candidates"."approved_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "lexicon_candidate_approvals" ADD CONSTRAINT "lexicon_candidate_approvals_candidate_id_lexicon_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."lexicon_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lexicon_candidate_approvals_candidate_revision_uidx" ON "lexicon_candidate_approvals" USING btree ("candidate_id","revision");--> statement-breakpoint
CREATE INDEX "lexicon_candidate_approvals_batch_idx" ON "lexicon_candidate_approvals" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "lexicon_candidate_approvals_approved_at_idx" ON "lexicon_candidate_approvals" USING btree ("approved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lexicon_candidates_identity_uidx" ON "lexicon_candidates" USING btree ("candidate_kind","document_kind","document_stable_key","document_version","segment_index","normalized_text");--> statement-breakpoint
CREATE INDEX "lexicon_candidates_status_idx" ON "lexicon_candidates" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "lexicon_candidates_document_idx" ON "lexicon_candidates" USING btree ("document_kind","document_stable_key","document_version");