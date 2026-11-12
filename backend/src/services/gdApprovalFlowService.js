/**
 * gdApprovalFlowService.js
 *
 * Fluxo de Validação e Aprovação no WhatsApp (Frente 5).
 * Gerencia a máquina de estados de aprovação em duas etapas:
 *
 * 1. Aprovação Interna (Grupo PASTA: {CLIENTE}):
 *    - Envia os 4 documentos gerados pelo Gemini marcando o Caio (@caioalmeida).
 *    - Reconhece os comandos de resposta:
 *        • "Aprovado" -> Marca aprovado e dispara no grupo do cliente.
 *        • "Com ressalvas: [detalhes]" -> Registra status de ressalva.
 *        • "Ressalva concluída" -> Conclui ressalvas e dispara no grupo do cliente.
 *
 * 2. Aprovação do Cliente (Grupo MÁQUINA DE VENDAS: {CLIENTE}):
 *    - Envia o Briefing Consolidado e o Planejamento Trimestral solicitando o aceite formal.
 *    - Reconhece o comando de aceite ("Aprovado", "De acordo", "Validado").
 *    - Avança a trilha do cliente para ESTRATEGIA_APROVADA e notifica ambos os grupos.
 */

import { sendTextMessageViaEvolution } from "./evolution.js";
import { GD_DONO } from "../domains/gdClientes/campos.js";

export const GD_CAIO_TAG = "@caioalmeida";
export const GD_CAIO_WHATSAPP_NUMERO = process.env.GD_CAIO_WHATSAPP || "5534997798725";

export const APROVACAO_STATUS = {
  PENDENTE: "PENDENTE",
  COM_RESSALVAS: "COM_RESSALVAS",
  APROVADO: "APROVADO",
};

/**
 * Interpreta o comando de resposta no WhatsApp
 */
export function interpretarComandoAprovacao(texto) {
  if (!texto || typeof texto !== "string") return { tipo: "DESCONHECIDO" };
  const t = texto.trim();

  // 1. Ressalva Concluída
  if (
    /^(?:ressalvas?\s+conclu[íi]das?|ressalvas?\s+resolvidas?|ajustes?\s+conclu[íi]dos?|ajustes?\s+feitos?|corrigido|ressalva\s+ok)\b/i.test(t)
  ) {
    return { tipo: "RESSALVA_CONCLUIDA" };
  }

  // 2. Com Ressalvas
  const matchRessalva = t.match(/^(?:com\s+ressalvas?|ressalvas?:?|ajustar:?|alterar:?|corre[çc][ãa]o:?)(?:\s*[:\-–]\s*|\s+)(.*)$/i);
  if (matchRessalva) {
    return {
      tipo: "COM_RESSALVAS",
      detalhes: matchRessalva[1]?.trim() || "Ressalvas apontadas sem detalhamento específico.",
    };
  }
  if (/^com\s+ressalvas?$/i.test(t) || /^ressalvas?$/i.test(t)) {
    return {
      tipo: "COM_RESSALVAS",
      detalhes: "Ressalvas solicitadas pelo aprovador.",
    };
  }

  // 3. Aprovado / De acordo
  if (
    /^(?:ok[,.]?\s*)?(?:aprovado|aprovada|aprovo|aprovados|aprovadissimo|de\s+acordo|pode\s+seguir|validado|1️⃣|1\b|👍|check)/i.test(t)
  ) {
    return { tipo: "APROVADO" };
  }

  return { tipo: "DESCONHECIDO" };
}

/**
 * Disparo dos 4 documentos no grupo interno PASTA: {CLIENTE} marcando o Caio
 */
