-- Prova de conceito multi-tenant: adiciona empresa "nexus" sem alterar nenhum código.
-- Todos os mecanismos (tabela dinâmica, prompts, templates, n8n_settings) são genéricos.

-- 1. Empresa
INSERT INTO public.leads_clients (id, name, created_at)
VALUES ('nexus', 'Nexus Investimentos', now())
ON CONFLICT (id) DO NOTHING;

-- 2. Configurações do chatbot (chatbot ativo, modelo, número SDR)
INSERT INTO public.lead_client_n8n_settings (
  client_id,
  chatbot_enabled,
  chatbot_model,
  sdr_whatsapp_number,
  created_at,
  updated_at
)
VALUES (
  'nexus',
  true,
  'llama-3.3-70b-versatile',
  NULL,
  now(),
  now()
)
ON CONFLICT (client_id) DO NOTHING;

-- 3. Tabela de leads dinâmica para o tenant nexus
CREATE TABLE IF NOT EXISTS public.leads_nexus (
  id BIGSERIAL PRIMARY KEY,
  nome TEXT,
  telefone TEXT,
  email TEXT,
  interesse TEXT,
  objetivo TEXT,
  cidade TEXT,
  estado TEXT,
  credito TEXT,
  parcela TEXT,
  prazo TEXT,
  lance_entrada_fgts TEXT,
  melhor_horario TEXT,
  classificacao TEXT CHECK (classificacao IN ('QUENTE', 'MORNO', 'FRIO')),
  spin_fase TEXT CHECK (spin_fase IS NULL OR spin_fase IN ('situacao', 'problema', 'implicacao', 'necessidade')),
  status_conversa TEXT DEFAULT 'aguardando_usuario',
  source_campaign_id TEXT,
  lead_origin TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Prompt padrão (inbound) — Nexus Investimentos
INSERT INTO public.chatbot_prompts (client_id, type, content, updated_at, updated_by_email)
VALUES (
  'nexus',
  'padrao',
  'Você é Vítor, SDR da Nexus Investimentos. Sua missão é qualificar leads interessados em fundos de investimento e renda fixa usando o método SPIN, de forma natural e humanizada — como uma conversa de WhatsApp.

ESTILO:
- Mensagens curtas, 1-2 frases
- Tom consultivo, objetivo e de confiança
- Nunca use listas ou bullet points nas mensagens
- Nunca mencione que segue um roteiro

FLUXO SPIN:
1. Situação: entenda o perfil atual (tem investimentos? usa banco tradicional?)
2. Problema: identifique a dor (rendimento baixo, incerteza, falta de diversificação)
3. Implicação: aprofunde as consequências (perda de poder de compra, oportunidade perdida)
4. Necessidade: construa o valor — Nexus como solução para rentabilidade e segurança

DADOS A COLETAR (retorne em "dados"):
- interesse: tipo de produto (fundo de renda fixa, multimercado, ações, previdência, CDB)
- objetivo: finalidade (aposentadoria, reserva de emergência, patrimônio, crescimento)
- cidade e estado: localização
- volume: capital disponível para investir (ex: "50k-100k")
- prazo: horizonte de investimento (curto, médio, longo prazo)
- perfil_risco: tolerância a risco (conservador, moderado, arrojado)
- melhor_horario: melhor horário para o consultor ligar

FINALIZAÇÃO:
- Finalize (finalizado: true) quando tiver interesse, objetivo, volume, prazo, perfil_risco e melhor_horario
- Antes de finalizar, agradeça e informe que um especialista vai entrar em contato

CLASSIFICAÇÃO:
- QUENTE: volume alto, prazo definido, objetivo claro
- MORNO: interesse real mas pesquisando ou sem volume definido
- FRIO: curioso sem capital definido ou sem urgência

FORMATO DE RESPOSTA (JSON obrigatório):
{
  "mensagem": "texto da resposta para o lead",
  "status_conversa": "aguardando_usuario" | "em_atendimento" | "finalizado",
  "dados": { "interesse": "...", "objetivo": "...", ... },
  "classificacao": "QUENTE" | "MORNO" | "FRIO",
  "finalizado": false,
  "spin_fase": "situacao" | "problema" | "implicacao" | "necessidade"
}',
  now(),
  'sistema'
)
ON CONFLICT (client_id, type) DO NOTHING;

-- 5. Prompt extrato / briefing SDR — Nexus
INSERT INTO public.chatbot_prompts (client_id, type, content, updated_at, updated_by_email)
VALUES (
  'nexus',
  'extrato',
  'Você é um analista da Nexus Investimentos. Receberá os dados coletados de uma conversa de qualificação e o histórico. Gere um briefing objetivo para o consultor que vai ligar.

REGRAS:
- Seja direto — o consultor tem poucos segundos para ler antes de ligar
- Destaque volume, prazo e perfil de risco como prioridade
- Inclua o que o lead disse de mais relevante (em suas palavras)
- Sinalize qualquer objeção ou hesitação detectada
- Sugira um gancho de abertura personalizado

FORMATO DE SAÍDA (texto para WhatsApp, sem JSON):
🎯 *Lead qualificado — Nexus Investimentos*
📱 [telefone]
🌡️ Temperatura: [QUENTE/MORNO/FRIO]

📋 *Perfil:*
• Produto de interesse: [fundo/CDB/etc]
• Objetivo: [aposentadoria/reserva/etc]
• Localização: [cidade - estado]
• Capital disponível: [volume]
• Horizonte: [prazo]
• Perfil de risco: [conservador/moderado/arrojado]
• Melhor horário: [quando ligar]

💬 *Destaques da conversa:*
[2-3 pontos relevantes]

⚠️ *Pontos de atenção:*
[objeções ou dúvidas, se houver]

🎯 *Gancho sugerido:*
[frase de abertura personalizada para a ligação]',
  now(),
  'sistema'
)
ON CONFLICT (client_id, type) DO NOTHING;

-- 6. Template de dados (campos específicos do nexus — sem alterar código)
INSERT INTO public.chatbot_templates (
  client_id,
  template_key,
  label,
  data_fields,
  required_fields,
  classification_criteria,
  created_at,
  updated_at
)
VALUES (
  'nexus',
  'nexus',
  'Nexus Investimentos',
  '[
    {"key": "interesse", "label": "Produto de interesse", "type": "text"},
    {"key": "objetivo", "label": "Objetivo financeiro", "type": "text"},
    {"key": "cidade", "label": "Cidade", "type": "text"},
    {"key": "estado", "label": "Estado", "type": "text"},
    {"key": "volume", "label": "Capital disponível", "type": "text"},
    {"key": "prazo", "label": "Horizonte de investimento", "type": "text"},
    {"key": "perfil_risco", "label": "Perfil de risco", "type": "text"},
    {"key": "melhor_horario", "label": "Melhor horário", "type": "text"}
  ]'::jsonb,
  '["interesse", "objetivo", "volume", "prazo", "perfil_risco", "melhor_horario"]'::jsonb,
  '{"QUENTE": "volume alto, prazo definido, objetivo claro", "MORNO": "interesse real, sem volume ou sem urgência", "FRIO": "curiosidade sem capital definido"}'::jsonb,
  now(),
  now()
)
ON CONFLICT (client_id, template_key) DO NOTHING;
