ALTER TABLE "provider_calls" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD COLUMN "attempt_id" text;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD COLUMN "generation_id" text;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD COLUMN "error_type" text;