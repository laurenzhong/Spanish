CREATE TABLE "conversation_preferences" (
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"is_muted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_preferences" ADD CONSTRAINT "conversation_preferences_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_preferences" ADD CONSTRAINT "conversation_preferences_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_preferences_user_character_uidx" ON "conversation_preferences" USING btree ("user_id","character_id");--> statement-breakpoint
CREATE INDEX "conversation_preferences_user_idx" ON "conversation_preferences" USING btree ("user_id","updated_at");
--> statement-breakpoint
ALTER TABLE public.conversation_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY conversation_preferences_select_own
  ON public.conversation_preferences FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY conversation_preferences_insert_own
  ON public.conversation_preferences FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY conversation_preferences_update_own
  ON public.conversation_preferences FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
REVOKE ALL ON TABLE public.conversation_preferences FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.conversation_preferences TO authenticated;
