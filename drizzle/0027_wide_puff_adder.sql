CREATE TABLE "corpus_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lexeme_id" uuid,
	"phrase_entry_id" uuid,
	"document_kind" text NOT NULL,
	"document_stable_key" text NOT NULL,
	"document_version" integer NOT NULL,
	"source_position" jsonb NOT NULL,
	"surface_text" text NOT NULL,
	"normalized_text" text NOT NULL,
	"context_before" text DEFAULT '' NOT NULL,
	"context_after" text DEFAULT '' NOT NULL,
	"source_title" text NOT NULL,
	"source_kind" text NOT NULL,
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "corpus_occurrences_one_entry_check" CHECK ((("corpus_occurrences"."lexeme_id" is not null)::int + ("corpus_occurrences"."phrase_entry_id" is not null)::int) = 1),
	CONSTRAINT "corpus_occurrences_version_positive_check" CHECK ("corpus_occurrences"."document_version" > 0),
	CONSTRAINT "corpus_occurrences_document_kind_check" CHECK ("corpus_occurrences"."document_kind" in ('article', 'media'))
);
--> statement-breakpoint
CREATE TABLE "lexeme_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lexeme_id" uuid NOT NULL,
	"surface" text NOT NULL,
	"normalized_surface" text NOT NULL,
	"form_kind" text DEFAULT 'observed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lexemes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lemma" text NOT NULL,
	"normalized_lemma" text NOT NULL,
	"language" text DEFAULT 'es' NOT NULL,
	"part_of_speech" text,
	"lemma_status" text DEFAULT 'pending' NOT NULL,
	"meaning_zh" text,
	"cefr" text,
	"region" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lexemes_language_check" CHECK ("lexemes"."language" = 'es'),
	CONSTRAINT "lexemes_status_check" CHECK ("lexemes"."lemma_status" in ('verified', 'pending'))
);
--> statement-breakpoint
CREATE TABLE "phrase_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expression" text NOT NULL,
	"normalized_expression" text NOT NULL,
	"meaning_zh" text,
	"pragmatic_purpose" text,
	"register" text,
	"region" text,
	"cefr" text,
	"owner_user_id" uuid,
	"review_status" "review_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phrase_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phrase_entry_id" uuid NOT NULL,
	"expression" text NOT NULL,
	"normalized_expression" text NOT NULL,
	"slot_pattern" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_lexical_intents" (
	"user_id" uuid NOT NULL,
	"entry_kind" text NOT NULL,
	"entry_id" uuid NOT NULL,
	"intent" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_lexical_intents_kind_check" CHECK ("user_lexical_intents"."entry_kind" in ('lexeme', 'phrase')),
	CONSTRAINT "user_lexical_intents_value_check" CHECK ("user_lexical_intents"."intent" in ('familiar', 'revisit', 'ignore')),
	CONSTRAINT "user_lexical_intents_revision_check" CHECK ("user_lexical_intents"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "corpus_occurrences" ADD CONSTRAINT "corpus_occurrences_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus_occurrences" ADD CONSTRAINT "corpus_occurrences_phrase_entry_id_phrase_entries_id_fk" FOREIGN KEY ("phrase_entry_id") REFERENCES "public"."phrase_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corpus_occurrences" ADD CONSTRAINT "corpus_occurrences_owner_user_id_profiles_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lexeme_forms" ADD CONSTRAINT "lexeme_forms_lexeme_id_lexemes_id_fk" FOREIGN KEY ("lexeme_id") REFERENCES "public"."lexemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phrase_entries" ADD CONSTRAINT "phrase_entries_owner_user_id_profiles_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phrase_variants" ADD CONSTRAINT "phrase_variants_phrase_entry_id_phrase_entries_id_fk" FOREIGN KEY ("phrase_entry_id") REFERENCES "public"."phrase_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lexical_intents" ADD CONSTRAINT "user_lexical_intents_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "corpus_occurrences_lexeme_document_position_uidx" ON "corpus_occurrences" USING btree ("lexeme_id","document_kind","document_stable_key","document_version","normalized_text","source_position");--> statement-breakpoint
CREATE INDEX "corpus_occurrences_lexeme_idx" ON "corpus_occurrences" USING btree ("lexeme_id","document_kind","document_stable_key");--> statement-breakpoint
CREATE INDEX "corpus_occurrences_phrase_idx" ON "corpus_occurrences" USING btree ("phrase_entry_id","document_kind","document_stable_key");--> statement-breakpoint
CREATE UNIQUE INDEX "lexeme_forms_lexeme_surface_uidx" ON "lexeme_forms" USING btree ("lexeme_id","normalized_surface");--> statement-breakpoint
CREATE INDEX "lexeme_forms_normalized_surface_idx" ON "lexeme_forms" USING btree ("normalized_surface");--> statement-breakpoint
CREATE UNIQUE INDEX "lexemes_language_normalized_pos_uidx" ON "lexemes" USING btree ("language","normalized_lemma","part_of_speech");--> statement-breakpoint
CREATE INDEX "lexemes_normalized_lemma_idx" ON "lexemes" USING btree ("normalized_lemma");--> statement-breakpoint
CREATE UNIQUE INDEX "phrase_entries_public_expression_uidx" ON "phrase_entries" USING btree ("normalized_expression") WHERE "phrase_entries"."owner_user_id" is null;--> statement-breakpoint
CREATE INDEX "phrase_entries_owner_status_idx" ON "phrase_entries" USING btree ("owner_user_id","review_status");--> statement-breakpoint
CREATE UNIQUE INDEX "phrase_variants_entry_expression_uidx" ON "phrase_variants" USING btree ("phrase_entry_id","normalized_expression");--> statement-breakpoint
CREATE UNIQUE INDEX "user_lexical_intents_user_entry_uidx" ON "user_lexical_intents" USING btree ("user_id","entry_kind","entry_id");--> statement-breakpoint
CREATE INDEX "user_lexical_intents_user_intent_idx" ON "user_lexical_intents" USING btree ("user_id","intent");
--> statement-breakpoint
ALTER TABLE public.lexemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lexeme_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phrase_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phrase_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corpus_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_lexical_intents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lexemes, public.lexeme_forms, public.phrase_entries, public.phrase_variants, public.corpus_occurrences, public.user_lexical_intents FROM anon, authenticated;
--> statement-breakpoint
CREATE POLICY lexemes_public_read ON public.lexemes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY lexeme_forms_public_read ON public.lexeme_forms FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY phrase_entries_public_or_own_read ON public.phrase_entries FOR SELECT TO anon, authenticated
  USING ((owner_user_id is null and review_status = 'approved') or owner_user_id = (SELECT auth.uid()));
CREATE POLICY phrase_variants_public_or_own_read ON public.phrase_variants FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.phrase_entries entry WHERE entry.id = phrase_entry_id AND ((entry.owner_user_id is null and entry.review_status = 'approved') or entry.owner_user_id = (SELECT auth.uid()))));
CREATE POLICY corpus_occurrences_public_or_own_read ON public.corpus_occurrences FOR SELECT TO anon, authenticated
  USING (owner_user_id is null or owner_user_id = (SELECT auth.uid()));
CREATE POLICY user_lexical_intents_own ON public.user_lexical_intents FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
GRANT SELECT ON TABLE public.lexemes, public.lexeme_forms, public.phrase_entries, public.phrase_variants, public.corpus_occurrences TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_lexical_intents TO authenticated;
