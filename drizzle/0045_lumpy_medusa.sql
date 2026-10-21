CREATE TABLE "character_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stable_key" text NOT NULL,
	"current_character_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "character_introduction_offers" ADD COLUMN "source_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "character_introduction_offers" ADD COLUMN "target_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD COLUMN "identity_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_preferences" ADD COLUMN "identity_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "identity_id" uuid;--> statement-breakpoint
ALTER TABLE "memory_sharing_permissions" ADD COLUMN "target_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "identity_id" uuid;--> statement-breakpoint
ALTER TABLE "proactive_message_candidates" ADD COLUMN "identity_id" uuid;--> statement-breakpoint
ALTER TABLE "relationship_memories" ADD COLUMN "identity_id" uuid;--> statement-breakpoint
ALTER TABLE "character_identities" ADD CONSTRAINT "character_identities_current_character_id_characters_id_fk" FOREIGN KEY ("current_character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "character_identities_stable_key_uidx" ON "character_identities" USING btree ("stable_key");--> statement-breakpoint
ALTER TABLE "character_introduction_offers" ADD CONSTRAINT "character_introduction_offers_source_identity_id_character_identities_id_fk" FOREIGN KEY ("source_identity_id") REFERENCES "public"."character_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_introduction_offers" ADD CONSTRAINT "character_introduction_offers_target_identity_id_character_identities_id_fk" FOREIGN KEY ("target_identity_id") REFERENCES "public"."character_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_identity_id_character_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."character_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_preferences" ADD CONSTRAINT "conversation_preferences_identity_id_character_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."character_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_identity_id_character_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."character_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_sharing_permissions" ADD CONSTRAINT "memory_sharing_permissions_target_identity_id_character_identities_id_fk" FOREIGN KEY ("target_identity_id") REFERENCES "public"."character_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_identity_id_character_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."character_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_message_candidates" ADD CONSTRAINT "proactive_message_candidates_identity_id_character_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."character_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_memories" ADD CONSTRAINT "relationship_memories_identity_id_character_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."character_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_introduction_offers_source_identity_idx" ON "character_introduction_offers" USING btree ("source_identity_id");--> statement-breakpoint
CREATE INDEX "character_introduction_offers_target_identity_idx" ON "character_introduction_offers" USING btree ("target_identity_id");--> statement-breakpoint
CREATE INDEX "character_relationships_identity_idx" ON "character_relationships" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "conversation_preferences_identity_idx" ON "conversation_preferences" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "conversations_identity_idx" ON "conversations" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "memory_sharing_permissions_target_identity_idx" ON "memory_sharing_permissions" USING btree ("target_identity_id");--> statement-breakpoint
CREATE INDEX "messages_identity_idx" ON "messages" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "proactive_candidates_identity_idx" ON "proactive_message_candidates" USING btree ("identity_id");--> statement-breakpoint
CREATE INDEX "relationship_memories_identity_idx" ON "relationship_memories" USING btree ("identity_id");