export async function enviarDocumentosParaAprovacaoInterna({
  clienteId,
  pool,
  instanceName = null,
  evolutionSender = sendTextMessageViaEvolution,
  actor = { id: "sistema", tipo: "sistema" },
}) {
  if (!clienteId || !pool) {
    throw new Error("clienteId e pool são obrigatórios.");
  }

  const { rows } = await pool.query(
    `SELECT * FROM public.gd_clientes WHERE id = $1 AND (dono_client_id = $2 OR dono_client_id = '00000000-0000-0000-0000-000000000000' OR dono_client_id IS NULL)`,
    [clienteId, GD_DONO]
  );

  if (rows.length === 0) {
    throw new Error("Cliente não encontrado.");
  }

  const cliente = rows[0];
  const jidInterno = cliente.grupo_interno_jid || process.env.GD_CAIO_WHATSAPP || GD_CAIO_WHATSAPP_NUMERO;

  if (!jidInterno) {
    throw new Error("Cliente não possui grupo interno nem WhatsApp de contato configurado.");
  }

  const docs = cliente.briefing_documentos?.documentos || cliente.briefing_documentos || {};
  const linkB = docs.briefing?.pdf?.fileLink || docs.briefing?.pdfUrl || cliente.drive_url || "Disponível no Google Drive";
  const linkBDocx = docs.briefing?.docx?.fileLink || docs.briefing?.docxUrl || cliente.drive_url || "Disponível no Google Drive";
  const linkI = docs.identidade?.pdf?.fileLink || docs.identidade?.pdfUrl || cliente.drive_url || "Disponível no Google Drive";
  const linkIDocx = docs.identidade?.docx?.fileLink || docs.identidade?.docxUrl || cliente.drive_url || "Disponível no Google Drive";
  const linkR = docs.roteiros?.pdf?.fileLink || docs.roteiros?.pdfUrl || cliente.drive_url || "Disponível no Google Drive";
  const linkRDocx = docs.roteiros?.docx?.fileLink || docs.roteiros?.docxUrl || cliente.drive_url || "Disponível no Google Drive";
  const linkP = docs.planejamento?.pdf?.fileLink || docs.planejamento?.pdfUrl || cliente.drive_url || "Disponível no Google Drive";
  const linkPDocx = docs.planejamento?.docx?.fileLink || docs.planejamento?.docxUrl || cliente.drive_url || "Disponível no Google Drive";

  const instance =
    instanceName ||
    process.env.GD_ONBOARDING_EVOLUTION_INSTANCE ||
    process.env.GD_EVOLUTION_INSTANCE ||
    "vexo-adm-vexo-atende";

  const mensagemCaio =
    `📋 *SÍNTESE DE BRIEFING GERADA · APROVAÇÃO INTERNA*\n\n` +
    `Olá, ${GD_CAIO_TAG}! Os 4 documentos estratégicos para *${cliente.nome}* foram sintetizados pelo Gemini com base na transcrição do Meet, formulário Vexo e contrato:\n\n` +
    `📄 *1. Briefing Consolidado Oficial:*\n` +
    `• PDF: ${linkB}\n` +
    `• DOCX: ${linkBDocx}\n\n` +
    `🎨 *2. Identidade Visual & Diretrizes da Marca:*\n` +
    `• PDF: ${linkI}\n` +
    `• DOCX: ${linkIDocx}\n\n` +
    `🎬 *3. Roteiros de Conteúdo (3 Meses / 60 Criativos):*\n` +
    `• PDF: ${linkR}\n` +
    `• DOCX: ${linkRDocx}\n\n` +
    `📊 *4. Planejamento Trimestral Visual (Roadmap 90D):*\n` +
    `• PDF: ${linkP}\n` +
    `• DOCX: ${linkPDocx}\n\n` +
    `───────────────────────\n` +
    `*COMO VALIDAR NO GRUPO:*\n` +
    `👉 Para aprovar integralmente: responda *Aprovado*\n` +
    `👉 Se houver ajustes: responda *Com ressalvas: [seus apontamentos]*\n` +
    `👉 Após concluir edições: responda *Ressalva concluída*`;

  await evolutionSender({
    instanceName: instance,
    number: jidInterno,
    text: mensagemCaio,
  });

  await pool.query(
    `UPDATE public.gd_clientes
        SET briefing_aprovacao_interna_status = 'PENDENTE',
            briefing_aprovacao_interna_ressalvas = NULL
      WHERE id = $1 AND (dono_client_id = $2 OR dono_client_id = '00000000-0000-0000-0000-000000000000' OR dono_client_id IS NULL)`,
    [clienteId, GD_DONO]
  );

  // Se o cliente ainda não estiver em BRIEFING_APROVACAO_INTERNA, transiciona o estado
  if (cliente.estado_atual === "BRIEFING_REALIZADO" || cliente.estado_atual === "BRIEFING_AGENDADO") {
    try {
      await pool.query(
        `SELECT public.gd_registrar_evento($1, 'BRIEFING_APROVACAO_INTERNA', now(), false, 'fluxo', $2, $3, $4, $5::jsonb)`,
        [
          clienteId,
          actor.tipo || "sistema",
          actor.id || "sistema",
          "Documentos de briefing enviados no grupo interno para aprovação do Caio.",
          JSON.stringify({
            grupo_interno_jid: jidInterno,
            versao: cliente.briefing_documentos?.versao || null,
          }),
        ]
      );
    } catch (e) {
      console.warn("[gdApprovalFlow] Aviso ao registrar evento BRIEFING_APROVACAO_INTERNA:", e.message);
    }
  }

  return {
    success: true,
    clienteId,
    grupo_interno_jid: jidInterno,
    mensagem: mensagemCaio,
  };
}

