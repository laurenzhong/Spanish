CREATE TABLE "user_vocabulary_marks" (
	"user_id" uuid NOT NULL,
	"word" text NOT NULL,
	"status" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_vocabulary_marks_user_id_word_pk" PRIMARY KEY("user_id","word"),
	CONSTRAINT "user_vocabulary_marks_word_check" CHECK (length("user_vocabulary_marks"."word") between 1 and 120 and "user_vocabulary_marks"."word" = btrim("user_vocabulary_marks"."word")),
	CONSTRAINT "user_vocabulary_marks_status_check" CHECK ("user_vocabulary_marks"."status" is null or "user_vocabulary_marks"."status" in ('familiar', 'learning', 'revisit', 'ignore'))
);

--> statement-breakpoint

ALTER TABLE "user_vocabulary_marks" ADD CONSTRAINT "user_vocabulary_marks_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE user_vocabulary_marks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON user_vocabulary_marks TO authenticated;
--> statement-breakpoint
CREATE POLICY user_vocabulary_marks_owner ON user_vocabulary_marks FOR ALL TO authenticated USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));
