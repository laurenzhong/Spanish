CREATE TABLE "proactive_message_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"generation_id" text NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"message_id" uuid,
	"notification_status" text DEFAULT 'not_requested' NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proactive_candidates_status_check" CHECK ("proactive_message_candidates"."status" in ('pending', 'generating', 'generated', 'suppressed', 'failed', 'expired')),
	CONSTRAINT "proactive_candidates_notification_status_check" CHECK ("proactive_message_candidates"."notification_status" in ('not_requested', 'pending', 'delivered', 'failed', 'suppressed'))
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "source_type" text DEFAULT 'conversation' NOT NULL;--> statement-breakpoint
ALTER TABLE "proactive_message_candidates" ADD CONSTRAINT "proactive_message_candidates_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_message_candidates" ADD CONSTRAINT "proactive_message_candidates_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_message_candidates" ADD CONSTRAINT "proactive_message_candidates_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_message_candidates" ADD CONSTRAINT "proactive_message_candidates_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proactive_candidates_user_dedupe_uidx" ON "proactive_message_candidates" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "proactive_candidates_user_status_idx" ON "proactive_message_candidates" USING btree ("user_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "proactive_candidates_user_character_idx" ON "proactive_message_candidates" USING btree ("user_id","character_id","created_at");