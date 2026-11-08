/**
 * gdAgentBuilderService.js
 *
 * Módulo Gerador do Prompt do Agente Inbound nos 4 Pilares da IA (Frente 6).
 * Combina os 4 Pilares estruturados com o FAQ minerado do WhatsApp, define as regras
 * de qualificação e transbordo (passagem de bastão para o fechador humano) e constrói
 * o System Prompt definitivo do agente de vendas Vexo OS.
 *
 * Responsável também pela gravação e consolidação na tabela de agentes inbound
 * (`followup_companies`) e vinculação à instância do WhatsApp do cliente.
 */

import { GD_DONO } from "../domains/gdClientes/campos.js";

/**
 * Constrói o System Prompt de vendas definitivo do agente inbound Vexo
 * baseado rigorosamente nos 4 Pilares da IA e na inteligência minerada.
 *
 * @param {object} params
 * @param {object} params.cliente - Registro do cliente
 * @param {object} params.pilares - Os 4 pilares do briefing
 * @param {object} [params.mineracao] - Dados minerados do WhatsApp
 * @param {object} [params.chips] - Configuração dos chips virtuais
 * @param {string} [params.transbordoNumero] - Número do WhatsApp do fechador humano
 * @param {string} [params.tomDeVoz] - Tom de voz personalizado
 * @param {Array} [params.regrasQualificacao] - Regras personalizadas de qualificação
 * @returns {string} System Prompt completo e diretivo para a IA de atendimento
 */
