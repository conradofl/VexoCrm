-- Trilha do cliente da Geração Digital (03/11/2026, decisão do dono).
--
-- acao_do_cliente: as três etapas em que a bola está com o cliente. A trilha pinta essas etapas
-- com cor própria e troca o aviso ("Agora é com você" no portal, "Esperando o cliente" no interno).
--
-- rotulo_portal: o que o cliente lê. Nunca nome interno nem nome de quem revisa dentro da agência.
-- A lista antiga também repetia dois rótulos em etapas diferentes ("Montando seu briefing" e
-- "Aguardando sua aprovação"), o que faria o cliente achar que não saiu do lugar.
--
-- Casa POR CÓDIGO. Se algum dos 18 códigos não existir, a migration para com o nome dele em vez de
-- adivinhar. A tela não depende desta coluna: a rota só manda acao_do_cliente quando ela existe, e
-- sem o campo nenhuma etapa vira ação do cliente.

ALTER TABLE public.gd_estados
  ADD COLUMN IF NOT EXISTS acao_do_cliente boolean NOT NULL DEFAULT false;

DO $$
DECLARE
  faltam text;
BEGIN
  SELECT string_agg(c, ', ' ORDER BY c) INTO faltam
    FROM unnest(ARRAY[
      'PROPOSTA_ENVIADA', 'PROPOSTA_ACEITA', 'CONTRATO_EM_REVISAO', 'AGUARDANDO_ASSINATURA_CAIO',
      'AGUARDANDO_ASSINATURA_CLIENTE', 'ASSINADO', 'GRUPOS_CRIADOS', 'BRIEFING_AGENDADO',
      'BRIEFING_REALIZADO', 'BRIEFING_APROVACAO_INTERNA', 'BRIEFING_APROVACAO_CLIENTE',
      'IDENTIDADE_VISUAL', 'ROTEIRO', 'PLANEJAMENTO_APROVACAO', 'ESTRATEGIA_APROVADA', 'ATIVO',
      'PAUSADO', 'ENCERRADO'
    ]) AS c
   WHERE NOT EXISTS (SELECT 1 FROM public.gd_estados e WHERE e.codigo = c);
  IF faltam IS NOT NULL THEN
    RAISE EXCEPTION 'gd_estados sem os códigos: %. Nada foi alterado.', faltam;
  END IF;
END $$;

UPDATE public.gd_estados
   SET acao_do_cliente = (codigo IN ('AGUARDANDO_ASSINATURA_CLIENTE', 'BRIEFING_APROVACAO_CLIENTE', 'PLANEJAMENTO_APROVACAO')),
       updated_at = now()
 WHERE acao_do_cliente IS DISTINCT FROM (codigo IN ('AGUARDANDO_ASSINATURA_CLIENTE', 'BRIEFING_APROVACAO_CLIENTE', 'PLANEJAMENTO_APROVACAO'));

UPDATE public.gd_estados e
   SET rotulo_portal = v.rotulo,
       updated_at = now()
  FROM (VALUES
    ('PROPOSTA_ENVIADA',              'Proposta enviada'),
    ('PROPOSTA_ACEITA',               'Proposta aceita'),
    ('CONTRATO_EM_REVISAO',           'Contrato em preparação'),
    ('AGUARDANDO_ASSINATURA_CAIO',    'Aguardando nossa assinatura'),
    ('AGUARDANDO_ASSINATURA_CLIENTE', 'Aguardando sua assinatura'),
    ('ASSINADO',                      'Contrato assinado'),
    ('GRUPOS_CRIADOS',                'Equipe montada'),
    ('BRIEFING_AGENDADO',             'Briefing agendado'),
    ('BRIEFING_REALIZADO',            'Briefing em elaboração'),
    ('BRIEFING_APROVACAO_INTERNA',    'Briefing em revisão'),
    ('BRIEFING_APROVACAO_CLIENTE',    'Briefing para sua aprovação'),
    ('IDENTIDADE_VISUAL',             'Identidade visual'),
    ('ROTEIRO',                       'Roteiro em produção'),
    ('PLANEJAMENTO_APROVACAO',        'Planejamento para sua aprovação'),
    ('ESTRATEGIA_APROVADA',           'Estratégia aprovada'),
    ('ATIVO',                         'Tudo rodando'),
    ('PAUSADO',                       'Atendimento pausado'),
    ('ENCERRADO',                     'Atendimento encerrado')
  ) AS v(codigo, rotulo)
 WHERE e.codigo = v.codigo
   AND e.rotulo_portal IS DISTINCT FROM v.rotulo;
