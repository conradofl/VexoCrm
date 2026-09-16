// Extraído de src/pages/GeracaoDigitalImplementationBriefing.tsx — movimento puro das
// funções de export (PDF/WhatsApp), sem alteração de forma além da correção pedida:
// campo sem input em nenhum dos 5 passos NÃO aparece no documento.
//
// Auditoria (2026-09-16): cruzei cada linha destes dois templates contra os 5 passos
// da tela — todo campo abaixo tinha valor padrão hardcoded no useState e NENHUM input
// (Input/Select/Switch/Textarea) em lugar nenhum do formulário. Removidos:
//   - inteligencia.slaPrimeiraRespostaMinutos (PDF + WhatsApp + card da lista)
//   - inteligencia.relatoriosFrequencia (WhatsApp)
//   - canais.aquecimentoAlinhado (PDF)
//   - operacao.kanbanEtapas (PDF)
//   - operacao.visaoPreferida (PDF)
//   - operacao.followupGatilho / operacao.followupIntervalo (PDF)
//   - agente_ia.qualificacaoObrigatoria (PDF)
// Os campos citados mas já ausentes destes dois templates (canais.prazoVolumeTotal,
// agente_ia.kanbanAgenteEtapas, agente_ia.inboundIniciaOuResponde,
// fechamento.recapitulado) não precisaram de remoção — nunca vazaram aqui.

export interface ImplementationBriefingExportData {
  client_name?: string;
  tenant_id?: string;
  model_type?: string;
  status?: string;
  num_employees?: number;
  has_commercial_sector?: boolean;
  prerequisites?: { segmento?: string };
  operacao?: { quemAcessa?: string; horarioComercial?: string };
  agente_ia?: {
    tomDeVoz?: string;
    regraEscalonamento?: string;
    precisaSaber?: string;
    naoPodeInformar?: string;
  };
  canais?: { quantosChips?: string; numeroNovoOuHistorico?: string };
  updated_at?: string;
  created_at?: string;
}

