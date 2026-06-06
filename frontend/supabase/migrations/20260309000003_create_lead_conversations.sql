CREATE TABLE public.lead_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone TEXT NOT NULL,
  conversation_compressed TEXT NOT NULL,
  tamanho_original INTEGER,
  unknown_lead BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_lead_conversations_telefone
  ON public.lead_conversations (telefone);

CREATE INDEX idx_lead_conversations_created_at
  ON public.lead_conversations (created_at DESC);

ALTER TABLE public.lead_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Deny all direct access to lead_conversations"
ON public.lead_conversations
FOR ALL
USING (false);
