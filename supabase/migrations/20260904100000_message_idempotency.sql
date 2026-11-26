BEGIN;

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS client_message_id UUID;
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_company_conversation_sender_client_message_id_key;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_company_conversation_sender_client_message_id_key
  UNIQUE (company_id, conversation_id, sender_id, client_message_id);

COMMIT;
