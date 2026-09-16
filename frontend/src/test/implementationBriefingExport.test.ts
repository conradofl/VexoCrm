import { describe, expect, it } from "vitest";
import {
  buildImplementationBriefingPdfHtml,
  buildImplementationBriefingWhatsAppMessage,
  type ImplementationBriefingExportData,
} from "@/lib/geracaoDigital/implementationBriefingExport";

// Campos que hoje NÃO têm input em nenhum dos 5 passos do formulário — mesmo assim
// tinham valor padrão hardcoded no useState e apareciam no documento como se fossem
// dado real capturado do cliente. String exata que cada um imprimia quando vazio.
const FRASES_PADRAO_PROIBIDAS = [
  "15 minutos", // inteligencia.slaPrimeiraRespostaMinutos (PDF)
  "SLA de Resposta", // label do campo, WhatsApp
  "SLA Resposta Meta", // label do campo, PDF
  "Frequência Relatórios", // inteligencia.relatoriosFrequencia (WhatsApp)
  "semanal", // valor padrão de relatoriosFrequencia
  "Aquecimento Alinhado", // canais.aquecimentoAlinhado (PDF)
  "Etapas do Kanban", // operacao.kanbanEtapas (PDF)
  "Lead, Em Atendimento, Agendado, Proposta, Fechado, Perdido", // valor padrão de kanbanEtapas
  "Visão Preferida", // operacao.visaoPreferida (PDF)
  "Follow-up Automático", // operacao.followupGatilho/followupIntervalo (PDF)
  "Lead sem resposta em 24h", // valor padrão de followupGatilho
  "Campos Obrigatórios Qualificação", // agente_ia.qualificacaoObrigatoria (PDF)
  "Nome, Cidade, Necessidade principal", // valor padrão de qualificacaoObrigatoria
];

// Um briefing real, mas com TODOS os campos que têm input na tela vazios — é o que
// "todos os campos da tela vazios" significa: os que o usuário PODE preencher, vazios.
const BRIEFING_TELA_VAZIA: ImplementationBriefingExportData = {
  client_name: "",
  tenant_id: "",
  model_type: "essencial",
  status: "em_andamento",
  num_employees: undefined,
  has_commercial_sector: false,
  prerequisites: { segmento: "" },
  operacao: { quemAcessa: "", horarioComercial: "" },
  agente_ia: {
    tomDeVoz: "",
    regraEscalonamento: "",
    precisaSaber: "",
    naoPodeInformar: "",
  },
  canais: { quantosChips: "", numeroNovoOuHistorico: "" },
};

describe("Export do Briefing de Implantação — nada sai com a marca do sistema sem ter sido perguntado", () => {
  it("PDF de um briefing com todos os campos da tela vazios não imprime nenhuma frase ou número padrão de campo sem input", () => {
    const html = buildImplementationBriefingPdfHtml(BRIEFING_TELA_VAZIA);
    for (const frase of FRASES_PADRAO_PROIBIDAS) {
      expect(html, `PDF vazou o campo morto via a frase "${frase}"`).not.toContain(frase);
    }
  });

  it("mensagem de WhatsApp com todos os campos da tela vazios não imprime nenhuma frase ou número padrão de campo sem input", () => {
    const msg = buildImplementationBriefingWhatsAppMessage(BRIEFING_TELA_VAZIA);
    for (const frase of FRASES_PADRAO_PROIBIDAS) {
      expect(msg, `WhatsApp vazou o campo morto via a frase "${frase}"`).not.toContain(frase);
    }
  });

  it("campos COM input continuam aparecendo quando preenchidos (a correção não apagou o que é real)", () => {
    const preenchido: ImplementationBriefingExportData = {
      ...BRIEFING_TELA_VAZIA,
      client_name: "Clínica Sorriso Feliz",
      agente_ia: { ...BRIEFING_TELA_VAZIA.agente_ia, tomDeVoz: "Formal e Direto" },
      canais: { quantosChips: "3", numeroNovoOuHistorico: "ja_usado" },
    };
    const html = buildImplementationBriefingPdfHtml(preenchido);
    expect(html).toContain("Clínica Sorriso Feliz");
    expect(html).toContain("Formal e Direto");
    expect(html).toContain("Já Usado");

    const msg = buildImplementationBriefingWhatsAppMessage(preenchido);
    expect(msg).toContain("Clínica Sorriso Feliz");
    expect(msg).toContain("Formal e Direto");
  });

  it("campos citados que já estavam ausentes destes dois documentos continuam ausentes (nada a remover, prova negativa)", () => {
    const html = buildImplementationBriefingPdfHtml(BRIEFING_TELA_VAZIA);
    const msg = buildImplementationBriefingWhatsAppMessage(BRIEFING_TELA_VAZIA);
    for (const frase of ["14 dias", "Triagem e Qualificação", "responde"]) {
      expect(html).not.toContain(frase);
      expect(msg).not.toContain(frase);
    }
  });
});