export function montarSystemPromptAgenteVexo({
  cliente = {},
  pilares = {},
  mineracao = {},
  chips = {},
  transbordoNumero = "",
  tomDeVoz = "consultivo, dinâmico, seguro e acolhedor",
  regrasQualificacao = [],
}) {
  const nomeCliente = cliente?.nome || "Nossa Empresa";

  // Pilar 1: O que a empresa vende (produtos/serviços)
  const pilar1 =
    pilares?.pilar1_o_que_vende ||
    mineracao?.pilares_identificados?.pilar1_o_que_vende ||
    `Soluções, produtos e serviços especializados oferecidos por ${nomeCliente}.`;

  // Pilar 2: Faixa de preço e formas de pagamento
  const pilar2 =
    pilares?.pilar2_precos_pagamento ||
    mineracao?.pilares_identificados?.pilar2_precos_pagamento ||
    "Condições comerciais facilitadas via Pix, parcelamento no cartão e boleto bancário.";

  // Pilar 3: Prazos de entrega / execução
  const pilar3 =
    pilares?.pilar3_prazos_entrega ||
    mineracao?.pilares_identificados?.pilar3_prazos_entrega ||
    "Prazos alinhados e transparentes conforme o escopo e a demanda solicitada.";

  // Pilar 4: FAQ estruturado refinado pelo histórico de WhatsApp
  const rawFaq =
    pilares?.pilar4_faq ||
    mineracao?.pilares_identificados?.pilar4_faq ||
    mineracao?.duvidas_frequentes ||
    [];

  const faqFormatado = Array.isArray(rawFaq)
    ? rawFaq
        .map((item, idx) => {
          const pergunta = item?.pergunta || item?.q || `Dúvida comercial ${idx + 1}`;
          const resposta = item?.resposta || item?.resposta_observada || item?.a || "Resposta padrão.";
          return `  [DÚVIDA ${idx + 1}]: "${pergunta}"\n  -> [RESPOSTA PADRÃO]: ${resposta}`;
        })
        .join("\n\n")
    : String(rawFaq);

  // Objeções de compra e como contornar
  const rawObjecoes = pilares?.objecoes || mineracao?.objecoes_recorrentes || [];
  const objecoesFormatadas = Array.isArray(rawObjecoes) && rawObjecoes.length > 0
    ? rawObjecoes
        .map((o, idx) => {
          const obj = o?.objecao || o?.titulo || `Objeção ${idx + 1}`;
          const contorno = o?.como_contornar || o?.resposta || "Argumentação de valor diferenciada.";
          return `  - Objeção: "${obj}"\n    Argumento recomendado: ${contorno}`;
        })
        .join("\n")
    : "  - Manter postura segura e demonstrar custo-benefício, confiabilidade e qualidade dos resultados.";

  // Termos e gírias do nicho
  const rawTermos = pilares?.termos_girias || mineracao?.termos_e_girias || [];
  const termosFormatados = Array.isArray(rawTermos) && rawTermos.length > 0
    ? rawTermos
        .map((t) => (typeof t === "string" ? t : `${t.termo} (${t.significado || "termo técnico"})`))
        .join(", ")
    : "Terminologia padrão do segmento.";

  // Regras de qualificação
  const spinQualificacao = Array.isArray(regrasQualificacao) && regrasQualificacao.length > 0
    ? regrasQualificacao.map((r, i) => `${i + 1}. ${r}`).join("\n")
    : `1. Entender a real necessidade e momento de compra do cliente.
2. Identificar o volume, modelo ou tipo de produto/serviço desejado.
3. Confirmar a urgência ou prazo esperado para início/recebimento.`;

  // Configuração da passagem de bastão (transbordo)
  const transbordoInstrucao = transbordoNumero
    ? `Quando o lead estiver devidamente qualificado, manifestar decisão imediata de fechamento, solicitar proposta formal personalizada ou pedir para falar com um atendente humano:
1. Responda com cordialidade confirmando os dados coletados.
2. Informe que o especialista responsável irá assumir o atendimento para formalizar os detalhes finais.
3. Transbordo acionado para o número: ${transbordoNumero}.`
    : `Quando o cliente solicitar atendimento humano ou fechamento, direcione para a equipe de vendas interna mantendo o tom prestativo e profissional.`;

  return `# SYSTEM PROMPT - AGENTE DE VENDAS INBOUND (${nomeCliente.toUpperCase()})
Desenvolvido via Vexo OS · Briefing Comercial e Motor de 4 Pilares

## 1. IDENTIDADE E PROPÓSITO
Você é o Consultor Comercial e Especialista de Vendas da empresa "${nomeCliente}".
Seu objetivo é acolher os clientes no WhatsApp, responder suas dúvidas com rapidez e precisão, contornar objeções e conduzir o lead para o fechamento comercial ou transbordo qualificado.
- Tom de voz: ${tomDeVoz}.
- Linguagem do nicho: Utilize naturalmente os seguintes termos e jargões quando aplicável: [${termosFormatados}].

---

## 2. OS 4 PILARES DA OPERAÇÃO

### PILAR 1: O QUE A EMPRESA VENDE (PRODUTOS & SERVIÇOS)
${pilar1}

### PILAR 2: FAIXA DE PREÇO E FORMAS DE PAGAMENTO
${pilar2}

### PILAR 3: PRAZOS DE ENTREGA E EXECUÇÃO
${pilar3}

### PILAR 4: FAQ ESTRUTURADO REFINADO PELO HISTÓRICO DE WHATSAPP
${faqFormatado || "Esclareça dúvidas técnicas e comerciais com base estrita no catálogo e valores da empresa."}

---

## 3. TRATAMENTO DE OBJEÇÕES DE COMPRA
Utilize estes direcionamentos estratégicos ao identificar hesitação ou resistência:
${objecoesFormatadas}

---

## 4. FLUXO DE QUALIFICAÇÃO DO LEAD (SDR DE IA)
Não despeje todas as informações de uma vez. Faça perguntas curtas e diretas para qualificar o prospect:
${spinQualificacao}

---

## 5. PASSAGEM DE BASTÃO (TRANSBORDO HUMANO)
${transbordoInstrucao}

---

## 6. GUARDRAILS E DIRETRIZES DE SEGURANÇA
- JAMAIS invente valores, descontos ou condições de pagamento que não estejam expressamente descritos no Pilar 2.
- JAMAIS prometa prazos fora do padrão estipulado no Pilar 3.
- Se o cliente perguntar algo completamente fora do escopo ou dos 4 pilares, informe com educação que irá checar com a equipe técnica e oriente o transbordo.
- Mantenha mensagens concisas e ideais para a leitura no WhatsApp (evite blocos gigantescos de texto).
`;
}

