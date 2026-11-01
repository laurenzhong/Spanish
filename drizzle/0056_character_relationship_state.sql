CREATE TABLE "relationship_heads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "identity_id" uuid NOT NULL REFERENCES "character_identities"("id") ON DELETE CASCADE, "epoch" uuid NOT NULL DEFAULT gen_random_uuid(),
  "control_revision" bigint NOT NULL DEFAULT 0 CHECK ("control_revision" >= 0), "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "relationship_heads_user_identity_uidx" UNIQUE ("user_id","identity_id")
);
CREATE INDEX "relationship_heads_user_idx" ON "relationship_heads"("user_id");
CREATE TABLE "relationship_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "head_id" uuid NOT NULL REFERENCES "relationship_heads"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE, "identity_id" uuid NOT NULL REFERENCES "character_identities"("id") ON DELETE CASCADE,
  "sequence" bigint NOT NULL CHECK ("sequence" > 0), "idempotency_key" text NOT NULL, "event_kind" text NOT NULL, "certainty" text NOT NULL CHECK ("certainty" IN ('explicit','supported','uncertain')),
  "rule_version" text NOT NULL, "generation_id" text, "turn_id" text, "character_version" integer, "episode_key" text, "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(), UNIQUE ("head_id","idempotency_key"), UNIQUE ("head_id","sequence"), CHECK (NOT ("payload" ? 'content') AND NOT ("payload" ? 'rawText'))
);
CREATE INDEX "relationship_events_head_idx" ON "relationship_events"("head_id");
CREATE TABLE "relationship_event_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "event_id" uuid NOT NULL REFERENCES "relationship_events"("id") ON DELETE CASCADE,
  "message_id" uuid REFERENCES "messages"("id") ON DELETE SET NULL, "source_role" text NOT NULL CHECK ("source_role" IN ('user','character')), "position" integer NOT NULL CHECK ("position" >= 0),
  "source_deleted_at" timestamptz, "tombstoned" boolean NOT NULL DEFAULT false, UNIQUE ("event_id","message_id")
);
CREATE INDEX "relationship_event_sources_message_idx" ON "relationship_event_sources"("message_id");
CREATE TABLE "relationship_boundaries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "head_id" uuid NOT NULL REFERENCES "relationship_heads"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE, "identity_id" uuid NOT NULL REFERENCES "character_identities"("id") ON DELETE CASCADE,
  "scope" text NOT NULL CHECK ("scope" IN ('romance','nickname','topic','proactive','contact')), "target" text NOT NULL, "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active','released','suspended')),
  "source_event_id" uuid REFERENCES "relationship_events"("id") ON DELETE SET NULL, "revision" bigint NOT NULL CHECK ("revision" >= 0), "idempotency_key" text NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(), UNIQUE ("head_id","idempotency_key")
);
CREATE INDEX "relationship_boundaries_active_idx" ON "relationship_boundaries"("head_id","status","scope");
CREATE TABLE "relationship_pending_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "head_id" uuid NOT NULL REFERENCES "relationship_heads"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE, "identity_id" uuid NOT NULL REFERENCES "character_identities"("id") ON DELETE CASCADE,
  "generation_id" text, "turn_id" text, "receipt_key" text NOT NULL, "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','processing','failed','completed')),
  "attempt_count" integer NOT NULL DEFAULT 0 CHECK ("attempt_count" >= 0), "next_attempt_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), UNIQUE ("head_id","receipt_key")
);
CREATE INDEX "relationship_pending_sources_due_idx" ON "relationship_pending_sources"("head_id","status","next_attempt_at");
CREATE FUNCTION relationship_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF pg_trigger_depth() > 1 OR current_setting('app.allow_relationship_event_delete', true) = 'on' THEN RETURN COALESCE(OLD,NEW); END IF;
  RAISE EXCEPTION 'relationship_events_append_only';
END; $$;
CREATE TRIGGER relationship_events_no_update BEFORE UPDATE OR DELETE ON relationship_events FOR EACH ROW EXECUTE FUNCTION relationship_events_append_only();
CREATE FUNCTION relationship_event_source_tombstone() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.message_id IS NULL AND OLD.message_id IS NOT NULL THEN NEW.tombstoned := true; NEW.source_deleted_at := COALESCE(NEW.source_deleted_at, now()); END IF; RETURN NEW;
END; $$;
CREATE TRIGGER relationship_event_sources_tombstone BEFORE UPDATE OF message_id ON relationship_event_sources FOR EACH ROW EXECUTE FUNCTION relationship_event_source_tombstone();
ALTER TABLE relationship_heads ENABLE ROW LEVEL SECURITY; ALTER TABLE relationship_events ENABLE ROW LEVEL SECURITY; ALTER TABLE relationship_event_sources ENABLE ROW LEVEL SECURITY; ALTER TABLE relationship_boundaries ENABLE ROW LEVEL SECURITY; ALTER TABLE relationship_pending_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY relationship_heads_select_own ON relationship_heads FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY relationship_events_select_own ON relationship_events FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY relationship_event_sources_select_own ON relationship_event_sources FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM relationship_events e WHERE e.id = event_id AND e.user_id = (SELECT auth.uid())));
CREATE POLICY relationship_boundaries_select_own ON relationship_boundaries FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY relationship_pending_sources_select_own ON relationship_pending_sources FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON relationship_heads, relationship_events, relationship_event_sources, relationship_boundaries, relationship_pending_sources FROM anon, authenticated;
GRANT SELECT ON relationship_heads, relationship_events, relationship_event_sources, relationship_boundaries, relationship_pending_sources TO authenticated;
