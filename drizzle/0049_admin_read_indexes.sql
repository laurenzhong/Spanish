CREATE INDEX "acquisition_runs_started_idx" ON "acquisition_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "content_candidates_publication_idx" ON "content_candidates" USING btree ("publication_status","published_at_internal");--> statement-breakpoint
CREATE INDEX "evidence_events_occurred_idx" ON "evidence_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "provider_calls_started_idx" ON "provider_calls" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "provider_calls_type_started_idx" ON "provider_calls" USING btree ("provider_type","started_at");--> statement-breakpoint
CREATE INDEX "practice_sessions_started_idx" ON "practice_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "profiles_created_idx" ON "profiles" USING btree ("created_at");