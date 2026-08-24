ALTER TABLE "relationship_memories" ADD COLUMN "fact_key" text;--> statement-breakpoint
UPDATE "relationship_memories" SET "fact_key" = 'legacy:' || "id" WHERE "fact_key" IS NULL;--> statement-breakpoint
ALTER TABLE "relationship_memories" ALTER COLUMN "fact_key" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "relationship_memories_user_character_fact_idx" ON "relationship_memories" USING btree ("user_id","character_id","fact_key");