/**
 * Salva os 4 pilares, compõe o prompt definitivo e ativa o agente inbound
 * na tabela `followup_companies`, vinculando às instâncias Evolution de WhatsApp.
 *
 * @param {object} params
 * @param {object} params.pool - Pool de conexão PostgreSQL
 * @param {string} params.clienteId - UUID do cliente em gd_clientes
 * @param {object} params.pilares - Os 4 pilares preenchidos
 * @param {object} [params.chips] - Chips virtuais configurados
 * @param {string} [params.transbordoNumero] - Telefone do atendente humano
 * @param {string} [params.instanceName] - Instância de WhatsApp primária
 * @param {Array<string>} [params.instances] - Lista de instâncias de WhatsApp
 * @param {string} [params.model="gemini-flash-latest"] - Modelo LLM
 * @param {object} [params.actor] - Ator que realizou a ação
 * @returns {Promise<object>}
 */
export async function construirEAtivarAgenteInbound({
  pool,
  clienteId,
  pilares = {},
  chips = null,
  transbordoNumero = null,
  instanceName = null,
  instances = [],
  model = "gemini-flash-latest",
  actor = { id: "sistema", tipo: "sistema" },
}) {
  if (!pool) throw new Error("Pool de banco de dados obrigatório.");
  if (!clienteId) throw new Error("clienteId obrigatório.");

  // 1. Busca os dados atuais do cliente
  const { rows } = await pool.query(
    `SELECT id, nome, dono_client_id, cliente_client_id, vexto_briefing_agente_id,
            vexto_briefing_mineracao, vexto_briefing_chips, vexto_briefing_transbordo_numero,
            estado_atual
     FROM public.gd_clientes
     WHERE id = $1`,
    [clienteId]
  );

  if (rows.length === 0) {
    throw new Error(`Cliente não encontrado para o ID: ${clienteId}`);
  }

  const cliente = rows[0];
  const mineracao = cliente.vexto_briefing_mineracao || {};

  // Determina chips e transbordo mesclando novos com já existentes
  const effectiveChips = chips || cliente.vexto_briefing_chips || {
    chips: [],
    quantidade_recomendada: "2 a 3 chips virtuais de proteção contra restrição",
    responsavel_tecnico: "Gabriel (até 72h após contratação)",
    status: "CONFIGURADO",
  };

  const effectiveTransbordo = transbordoNumero || cliente.vexto_briefing_transbordo_numero || null;

  // 2. Monta o System Prompt Definitivo
  const promptGerado = montarSystemPromptAgenteVexo({
    cliente,
    pilares,
    mineracao,
    chips: effectiveChips,
    transbordoNumero: effectiveTransbordo,
  });

  // 3. Resolve instâncias Evolution
  const listaInstancias = Array.isArray(instances) && instances.length > 0
    ? instances
    : instanceName
      ? [instanceName]
      : [];

  const instanciaPrimaria = instanceName || listaInstancias[0] || null;

  // 4. Resolve o tenant_id para followup_companies
  const tenantId = cliente.cliente_client_id || cliente.dono_client_id || GD_DONO;

  let agenteId = cliente.vexto_briefing_agente_id;

  // 5. Grava ou atualiza em followup_companies
  const instanciasJson = listaInstancias.length > 0 ? JSON.stringify(listaInstancias) : null;

  if (agenteId) {
    const { rows: updateRows } = await pool.query(
      `UPDATE public.followup_companies
       SET name = $1,
           evolution_instance = COALESCE($2, evolution_instance),
           evolution_instances = COALESCE($3::jsonb, evolution_instances),
           inbound_enabled = true,
           inbound_model = $4,
           inbound_prompt = $5,
           sdr_whatsapp_number = $6,
           sdr_transfer_enabled = $7,
           instructions_consolidated_at = now(),
           agent_kind = 'atendimento',
           inbound_role = 'qualificador',
           updated_at = now()
       WHERE id = $8
       RETURNING id`,
      [
        `Agente Vexo - ${cliente.nome}`,
        instanciaPrimaria,
        instanciasJson,
        model,
        promptGerado,
        effectiveTransbordo,
        Boolean(effectiveTransbordo),
        agenteId,
      ]
    );

    if (updateRows.length > 0) {
      agenteId = updateRows[0].id;
    }
  }

  // Se não atualizou ou não tinha agenteId, tenta buscar existente ou criar
  if (!agenteId) {
    const { rows: existingRows } = await pool.query(
      `SELECT id FROM public.followup_companies
       WHERE tenant_id = $1 AND archived_at IS NULL
       ORDER BY updated_at DESC LIMIT 1`,
      [tenantId]
    );

    if (existingRows.length > 0) {
      agenteId = existingRows[0].id;
      await pool.query(
        `UPDATE public.followup_companies
         SET name = $1,
             evolution_instance = COALESCE($2, evolution_instance),
             evolution_instances = COALESCE($3::jsonb, evolution_instances),
             inbound_enabled = true,
             inbound_model = $4,
             inbound_prompt = $5,
             sdr_whatsapp_number = $6,
             sdr_transfer_enabled = $7,
             instructions_consolidated_at = now(),
             agent_kind = 'atendimento',
             inbound_role = 'qualificador',
             updated_at = now()
         WHERE id = $8`,
        [
          `Agente Vexo - ${cliente.nome}`,
          instanciaPrimaria,
          instanciasJson,
          model,
          promptGerado,
          effectiveTransbordo,
          Boolean(effectiveTransbordo),
          agenteId,
        ]
      );
    } else {
      const { rows: insertRows } = await pool.query(
        `INSERT INTO public.followup_companies (
           tenant_id, name, evolution_instance, evolution_instances,
           inbound_enabled, inbound_model, inbound_prompt,
           sdr_whatsapp_number, sdr_transfer_enabled,
           instructions_consolidated_at, agent_kind, inbound_role
         ) VALUES ($1, $2, $3, COALESCE($4::jsonb, '[]'::jsonb), true, $5, $6, $7, $8, now(), 'atendimento', 'qualificador')
         RETURNING id`,
        [
          tenantId,
          `Agente Vexo - ${cliente.nome}`,
          instanciaPrimaria,
          instanciasJson,
          model,
          promptGerado,
          effectiveTransbordo,
          Boolean(effectiveTransbordo),
        ]
      );
      agenteId = insertRows[0]?.id;
    }
  }

  // 6. Atualiza o registro em gd_clientes
  await pool.query(
    `UPDATE public.gd_clientes
     SET vexto_briefing_pilares = $1::jsonb,
         vexto_briefing_chips = $2::jsonb,
         vexto_briefing_transbordo_numero = $3,
         vexto_briefing_prompt_gerado = $4,
         vexto_briefing_agente_id = $5,
         vexto_briefing_status = 'AGENTE_ATIVADO'
     WHERE id = $6`,
    [
      JSON.stringify(pilares),
      JSON.stringify(effectiveChips),
      effectiveTransbordo,
      promptGerado,
      agenteId,
      clienteId,
    ]
  );

  // 7. Registra evento de histórico
  if (cliente.estado_atual) {
    try {
      await pool.query(
        `SELECT public.gd_registrar_evento($1, $2, now(), false, 'fluxo', $3, $4, $5, $6::jsonb)`,
        [
          clienteId,
          cliente.estado_atual,
          actor.tipo || "sistema",
          actor.id || "sistema",
          "Briefing Comercial Vexo configurado com sucesso nos 4 Pilares da IA. Agente Inbound ativado e pronto para atendimento.",
          JSON.stringify({
            agente_id: agenteId,
            instancias: listaInstancias,
            transbordo: effectiveTransbordo,
            status: "AGENTE_ATIVADO",
          }),
        ]
      );
    } catch (errEvento) {
      console.warn("[gdAgentBuilder] Falha não crítica ao registrar evento no histórico:", errEvento.message);
    }
  }

  return {
    success: true,
    cliente_id: clienteId,
    agente_id: agenteId,
    status: "AGENTE_ATIVADO",
    prompt_gerado: promptGerado,
    chips_configurados: effectiveChips,
    transbordo_numero: effectiveTransbordo,
  };
}
