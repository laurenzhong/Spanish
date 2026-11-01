CREATE TABLE "account_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_code" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_invitations_role_check" CHECK ("account_invitations"."role" in ('owner', 'member')),
	CONSTRAINT "account_invitations_status_check" CHECK ("account_invitations"."status" in ('pending', 'redeeming', 'accepted', 'expired', 'revoked', 'failed')),
	CONSTRAINT "account_invitations_token_hash_check" CHECK ("account_invitations"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "account_invitations_email_check" CHECK ("account_invitations"."email" = lower("account_invitations"."email") and length("account_invitations"."email") between 3 and 320 and position('@' in "account_invitations"."email") > 1),
	CONSTRAINT "account_invitations_accepted_fields_check" CHECK (("account_invitations"."status" = 'accepted' and "account_invitations"."accepted_user_id" is not null and "account_invitations"."accepted_at" is not null) or ("account_invitations"."status" <> 'accepted' and "account_invitations"."accepted_user_id" is null and "account_invitations"."accepted_at" is null)),
	CONSTRAINT "account_invitations_failure_fields_check" CHECK (("account_invitations"."status" = 'failed' and "account_invitations"."failure_code" is not null and "account_invitations"."failed_at" is not null) or ("account_invitations"."status" <> 'failed' and "account_invitations"."failure_code" is null and "account_invitations"."failed_at" is null)),
	CONSTRAINT "account_invitations_revoked_at_check" CHECK (("account_invitations"."status" = 'revoked' and "account_invitations"."revoked_at" is not null) or ("account_invitations"."status" <> 'revoked' and "account_invitations"."revoked_at" is null))
);
--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text,
	"request_id" text,
	"before_state" jsonb,
	"after_state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_audit_log_action_check" CHECK ("admin_audit_log"."action" in ('invitation.create', 'invitation.revoke', 'user.suspend', 'user.activate', 'user.delete', 'user.sessions_revoke', 'diagnostic.acknowledge', 'diagnostic.resolve')),
	CONSTRAINT "admin_audit_log_target_kind_check" CHECK ("admin_audit_log"."target_kind" in ('user', 'invitation', 'diagnostic_event')),
	CONSTRAINT "admin_audit_log_target_id_check" CHECK (length(trim("admin_audit_log"."target_id")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "account_status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "account_invitations_token_hash_uidx" ON "account_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "account_invitations_pending_email_uidx" ON "account_invitations" USING btree (lower("email")) WHERE "account_invitations"."status" in ('pending', 'redeeming');--> statement-breakpoint
CREATE INDEX "account_invitations_status_created_idx" ON "account_invitations" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "account_invitations_email_idx" ON "account_invitations" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "admin_audit_log_created_idx" ON "admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_log_target_idx" ON "admin_audit_log" USING btree ("target_kind","target_id");--> statement-breakpoint
CREATE INDEX "admin_audit_log_actor_created_idx" ON "admin_audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "profiles_role_status_idx" ON "profiles" USING btree ("role","account_status");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_role_check" CHECK ("profiles"."role" in ('owner', 'member'));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_account_status_check" CHECK ("profiles"."account_status" in ('active', 'suspended'));--> statement-breakpoint
-- Account invitations and the owner audit trail are server-only tables
-- (ACCT-ADMIN-001, ADR-0021). No client role receives table grants; every read
-- and write goes through authenticated server application code.
ALTER TABLE public.account_invitations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public.account_invitations, public.admin_audit_log FROM anon, authenticated;--> statement-breakpoint
CREATE FUNCTION public.reject_admin_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log_append_only' USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
CREATE TRIGGER admin_audit_log_append_only
BEFORE UPDATE OR DELETE ON public.admin_audit_log
FOR EACH ROW EXECUTE FUNCTION public.reject_admin_audit_mutation();--> statement-breakpoint
CREATE TRIGGER admin_audit_log_no_truncate
BEFORE TRUNCATE ON public.admin_audit_log
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_admin_audit_mutation();