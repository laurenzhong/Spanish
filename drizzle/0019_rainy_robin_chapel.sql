CREATE TABLE "user_content_pack_states" (
	"user_id" uuid NOT NULL,
	"pack_stable_key" text NOT NULL,
	"pack_version" integer NOT NULL,
	"saved" boolean DEFAULT false NOT NULL,
	"completed_steps" integer DEFAULT 0 NOT NULL,
	"total_steps" integer NOT NULL,
	"last_opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_content_pack_states_user_id_pack_stable_key_pack_version_pk" PRIMARY KEY("user_id","pack_stable_key","pack_version"),
	CONSTRAINT "user_content_pack_states_version_positive_check" CHECK ("user_content_pack_states"."pack_version" > 0),
	CONSTRAINT "user_content_pack_states_steps_valid_check" CHECK ("user_content_pack_states"."completed_steps" >= 0 and "user_content_pack_states"."completed_steps" <= "user_content_pack_states"."total_steps" and "user_content_pack_states"."total_steps" > 0)
);
--> statement-breakpoint
ALTER TABLE "user_content_pack_states" ADD CONSTRAINT "user_content_pack_states_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_content_pack_states_user_last_opened_idx" ON "user_content_pack_states" USING btree ("user_id","last_opened_at");
--> statement-breakpoint
ALTER TABLE public.user_content_pack_states ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_content_pack_states_select_own
  ON public.user_content_pack_states FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY user_content_pack_states_insert_own
  ON public.user_content_pack_states FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY user_content_pack_states_update_own
  ON public.user_content_pack_states FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
REVOKE ALL ON TABLE public.user_content_pack_states FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_content_pack_states TO authenticated;
