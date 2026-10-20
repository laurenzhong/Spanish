CREATE TABLE "conversation_reply_sources" (
	"assistant_message_id" uuid NOT NULL,
	"user_message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "conversation_reply_sources_assistant_message_id_user_message_id_pk" PRIMARY KEY("assistant_message_id","user_message_id"),
	CONSTRAINT "conversation_reply_sources_position_check" CHECK ("conversation_reply_sources"."position" >= 0 and "conversation_reply_sources"."position" < 20),
	CONSTRAINT "conversation_reply_sources_distinct_check" CHECK ("conversation_reply_sources"."assistant_message_id" <> "conversation_reply_sources"."user_message_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_reply_sources" ADD CONSTRAINT "conversation_reply_sources_assistant_message_id_messages_id_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reply_sources" ADD CONSTRAINT "conversation_reply_sources_user_message_id_messages_id_fk" FOREIGN KEY ("user_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reply_sources" ADD CONSTRAINT "conversation_reply_sources_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_reply_sources" ADD CONSTRAINT "conversation_reply_sources_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_reply_sources_position_uidx" ON "conversation_reply_sources" USING btree ("assistant_message_id","position");--> statement-breakpoint
CREATE INDEX "conversation_reply_sources_user_message_idx" ON "conversation_reply_sources" USING btree ("user_message_id");
--> statement-breakpoint
CREATE FUNCTION public.validate_conversation_reply_source() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.messages assistant
    JOIN public.messages source ON source.id = NEW.user_message_id
    JOIN public.conversations conversation ON conversation.id = NEW.conversation_id
    WHERE assistant.id = NEW.assistant_message_id
      AND assistant.role = 'character' AND source.role = 'user'
      AND assistant.user_id = NEW.user_id AND source.user_id = NEW.user_id AND conversation.user_id = NEW.user_id
      AND assistant.conversation_id = NEW.conversation_id AND source.conversation_id = NEW.conversation_id
  ) THEN
    RAISE EXCEPTION 'conversation_reply_source_scope_mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER conversation_reply_source_validate
BEFORE INSERT OR UPDATE ON public.conversation_reply_sources
FOR EACH ROW EXECUTE FUNCTION public.validate_conversation_reply_source();
--> statement-breakpoint
-- Existing single-source provenance is authoritative; do not guess additional historical sources.
INSERT INTO public.conversation_reply_sources (assistant_message_id, user_message_id, user_id, conversation_id, position)
SELECT assistant.id, source.id, assistant.user_id, assistant.conversation_id, 0
FROM public.messages assistant JOIN public.messages source ON source.id = assistant.reply_to_message_id
WHERE assistant.role = 'character' AND source.role = 'user'
  AND assistant.user_id = source.user_id AND assistant.conversation_id = source.conversation_id;
--> statement-breakpoint
ALTER TABLE public.conversation_reply_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversation_reply_sources_select_own ON public.conversation_reply_sources
FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON TABLE public.conversation_reply_sources FROM anon, authenticated;
GRANT SELECT ON TABLE public.conversation_reply_sources TO authenticated;
