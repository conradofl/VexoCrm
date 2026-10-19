// backend/src/domains/leads/captureRoutes.js
// Rota Pública de Captura de Leads e Diagnóstico Comercial
// Multi-tenant: grava no tenant informado, dispara auto-resposta e notifica equipe.

import {
  checkCaptureRateLimit,
  dispatchCaptureAutoReply,
  formatOwnerAlertMessage,
  formatVisitorDiagnosticMessage,
  maskPhoneForDisplay,
  notifyOwnerOnCapture,
  saveCaptureLead,
  validateCapturePayload,
  TELEMETRY_RATE_LIMIT_MAX,
  TELEMETRY_RATE_LIMIT_WINDOW_MS,
} from "../../services/leadCapture.js";
import { ingestTelemetryEvent } from "../../services/landingPageTelemetry.js";
import { maskPhoneForLog } from "../../services/tenant.js";

/**
 * Registra as rotas públicas de captura de leads.
 * @param {import("express").Express} app
 * @param {object} deps
 */
export function registerLeadCaptureRoutes(app, deps) {
  const { pgDatabasePool, sendError } = deps;

  const handleCapture = async (req, res) => {
    // 1. Identificação do IP do cliente para Rate Limit
    const rawIp = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.ip || "127.0.0.1";
    const clientIp = Array.isArray(rawIp) ? rawIp[0] : String(rawIp).split(",")[0].trim();

    // 2. Trava de Rate Limit por IP (máx 5 envios por hora)
    const isAllowed = checkCaptureRateLimit(clientIp);
    if (!isAllowed) {
      return sendError(
        res,
        429,
        "RATE_LIMIT_EXCEEDED",
        "Limite de envios excedido para o seu endereço IP. Por favor, aguarde alguns minutos antes de tentar novamente."
      );
    }

    // 3. Validação do Payload e Detecção de Bot (Honeypot)
    const validation = validateCapturePayload(req.body);

    if (validation.isBot) {
      // Robô detectado: descarta silenciosamente respondendo 200 (não avisa o bot)
      return res.status(200).json({
        success: true,
        message: "Recebido com sucesso.",
        phoneMasked: "(**) *****-****",
      });
    }

    if (!validation.valid || !validation.data) {
      return sendError(
        res,
        400,
        validation.error || "DADOS_INVALIDOS",
        validation.message || "Por favor, verifique os dados informados."
      );
    }

    const {
      clientId,
      fullName,
      phone,
      email,
      company,
      segment,
      teamSize,
      baseSize,
      ticketMedio,
      stalledLeadsPct,
      responseTime,
      followupProcess,
      mainPain,
      instanceName,
    } = validation.data;

    const pool = pgDatabasePool;
    if (!pool) {
      return sendError(res, 500, "DATABASE_UNAVAILABLE", "Serviço de banco de dados indisponível.");
    }

    try {
      // 4. Salva o Lead no Banco com Multi-tenant estrito e tag 'diagnostico-site'
      const answers = {
        company,
        segment,
        teamSize,
        baseSize,
        ticketMedio,
        stalledLeadsPct,
        responseTime,
        followupProcess,
        mainPain,
      };

      await saveCaptureLead(pool, {
        clientId,
        phone,
        fullName,
        email,
        answers,
      });

      console.log(`[leadCapture] Lead ${fullName} salvo com sucesso para tenant ${clientId} (${maskPhoneForLog(phone)})`);

      // 5. Monta a Mensagem que o Visitante recebe
      const visitorMessage = formatVisitorDiagnosticMessage({
        fullName,
        baseSize,
        responseTime,
        ticketMedio,
        stalledLeadsPct,
      });

      // 6. Dispara UMA mensagem de WhatsApp pelo chip do tenant (em background sem travar o lead)
      dispatchCaptureAutoReply(pool, {
        clientId,
        phone,
        messageText: visitorMessage,
        instanceName,
      })
        .then((dispRes) => {
          if (dispRes.sent) {
            console.log(`[leadCapture] Auto-resposta enviada com sucesso para ${maskPhoneForLog(phone)} via ${dispRes.instanceUsed}`);
          } else if (dispRes.blocked) {
            console.error(`[leadCapture] Auto-resposta bloqueada por segurança (${dispRes.reason}) para ${maskPhoneForLog(phone)}: ${dispRes.message || ""}`);
          } else {
            console.warn(`[leadCapture] Auto-resposta não pôde ser enviada para ${maskPhoneForLog(phone)}: ${dispRes.error}`);
          }
        })
        .catch((dispErr) => {
          console.warn("[leadCapture] Erro assíncrono ao disparar mensagem para visitante:", dispErr?.message || dispErr);
        });

      // 7. Notifica o Dono / Equipe de Vendas do Tenant
      const ownerAlertText = formatOwnerAlertMessage({
        fullName,
        phone,
        email,
        answers,
        clientId,
      });

      notifyOwnerOnCapture(pool, {
        clientId,
        alertText: ownerAlertText,
        chipInstance: instanceName,
      }).catch((notifErr) => {
        console.warn("[leadCapture] Erro assíncrono ao notificar dono/SDR:", notifErr?.message || notifErr);
      });

      // 8. Responde 200 com Confirmação Real e Telefone Mascarado
      const maskedPhone = maskPhoneForDisplay(phone);
      return res.status(200).json({
        success: true,
        message: `Pronto! Te mandamos uma mensagem no WhatsApp ${maskedPhone}. Chega em instantes.`,
        phoneMasked: maskedPhone,
        leadPhone: phone,
      });
    } catch (saveErr) {
      console.error("[leadCapture] Erro ao processar formulário de captura:", saveErr);
      return sendError(
        res,
        500,
        "LEAD_CAPTURE_FAILED",
        "Ocorreu um erro interno ao salvar sua solicitação. Por favor, tente novamente."
      );
    }
  };

  // --------------------------------------------------------------------------
  // Ingestão de Telemetria Comportamental das Páginas de Captação (LGPD-compliant)
  // --------------------------------------------------------------------------
  const handleTelemetry = async (req, res) => {
    // 1. Identificação do IP do cliente para Rate Limit
    const rawIp = req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || req.ip || "127.0.0.1";
    const clientIp = Array.isArray(rawIp) ? rawIp[0] : String(rawIp).split(",")[0].trim();

    // 2. Trava de Rate Limit por IP (reusa o mecanismo da captura, calibrado para telemetria)
    const isAllowed = checkCaptureRateLimit(
      clientIp,
      TELEMETRY_RATE_LIMIT_MAX,
      TELEMETRY_RATE_LIMIT_WINDOW_MS,
      "telemetry"
    );
    if (!isAllowed) {
      return sendError(
        res,
        429,
        "RATE_LIMIT_EXCEEDED",
        "Limite de eventos de telemetria excedido para o seu endereço IP. Por favor, aguarde alguns minutos."
      );
    }

    const { client_id, session_token, event } = req.body || {};
    const pool = pgDatabasePool;
    if (!pool) {
      return sendError(res, 500, "DATABASE_UNAVAILABLE", "Serviço de banco indisponível.");
    }

    try {
      const result = await ingestTelemetryEvent(pool, {
        clientId: client_id,
        sessionToken: session_token,
        event,
      });

      if (!result.recorded) {
        const status = result.error === "CONSENTIMENTO_LGPD_OBRIGATORIO" ? 403 : 400;
        return sendError(res, status, result.error, result.message || "Evento não autorizado.");
      }

      return res.status(200).json({ success: true, message: "Evento registrado com sucesso." });
    } catch (telemetryErr) {
      console.error("[landingTelemetry] Erro ao processar evento de telemetria:", telemetryErr);
      return sendError(
        res,
        500,
        "TELEMETRY_INGESTION_FAILED",
        "Ocorreu um erro interno ao processar o evento de telemetria."
      );
    }
  };

  // Rotas públicas (sem autenticação de usuário da plataforma)
  app.post("/api/public/leads/capture", handleCapture);
  app.post("/api/public/diagnostico", handleCapture);
  app.post("/api/public/landing-pages/telemetry", handleTelemetry);
}
