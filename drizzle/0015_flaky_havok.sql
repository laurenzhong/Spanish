CREATE TABLE "reserved_public_uids" (
	"public_uid" text PRIMARY KEY NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "public_uid" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avatar_kind" text DEFAULT 'initials' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avatar_preset_id" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avatar_path" text;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.generate_public_uid()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  alphabet CONSTANT text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  index_value integer;
BEGIN
  LOOP
    candidate := 'SN-';
    FOR index_value IN 1..8 LOOP
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
      IF index_value = 4 THEN candidate := candidate || '-'; END IF;
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE public_uid = candidate)
      AND NOT EXISTS (SELECT 1 FROM public.reserved_public_uids WHERE public_uid = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;--> statement-breakpoint
DO $$
DECLARE
  profile_row record;
BEGIN
  FOR profile_row IN SELECT id FROM public.profiles WHERE public_uid IS NULL OR btrim(public_uid) = '' LOOP
    UPDATE public.profiles SET public_uid = public.generate_public_uid() WHERE id = profile_row.id;
  END LOOP;
END
$$;--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "public_uid" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reserved_public_uids_uidx" ON "reserved_public_uids" USING btree ("public_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_public_uid_uidx" ON "profiles" USING btree ("public_uid");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_avatar_kind_check" CHECK ("profiles"."avatar_kind" in ('upload', 'preset', 'initials'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, public_uid, display_name)
  VALUES (
    NEW.id,
    public.generate_public_uid(),
    NULLIF(COALESCE(NEW.raw_user_meta_data ->> 'display_name', ''), '')
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.generate_public_uid() TO authenticated;
ALTER TABLE public.reserved_public_uids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reserved_public_uids FROM anon, authenticated;
REVOKE SELECT ON TABLE public.profiles FROM authenticated;
GRANT SELECT (public_uid, display_name, native_language, interface_language, timezone, created_at, updated_at)
  ON public.profiles TO authenticated;
GRANT UPDATE (display_name, avatar_kind, avatar_preset_id)
  ON public.profiles TO authenticated;
