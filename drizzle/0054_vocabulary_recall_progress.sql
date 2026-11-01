CREATE TABLE "user_vocabulary_recall_progress" (
	"user_id" uuid NOT NULL,
	"word" text NOT NULL,
	"mode" text NOT NULL,
	"stage" text NOT NULL,
	"revision" integer NOT NULL,
	"successful_reviews" integer NOT NULL,
	"next_review_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_vocabulary_recall_progress_user_id_word_mode_pk" PRIMARY KEY("user_id","word","mode"),
	CONSTRAINT "vocabulary_recall_word_check" CHECK (length("user_vocabulary_recall_progress"."word") between 1 and 120 and "user_vocabulary_recall_progress"."word" = btrim("user_vocabulary_recall_progress"."word")),
	CONSTRAINT "vocabulary_recall_mode_check" CHECK ("user_vocabulary_recall_progress"."mode" in ('word', 'meaning')),
	CONSTRAINT "vocabulary_recall_revision_check" CHECK ("user_vocabulary_recall_progress"."revision" >= 1),
	CONSTRAINT "vocabulary_recall_stage_check" CHECK (("user_vocabulary_recall_progress"."stage" = 'learning' and "user_vocabulary_recall_progress"."successful_reviews" = 0 and "user_vocabulary_recall_progress"."next_review_at" is null) or ("user_vocabulary_recall_progress"."stage" = 'review' and "user_vocabulary_recall_progress"."successful_reviews" between 1 and 5 and "user_vocabulary_recall_progress"."next_review_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "user_vocabulary_recall_receipts" (
	"user_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_vocabulary_recall_receipts_user_id_attempt_id_pk" PRIMARY KEY("user_id","attempt_id")
);
--> statement-breakpoint
CREATE TABLE "user_vocabulary_recall_sync" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"epoch" uuid DEFAULT gen_random_uuid() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_vocabulary_recall_progress" ADD CONSTRAINT "user_vocabulary_recall_progress_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_vocabulary_recall_receipts" ADD CONSTRAINT "user_vocabulary_recall_receipts_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_vocabulary_recall_sync" ADD CONSTRAINT "vocabulary_recall_sync_auth_user_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE user_vocabulary_recall_progress ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_vocabulary_recall_receipts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE user_vocabulary_recall_sync ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON user_vocabulary_recall_progress, user_vocabulary_recall_receipts, user_vocabulary_recall_sync TO authenticated;
--> statement-breakpoint
CREATE POLICY vocabulary_recall_progress_owner_read ON user_vocabulary_recall_progress FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
--> statement-breakpoint
CREATE POLICY vocabulary_recall_receipts_owner_read ON user_vocabulary_recall_receipts FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
--> statement-breakpoint
CREATE POLICY vocabulary_recall_sync_owner_read ON user_vocabulary_recall_sync FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
