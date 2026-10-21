CREATE TABLE "media_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_key" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"kind" "media_kind" NOT NULL,
	"order_mode" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_series_key_check" CHECK (length(trim("media_series"."series_key")) > 0),
	CONSTRAINT "media_series_title_check" CHECK (length(trim("media_series"."title")) > 0),
	CONSTRAINT "media_series_order_mode_check" CHECK ("media_series"."order_mode" in ('ordered', 'episodic')),
	CONSTRAINT "media_series_status_check" CHECK ("media_series"."status" in ('active', 'archived')),
	CONSTRAINT "media_series_revision_check" CHECK ("media_series"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "media_series_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"expected_revision" integer NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_series_changes_revision_check" CHECK ("media_series_changes"."expected_revision" >= 0),
	CONSTRAINT "media_series_changes_key_check" CHECK (length(trim("media_series_changes"."idempotency_key")) > 0),
	CONSTRAINT "media_series_changes_hash_check" CHECK ("media_series_changes"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "media_series_changes_reason_check" CHECK (length(trim("media_series_changes"."reason")) > 0),
	CONSTRAINT "media_series_changes_evidence_check" CHECK (jsonb_typeof("media_series_changes"."evidence") = 'array' and jsonb_array_length("media_series_changes"."evidence") > 0)
);
--> statement-breakpoint
CREATE TABLE "media_series_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_item_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"position" integer,
	"season_number" integer,
	"episode_number" integer,
	"episode_label" text,
	"evidence" jsonb NOT NULL,
	"confirmed_by" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_series_memberships_position_check" CHECK ("media_series_memberships"."position" is null or "media_series_memberships"."position" > 0),
	CONSTRAINT "media_series_memberships_numbers_check" CHECK (("media_series_memberships"."season_number" is null or "media_series_memberships"."season_number" >= 0) and ("media_series_memberships"."episode_number" is null or "media_series_memberships"."episode_number" >= 0)),
	CONSTRAINT "media_series_memberships_evidence_check" CHECK (jsonb_typeof("media_series_memberships"."evidence") = 'array' and jsonb_array_length("media_series_memberships"."evidence") > 0)
);
--> statement-breakpoint
ALTER TABLE "media_series_changes" ADD CONSTRAINT "media_series_changes_series_id_media_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."media_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_series_memberships" ADD CONSTRAINT "media_series_memberships_media_item_id_media_items_id_fk" FOREIGN KEY ("media_item_id") REFERENCES "public"."media_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_series_memberships" ADD CONSTRAINT "media_series_memberships_series_id_media_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."media_series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_series_key_uidx" ON "media_series" USING btree ("series_key");--> statement-breakpoint
CREATE UNIQUE INDEX "media_series_changes_idempotency_uidx" ON "media_series_changes" USING btree ("series_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "media_series_changes_series_created_idx" ON "media_series_changes" USING btree ("series_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_series_memberships_item_uidx" ON "media_series_memberships" USING btree ("media_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_series_memberships_position_uidx" ON "media_series_memberships" USING btree ("series_id","position");--> statement-breakpoint
CREATE INDEX "media_series_memberships_series_idx" ON "media_series_memberships" USING btree ("series_id");
--> statement-breakpoint
-- The directory is server-only, matching the existing formal media tables.
-- The owner workflow separately checks its allowlist before invoking writes.
ALTER TABLE public.media_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_series_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_series_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.media_series, public.media_series_memberships, public.media_series_changes FROM anon, authenticated;
--> statement-breakpoint
CREATE FUNCTION public.validate_media_series_membership() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  item_kind public.media_kind;
  series_kind public.media_kind;
  series_order text;
BEGIN
  -- Share locks prevent a concurrent parent kind/order edit from passing its
  -- inverse check while this membership is being inserted or moved.
  SELECT kind INTO item_kind FROM public.media_items WHERE id = NEW.media_item_id FOR SHARE;
  SELECT kind, order_mode INTO series_kind, series_order FROM public.media_series WHERE id = NEW.series_id FOR SHARE;
  IF item_kind IS DISTINCT FROM series_kind THEN
    RAISE EXCEPTION 'media_series_membership_kind_mismatch' USING ERRCODE = '23514';
  END IF;
  IF series_order = 'ordered' AND NEW.position IS NULL THEN
    RAISE EXCEPTION 'media_series_membership_ordered_position_required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER media_series_membership_validate
BEFORE INSERT OR UPDATE ON public.media_series_memberships
FOR EACH ROW EXECUTE FUNCTION public.validate_media_series_membership();
--> statement-breakpoint
CREATE FUNCTION public.validate_media_series_parent_edit() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.media_series_memberships membership
    JOIN public.media_items item ON item.id = membership.media_item_id
    WHERE membership.series_id = NEW.id
      AND (item.kind <> NEW.kind OR (NEW.order_mode = 'ordered' AND membership.position IS NULL))
  ) THEN
    RAISE EXCEPTION 'media_series_parent_edit_conflicts_with_memberships' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER media_series_parent_edit_validate
BEFORE UPDATE OF kind, order_mode ON public.media_series
FOR EACH ROW EXECUTE FUNCTION public.validate_media_series_parent_edit();
--> statement-breakpoint
CREATE FUNCTION public.validate_media_series_item_kind_edit() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.media_series_memberships membership
    JOIN public.media_series series ON series.id = membership.series_id
    WHERE membership.media_item_id = NEW.id AND series.kind <> NEW.kind
  ) THEN
    RAISE EXCEPTION 'media_series_item_kind_edit_conflicts_with_membership' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER media_series_item_kind_edit_validate
BEFORE UPDATE OF kind ON public.media_items
FOR EACH ROW EXECUTE FUNCTION public.validate_media_series_item_kind_edit();
--> statement-breakpoint
CREATE FUNCTION public.reject_media_series_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'media_series_changes_append_only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER media_series_changes_append_only
BEFORE UPDATE OR DELETE ON public.media_series_changes
FOR EACH ROW EXECUTE FUNCTION public.reject_media_series_audit_mutation();
--> statement-breakpoint
CREATE TRIGGER media_series_changes_no_truncate
BEFORE TRUNCATE ON public.media_series_changes
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_media_series_audit_mutation();
