CREATE TABLE "user_vocabulary_mark_sync_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"legacy_import_blocked" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_vocabulary_mark_sync_state" ADD CONSTRAINT "user_vocabulary_mark_sync_state_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE user_vocabulary_mark_sync_state ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON user_vocabulary_mark_sync_state TO authenticated;
--> statement-breakpoint
CREATE POLICY user_vocabulary_mark_sync_state_read_own ON user_vocabulary_mark_sync_state FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
