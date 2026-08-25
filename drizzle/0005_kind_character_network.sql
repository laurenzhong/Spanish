CREATE TABLE "character_introduction_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"offer_key" text NOT NULL,
	"source_character_id" uuid NOT NULL,
	"target_character_id" uuid NOT NULL,
	"reason_code" text NOT NULL,
	"reason_text" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"accepted_memory_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_introduction_offers_status_check" CHECK ("character_introduction_offers"."status" in ('pending', 'accepted', 'declined', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "character_introduction_offers" ADD CONSTRAINT "character_introduction_offers_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "character_introduction_offers" ADD CONSTRAINT "character_introduction_offers_source_character_id_characters_id_fk" FOREIGN KEY ("source_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "character_introduction_offers" ADD CONSTRAINT "character_introduction_offers_target_character_id_characters_id_fk" FOREIGN KEY ("target_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "character_introduction_offers_user_key_uidx" ON "character_introduction_offers" USING btree ("user_id","offer_key");
--> statement-breakpoint
CREATE INDEX "character_introduction_offers_user_status_idx" ON "character_introduction_offers" USING btree ("user_id","status","updated_at");
--> statement-breakpoint
ALTER TABLE public.character_introduction_offers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY character_introduction_offers_select_own
  ON public.character_introduction_offers FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint
REVOKE ALL ON TABLE public.character_introduction_offers FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.character_introduction_offers TO authenticated;