/**
 * Disparo subsequente no grupo do cliente MÁQUINA DE VENDAS: {CLIENTE} para aceite formal
 */
export async function enviarDocumentosParaAprovacaoCliente({
  clienteId,
  pool,
  instanceName = null,
  evolutionSender = sendTextMessageViaEvolution,
  actor = { id: "sistema", tipo: "sistema" },
}) {
  if (!clienteId || !pool) {
    throw new Error("clienteId e pool são obrigatórios.");
  }

  const { rows } = await pool.query(
    `SELECT * FROM public.gd_clientes WHERE id = $1 AND (dono_client_id = $2 OR dono_client_id = '00000000-0000-0000-0000-000000000000' OR dono_client_id IS NULL)`,
    [clienteId, GD_DONO]
  );

  if (rows.length === 0) {
    throw new Error("Cliente não encontrado.");
  }

  const cliente = rows[0];
  const jidCliente = cliente.grupo_cliente_jid || cliente.aprovador_telefone;

  if (!jidCliente) {
    throw new Error("Cliente não possui grupo de atendimento (grupo_cliente_jid) nem telefone de aprovador configurado.");
  }

  const docs = cliente.briefing_documentos?.documentos || cliente.briefing_documentos || {};
  const linkB = docs.briefing?.pdf?.fileLink || docs.briefing?.pdfUrl || cliente.drive_url || "Disponível no Google Drive";
  const linkBDocx = docs.briefing?.docx?.fileLink || docs.briefing?.docxUrl || cliente.drive_url || "Disponível no Google Drive";
  const linkP = docs.planejamento?.pdf?.fileLink || docs.planejamento?.pdfUrl || cliente.drive_url || "Disponível no Google Drive";
  const linkPDocx = docs.planejamento?.docx?.fileLink || docs.planejamento?.docxUrl || cliente.drive_url || "Disponível no Google Drive";

  const instance =
    instanceName ||
    process.env.GD_ONBOARDING_EVOLUTION_INSTANCE ||
    process.env.GD_EVOLUTION_INSTANCE ||
    "vexo-adm-vexo-atende";

  const tagCliente = cliente.aprovador_telefone
    ? `@${cliente.aprovador_telefone}`
    : cliente.aprovador_nome || cliente.nome;

  const mensagemCliente =
    `🎯 *SEU BRIEFING CONSOLIDADO & PLANEJAMENTO TRIMESTRAL ESTÃO PRONTOS!*\n\n` +
    `Olá, ${tagCliente} (${cliente.aprovador_nome || cliente.nome})! A nossa equipe estratégica finalizou a consolidação do seu Briefing e o Planejamento Visual dos próximos 90 dias com base na nossa reunião:\n\n` +
    `📄 *1. Briefing Consolidado Oficial:*\n` +
    `• Versão PDF: ${linkB}\n` +
    `• Versão DOCX: ${linkBDocx}\n\n` +
    `📊 *2. Planejamento Trimestral Visual:*\n` +
    `• Versão PDF: ${linkP}\n` +
    `• Versão DOCX: ${linkPDocx}\n\n` +
    `───────────────────────\n` +
    `*PRÓXIMO PASSO:*\n` +
    `Por favor, acesse os materiais acima para conferir o plano. Estando de acordo, responda aqui neste grupo com *Aprovado* para darmos início imediato à produção! 🚀\n` +
    `Se tiver qualquer dúvida ou consideração, basta nos enviar aqui.`;

  await evolutionSender({
    instanceName: instance,
    number: jidCliente,
    text: mensagemCliente,
  });

  await pool.query(
    `UPDATE public.gd_clientes
        SET briefing_aprovacao_cliente_status = 'PENDENTE'
      WHERE id = $1 AND (dono_client_id = $2 OR dono_client_id = '00000000-0000-0000-0000-000000000000' OR dono_client_id IS NULL)`,
    [clienteId, GD_DONO]
  );

  // Transiciona o estado do cliente para BRIEFING_APROVACAO_CLIENTE
  try {
    await pool.query(
      `SELECT public.gd_registrar_evento($1, 'BRIEFING_APROVACAO_CLIENTE', now(), false, 'fluxo', $2, $3, $4, $5::jsonb)`,
      [
        clienteId,
        actor.tipo || "sistema",
        actor.id || "sistema",
        "Briefing e Planejamento enviados no grupo oficial para aprovação do cliente.",
        JSON.stringify({
          grupo_cliente_jid: jidCliente,
          versao: cliente.briefing_documentos?.versao || null,
        }),
      ]
    );
  } catch (e) {
    console.warn("[gdApprovalFlow] Aviso ao registrar evento BRIEFING_APROVACAO_CLIENTE:", e.message);
  }

  return {
    success: true,
    clienteId,
    grupo_cliente_jid: jidCliente,
    mensagem: mensagemCliente,
  };
}