export function buildImplementationBriefingPdfHtml(b: ImplementationBriefingExportData): string {
  const isAdv = b.model_type === "avancado";

  return `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Briefing de Implantação Vexo OS - ${b.client_name || "Cliente"}</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; padding: 30px; line-height: 1.5; font-size: 13px; }
            .header { border-bottom: 2px solid #6366f1; padding-bottom: 15px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: flex-start; }
            .title { font-size: 22px; font-weight: 900; color: #1e1b4b; margin: 0; }
            .subtitle { font-size: 12px; color: #64748b; font-weight: 600; margin-top: 4px; }
            .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-weight: 800; font-size: 11px; text-transform: uppercase; }
            .badge-model { background: #e0e7ff; color: #3730a3; }
            .badge-status { background: #dcfce7; color: #166534; }
            .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 25px; }
            .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 15px; }
            .card-title { font-size: 12px; font-weight: 800; text-transform: uppercase; color: #475569; margin-bottom: 8px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
            .item { margin-bottom: 6px; }
            .item-label { font-weight: 700; color: #334155; }
            .item-val { color: #0f172a; }
            .section { margin-bottom: 20px; page-break-inside: avoid; }
            .section-title { font-size: 14px; font-weight: 800; color: #312e81; background: #eef2ff; padding: 8px 12px; border-radius: 6px; border-left: 4px solid #4f46e5; margin-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin-top: 6px; }
            th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; font-size: 12px; }
            th { background: #f1f5f9; font-weight: 700; color: #475569; }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h1 class="title">Briefing de Implantação Técnico (Vexo OS)</h1>
              <p class="subtitle">Empresa: <strong>${b.client_name || "Cliente"}</strong> | ID Tenant: ${b.tenant_id || "N/A"}</p>
            </div>
            <div>
              <span class="badge badge-model">${isAdv ? "Trilha [A] Avançado" : "Trilha [E] Essencial"}</span>
              <span class="badge badge-status">${b.status === "concluido" ? "Concluído" : "Em Andamento"}</span>
            </div>
          </div>

          <div class="grid">
            <div class="card">
              <div class="card-title">Perfil da Operação</div>
              <div class="item"><span class="item-label">Atendentes / Funcionários:</span> <span class="item-val">${b.num_employees || 1}</span></div>
              <div class="item"><span class="item-label">Setor Comercial Dedicado:</span> <span class="item-val">${b.has_commercial_sector ? "Sim" : "Não"}</span></div>
              <div class="item"><span class="item-label">Segmento:</span> <span class="item-val">${b.prerequisites?.segmento || "Não informado"}</span></div>
            </div>
            <div class="card">
              <div class="card-title">Canais & WhatsApp</div>
              <div class="item"><span class="item-label">Chips WhatsApp:</span> <span class="item-val">${b.canais?.quantosChips || 1}</span></div>
              <div class="item"><span class="item-label">Tipo de Número:</span> <span class="item-val">${b.canais?.numeroNovoOuHistorico === "ja_usado" ? "Já Usado" : "Número Novo"}</span></div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">1. Parâmetros de Operação</div>
            <table>
              <tr><th>Parâmetro</th><th>Configuração</th></tr>
              <tr><td>Acesso da Equipe</td><td>${b.operacao?.quemAcessa || "Todos os atendentes"}</td></tr>
              <tr><td>Horário Comercial</td><td>${b.operacao?.horarioComercial || "08:00 às 18:00"}</td></tr>
            </table>
          </div>

          <div class="section">
            <div class="section-title">2. Agente de Inteligência Artificial</div>
            <table>
              <tr><th>Parâmetro IA</th><th>Definição</th></tr>
              <tr><td>Tom de Voz</td><td>${b.agente_ia?.tomDeVoz || "Atencioso"}</td></tr>
              <tr><td>Regra de Escalonamento (Humano)</td><td>${b.agente_ia?.regraEscalonamento || "Não informado"}</td></tr>
              <tr><td>O que DEVE Informar</td><td>${b.agente_ia?.precisaSaber || "Não informado"}</td></tr>
              <tr><td>O que NÃO Pode Informar</td><td>${b.agente_ia?.naoPodeInformar || "Não informado"}</td></tr>
            </table>
          </div>

          <div style="margin-top: 30px; border-top: 1px solid #cbd5e1; padding-top: 10px; text-align: center; color: #94a3b8; font-size: 11px;">
            Documento emitido pelo Vexo OS CRM em ${new Date().toLocaleDateString("pt-BR")}.
          </div>

          <script>
            window.onload = function() { window.print(); }
          </script>
        </body>
      </html>
    `;
}

export function buildImplementationBriefingWhatsAppMessage(b: ImplementationBriefingExportData): string {
  const isAdv = b.model_type === "avancado";

  return `*📋 Briefing de Implantação Vexo OS (Onboarding Técnico)*

*Empresa:* ${b.client_name || "Cliente"}
*Modelo:* ${isAdv ? "Trilha [A] Modelo Avançado" : "Trilha [E] Modelo Essencial"}
*Status:* ${b.status === "concluido" ? "Concluído" : "Em Andamento"}

*👥 Perfil da Operação:*
- Atendentes: ${b.num_employees || 1}
- Setor Comercial Dedicado: ${b.has_commercial_sector ? "Sim" : "Não"}
- Segmento: ${b.prerequisites?.segmento || "N/A"}

*🤖 Agente de IA:*
- Tom de Voz: ${b.agente_ia?.tomDeVoz || "Atencioso"}
- Escalonamento: ${b.agente_ia?.regraEscalonamento || "Ao solicitar orçamento"}
- Informações Principais: ${b.agente_ia?.precisaSaber || "Endereço, Horários, Serviços"}

*📱 Canais & WhatsApp:*
- Chips WhatsApp: ${b.canais?.quantosChips || 1} chip(s)
- Horário Comercial: ${b.operacao?.horarioComercial || "08:00 às 18:00"}

_Registrado via Vexo CRM em ${new Date(b.updated_at || b.created_at || Date.now()).toLocaleDateString("pt-BR")}_`;
}
