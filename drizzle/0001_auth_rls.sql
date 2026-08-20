-- Supabase Auth lifecycle -----------------------------------------------------

DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'profiles_id_auth_users_id_fk'
     ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_id_auth_users_id_fk
      FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    NULLIF(COALESCE(NEW.raw_user_meta_data ->> 'display_name', ''), '')
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;--> statement-breakpoint

DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
  END IF;
END
$$;--> statement-breakpoint

-- RLS helpers ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_content_approved(
  requested_entity_type text,
  requested_entity_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.content_reviews
    WHERE entity_type = requested_entity_type
      AND entity_id = requested_entity_id
      AND status = 'approved'
  );
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_content_approved(text, uuid) TO anon, authenticated;--> statement-breakpoint

-- Private user data ----------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own
  ON public.profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));
CREATE POLICY profiles_update_own
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY user_preferences_select_own
  ON public.user_preferences FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY user_preferences_insert_own
  ON public.user_preferences FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY user_preferences_update_own
  ON public.user_preferences FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DO $$
DECLARE
  private_table text;
BEGIN
  FOREACH private_table IN ARRAY ARRAY[
    'practice_sessions',
    'practice_attempts',
    'learning_breakpoints',
    'evidence_events',
    'user_skill_states',
    'user_scene_states',
    'character_relationships',
    'relationship_memories',
    'memory_sharing_permissions',
    'conversations',
    'messages',
    'audio_assets'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', private_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()))',
      private_table || '_select_own',
      private_table
    );
  END LOOP;
END
$$;--> statement-breakpoint

ALTER TABLE public.provider_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.profiles,
  public.user_preferences,
  public.practice_sessions,
  public.practice_attempts,
  public.learning_breakpoints,
  public.evidence_events,
  public.user_skill_states,
  public.user_scene_states,
  public.character_relationships,
  public.relationship_memories,
  public.memory_sharing_permissions,
  public.conversations,
  public.messages,
  public.audio_assets,
  public.provider_calls,
  public.idempotency_keys
FROM anon, authenticated;--> statement-breakpoint

GRANT SELECT ON TABLE
  public.profiles,
  public.user_preferences,
  public.practice_sessions,
  public.practice_attempts,
  public.learning_breakpoints,
  public.evidence_events,
  public.user_skill_states,
  public.user_scene_states,
  public.character_relationships,
  public.relationship_memories,
  public.memory_sharing_permissions,
  public.conversations,
  public.messages,
  public.audio_assets
TO authenticated;--> statement-breakpoint

GRANT UPDATE (display_name, native_language, interface_language, timezone)
  ON public.profiles TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.user_preferences TO authenticated;--> statement-breakpoint

-- Public reviewed content ----------------------------------------------------

ALTER TABLE public.communication_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expression_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expression_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_pack_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_pack_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_canon_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY communication_domains_public_read
  ON public.communication_domains FOR SELECT TO anon, authenticated
  USING (
    status = 'published'
    AND public.is_content_approved('communication_domain', id)
  );

CREATE POLICY learning_goals_public_read
  ON public.learning_goals FOR SELECT TO anon, authenticated
  USING (
    status = 'published'
    AND public.is_content_approved('learning_goal', id)
  );

CREATE POLICY expressions_public_read
  ON public.expressions FOR SELECT TO anon, authenticated
  USING (
    status = 'published'
    AND public.is_content_approved('expression', id)
  );

CREATE POLICY expression_variants_public_read
  ON public.expression_variants FOR SELECT TO anon, authenticated
  USING (
    status = 'published'
    AND EXISTS (
      SELECT 1 FROM public.expressions
      WHERE expressions.id = expression_variants.expression_id
    )
  );

CREATE POLICY tags_public_read
  ON public.tags FOR SELECT TO anon, authenticated
  USING (is_active = true);

CREATE POLICY expression_tags_public_read
  ON public.expression_tags FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.expressions
      WHERE expressions.id = expression_tags.expression_id
    )
  );

CREATE POLICY scenarios_public_read
  ON public.scenarios FOR SELECT TO anon, authenticated
  USING (
    status = 'published'
    AND public.is_content_approved('scenario', id)
  );

CREATE POLICY scenario_tasks_public_read
  ON public.scenario_tasks FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.scenarios
      WHERE scenarios.id = scenario_tasks.scenario_id
    )
  );

CREATE POLICY content_packs_public_read
  ON public.content_packs FOR SELECT TO anon, authenticated
  USING (
    status = 'published'
    AND public.is_content_approved('content_pack', id)
  );

CREATE POLICY content_pack_segments_public_read
  ON public.content_pack_segments FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.content_packs
      WHERE content_packs.id = content_pack_segments.content_pack_id
    )
  );

CREATE POLICY content_pack_activities_public_read
  ON public.content_pack_activities FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.content_packs
      WHERE content_packs.id = content_pack_activities.content_pack_id
    )
  );

CREATE POLICY content_sources_public_read
  ON public.content_sources FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.content_packs
      WHERE content_packs.id = content_sources.content_pack_id
    )
  );

CREATE POLICY characters_public_read
  ON public.characters FOR SELECT TO anon, authenticated
  USING (
    status = 'published'
    AND public.is_content_approved('character', id)
  );

CREATE POLICY character_canon_facts_public_read
  ON public.character_canon_facts FOR SELECT TO anon, authenticated
  USING (
    is_active = true
    AND sensitivity = 'normal'
    AND EXISTS (
      SELECT 1 FROM public.characters
      WHERE characters.id = character_canon_facts.character_id
    )
  );

REVOKE ALL ON TABLE
  public.communication_domains,
  public.learning_goals,
  public.expressions,
  public.expression_variants,
  public.tags,
  public.expression_tags,
  public.scenarios,
  public.scenario_tasks,
  public.content_packs,
  public.content_pack_segments,
  public.content_pack_activities,
  public.content_sources,
  public.content_reviews,
  public.characters,
  public.character_canon_facts
FROM anon, authenticated;--> statement-breakpoint

GRANT SELECT ON TABLE
  public.communication_domains,
  public.learning_goals,
  public.expressions,
  public.expression_variants,
  public.tags,
  public.expression_tags,
  public.scenarios,
  public.scenario_tasks,
  public.content_packs,
  public.content_pack_segments,
  public.content_pack_activities,
  public.content_sources,
  public.characters,
  public.character_canon_facts
TO anon, authenticated;
