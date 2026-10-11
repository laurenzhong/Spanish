CREATE TABLE "lexicon_form_frequencies" (
	"word" text PRIMARY KEY NOT NULL,
	"occurrence_count" integer NOT NULL,
	"example_title" text NOT NULL,
	"example_text" text NOT NULL,
	CONSTRAINT "lexicon_form_frequencies_word_check" CHECK (length("lexicon_form_frequencies"."word") >= 2),
	CONSTRAINT "lexicon_form_frequencies_count_check" CHECK ("lexicon_form_frequencies"."occurrence_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "lexicon_form_frequency_state" (
	"id" text PRIMARY KEY NOT NULL,
	"refreshed_at" timestamp with time zone NOT NULL,
	"form_count" integer NOT NULL,
	CONSTRAINT "lexicon_form_frequency_state_id_check" CHECK ("lexicon_form_frequency_state"."id" = 'corpus'),
	CONSTRAINT "lexicon_form_frequency_state_count_check" CHECK ("lexicon_form_frequency_state"."form_count" >= 0)
);
