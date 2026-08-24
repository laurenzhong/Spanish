CREATE UNIQUE INDEX "conversations_user_character_uidx" ON "conversations" USING btree ("user_id","character_id");--> statement-breakpoint