/**
 * Processador central de mensagens do WhatsApp recebidas via Webhook da Evolution
 */
export async function processarMensagemAprovacaoWhatsApp({
  pool,
  groupJid,
  text,
  senderJid = null,
  instanceName = null,
  evolutionSender = sendTextMessageViaEvolution,
  actor = { id: "webhook_whatsapp", tipo: "goclaw" },
}) {
  if (!pool || !groupJid || !text) return { handled: false, reason: "parametros_insuficientes" };

  const cmd = interpretarComandoAprovacao(text);
  if (cmd.tipo === "DESCONHECIDO") {
    return { handled: false, reason: "comando_nao_reconhecido" };
  }

  const instance =
    instanceName ||
    process.env.GD_ONBOARDING_EVOLUTION_INSTANCE ||
    process.env.GD_EVOLUTION_INSTANCE ||
    "vexo-adm-vexo-atende";

  // 1. Verifica se a mensagem veio de um grupo interno (PASTA: {CLIENTE})
  const { rows: clientesInternos } = await pool.query(
    `SELECT * FROM public.gd_clientes
      WHERE grupo_interno_jid = $1
        AND dono_client_id = $2
      LIMIT 1`,
    [groupJid, GD_DONO]
  );

  if (clientesInternos.length > 0) {
    const cliente = clientesInternos[0];

    // Case 1A: Caio aprovou
    if (cmd.tipo === "APROVADO") {
      await pool.query(
        `UPDATE public.gd_clientes
            SET briefing_aprovacao_interna_status = 'APROVADO',
                briefing_aprovacao_interna_em = now(),
                briefing_aprovacao_interna_ressalvas = NULL
          WHERE id = $1`,
        [cliente.id]
      );

      const msgConfirmaInterno =
        `✅ *Aprovado por Caio Almeida!*\n\n` +
        `O material para *${cliente.nome}* foi validado internamente com sucesso.\n` +
        `Disparando agora o Briefing Consolidado e o Planejamento Trimestral no grupo oficial do cliente para aceite formal. 🚀`;

      await evolutionSender({
        instanceName: instance,
        number: groupJid,
        text: msgConfirmaInterno,
      });

      // Dispara automaticamente para o grupo do cliente
      await enviarDocumentosParaAprovacaoCliente({
        clienteId: cliente.id,
        pool,
        instanceName: instance,
        evolutionSender,
        actor,
      });

      return {
        handled: true,
        tipo: "INTERNO",
        clienteId: cliente.id,
        acao: "APROVADO_INTERNO",
      };
    }

    // Case 1B: Caio respondeu com ressalvas
    if (cmd.tipo === "COM_RESSALVAS") {
      await pool.query(
        `UPDATE public.gd_clientes
            SET briefing_aprovacao_interna_status = 'COM_RESSALVAS',
                briefing_aprovacao_interna_ressalvas = $1
          WHERE id = $2`,
        [cmd.detalhes, cliente.id]
      );

      const msgRessalva =
        `⚠️ *Ressalvas Registradas com Sucesso!*\n\n` +
        `• *Cliente:* ${cliente.nome}\n` +
        `• *Apontamentos:* ${cmd.detalhes}\n\n` +
        `Assim que as edições forem concluídas nos documentos do Google Drive, responda aqui *Ressalva concluída* para liberarmos o envio ao cliente. ✍️`;

      await evolutionSender({
        instanceName: instance,
        number: groupJid,
        text: msgRessalva,
      });

      return {
        handled: true,
        tipo: "INTERNO",
        clienteId: cliente.id,
        acao: "COM_RESSALVAS_INTERNO",
        detalhes: cmd.detalhes,
      };
    }

    // Case 1C: Ressalva concluída
    if (cmd.tipo === "RESSALVA_CONCLUIDA") {
      await pool.query(
        `UPDATE public.gd_clientes
            SET briefing_aprovacao_interna_status = 'APROVADO',
                briefing_aprovacao_interna_em = now()
          WHERE id = $1`,
        [cliente.id]
      );

      const msgRessalvaOk =
        `🚀 *Ressalvas Concluídas!*\n\n` +
        `Ajustes finalizados e aprovados internamente para *${cliente.nome}*.\n` +
        `Disparando agora no grupo do cliente para aceite formal. ✨`;

      await evolutionSender({
        instanceName: instance,
        number: groupJid,
        text: msgRessalvaOk,
      });

      // Dispara automaticamente para o grupo do cliente
      await enviarDocumentosParaAprovacaoCliente({
        clienteId: cliente.id,
        pool,
        instanceName: instance,
        evolutionSender,
        actor,
      });

      return {
        handled: true,
        tipo: "INTERNO",
        clienteId: cliente.id,
        acao: "RESSALVA_CONCLUIDA_INTERNO",
      };
    }
  }

  // 2. Verifica se a mensagem veio do grupo do cliente (MÁQUINA DE VENDAS: {CLIENTE})
  const { rows: clientesCliente } = await pool.query(
    `SELECT * FROM public.gd_clientes
      WHERE grupo_cliente_jid = $1
        AND dono_client_id = $2
        AND briefing_aprovacao_cliente_status = 'PENDENTE'
      LIMIT 1`,
    [groupJid, GD_DONO]
  );

  if (clientesCliente.length > 0) {
    const cliente = clientesCliente[0];

    if (cmd.tipo === "APROVADO") {
      await pool.query(
        `UPDATE public.gd_clientes
            SET briefing_aprovacao_cliente_status = 'APROVADO',
                briefing_aprovacao_cliente_em = now()
          WHERE id = $1`,
        [cliente.id]
      );

      // 1. Mensagem de comemoração no grupo do cliente
      const tagCliente = cliente.aprovador_telefone
        ? `@${cliente.aprovador_telefone}`
        : cliente.aprovador_nome || cliente.nome;

      const msgCelebracaoCliente =
        `🎉 *Estratégia e Briefing Aprovados!*\n\n` +
        `Excelente, ${tagCliente} (${cliente.aprovador_nome || cliente.nome})! A sua aprovação foi registrada com sucesso.\n\n` +
        `Nossa equipe de criação e tráfego já está iniciando a produção da primeira bateria de criativos conforme o cronograma aprovado.\n\n` +
        `Seguimos juntos rumo a grandes resultados! Qualquer novidade avisaremos por aqui. 🚀`;

      await evolutionSender({
        instanceName: instance,
        number: groupJid,
        text: msgCelebracaoCliente,
      });

      // 2. Notifica no grupo interno (PASTA: {CLIENTE})
      if (cliente.grupo_interno_jid) {
        const msgAvisoInterno =
          `🌟 *CLIENTE APROVOU A ESTRATÉGIA!*\n\n` +
          `• *Cliente:* ${cliente.nome}\n` +
          `• *Aprovador:* ${cliente.aprovador_nome || cliente.nome}\n` +
          `• *Status:* ESTRATEGIA_APROVADA\n\n` +
          `Os 4 documentos e o planejamento foram validados pelo cliente. Produção e ativação liberadas! 🎯`;

        try {
          await evolutionSender({
            instanceName: instance,
            number: cliente.grupo_interno_jid,
            text: msgAvisoInterno,
          });
        } catch (e) {
          console.warn("[gdApprovalFlow] Falha ao avisar aprovação no grupo interno:", e.message);
        }
      }

      // 3. Transiciona estado no banco para ESTRATEGIA_APROVADA
      try {
        await pool.query(
          `SELECT public.gd_registrar_evento($1, 'ESTRATEGIA_APROVADA', now(), false, 'fluxo', $2, $3, $4, $5::jsonb)`,
          [
            cliente.id,
            actor.tipo || "sistema",
            actor.id || "sistema",
            "Estratégia e Briefing aprovados formalmente pelo cliente no grupo de WhatsApp.",
            JSON.stringify({
              grupo_cliente_jid: groupJid,
              aprovado_em: new Date().toISOString(),
            }),
          ]
        );
      } catch (e) {
        console.warn("[gdApprovalFlow] Aviso ao registrar evento ESTRATEGIA_APROVADA:", e.message);
      }

      return {
        handled: true,
        tipo: "CLIENTE",
        clienteId: cliente.id,
        acao: "APROVADO_CLIENTE",
      };
    }
  }

  return { handled: false, reason: "nenhum_cliente_em_espera_no_grupo" };
}
