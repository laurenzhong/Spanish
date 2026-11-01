-- Remove provider default grants, including TRUNCATE/REFERENCES/TRIGGER that RLS does not protect.
-- Forward-only correction: 0054 may already be deployed. No other table privileges change.
REVOKE ALL PRIVILEGES ON TABLE public.user_vocabulary_recall_progress, public.user_vocabulary_recall_receipts, public.user_vocabulary_recall_sync FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.user_vocabulary_recall_progress, public.user_vocabulary_recall_receipts, public.user_vocabulary_recall_sync TO authenticated;
