import { Smartphone, Bot, FileSpreadsheet, ShieldCheck, CheckCircle2, AlertCircle } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { EmptyState } from "@/components/EmptyState";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { useOnboardingProgress } from "@/hooks/useOnboardingProgress";
import { SetupCelebration } from "./VexoOnboardingSetup/SetupCelebration";
import { SetupStepCard } from "./VexoOnboardingSetup/SetupStepCard";

interface VexoOnboardingSetupProps {
  baseTotal?: number | null;
}

export default function VexoOnboardingSetup({ baseTotal }: VexoOnboardingSetupProps = {}) {
  const crmClient = useOptionalCrmClient();
  const selectedClient = crmClient?.selectedClient || null;
  const clientId = crmClient?.selectedClientId || "";
  const clientName = selectedClient?.name || clientId || "Sua Empresa";

  const progress = useOnboardingProgress(clientId, { baseTotal });

  if (!clientId) {
    return (
      <PageShell
        title="Implantação Vexo OS"
        subtitle="Acompanhe a ativação da sua máquina comercial inteligente"
      >
        <EmptyState
          title="Selecione uma empresa"
          description="Escolha um cliente no seletor para acompanhar a implantação da sua operação."
        />
      </PageShell>
    );
  }

  // Dados do Passo 1: WhatsApp
  const evolutionInstances =
    selectedClient?.n8n_settings?.evolution_instances ??
    (selectedClient as any)?.evolution_instances ??
    [];
  const connectedInstances = Array.isArray(evolutionInstances)
    ? evolutionInstances.filter((inst: any) => inst.active !== false)
    : [];
  const chipStepDone = progress.steps.find((s) => s.id === "chip")?.done ?? false;

  // Dados do Passo 2: Agente IA
  const chatbotEnabled = Boolean(
    selectedClient?.n8n_settings?.chatbot_enabled === true ||
      (selectedClient as any)?.chatbot_enabled === true
  );
  const chatbotModel =
    selectedClient?.n8n_settings?.chatbot_model ||
    selectedClient?.n8n_settings?.chatbot_llm_model ||
    "Modelo Padrão Vexo";
  const agentStepDone = progress.steps.find((s) => s.id === "agente")?.done ?? false;

  // Dados do Passo 3: Leads
  const leadsStepDone = progress.steps.find((s) => s.id === "leads")?.done ?? false;

  return (
    <PageShell
      title="Implantação Vexo OS"
      subtitle={`${clientName} · Setup operacional em 3 passos`}
      spacing="space-y-6"
    >
      {/* Hero com Barra de Progresso Destacada */}
      <div className="rounded-2xl border border-border/80 bg-gradient-to-r from-card via-card/80 to-muted/30 p-6 md:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">
              Status da Ativação
            </span>
            <h2 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
              {progress.isFullyReady
                ? "Operação 100% Configurada e Ativa"
                : "Passos para Colocar sua Operação no Ar"}
            </h2>
            <p className="text-xs md:text-sm text-muted-foreground">
              {progress.isFullyReady
                ? "Todos os pilares operacionais foram concluídos. Sua empresa está pronta para tracionar."
                : `Você completou ${progress.completedCount} de ${progress.totalSteps} etapas essenciais.`}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0 self-start md:self-auto">
            <div className="text-right">
              <span className="text-2xl md:text-3xl font-extrabold text-foreground">
                {progress.percent}%
              </span>
              <p className="text-[11px] text-muted-foreground">
                {progress.completedCount} de 3 passos prontos
              </p>
            </div>
          </div>
        </div>

        {/* Barra de Progresso Destacada */}
        <div className="w-full bg-muted rounded-full h-3 overflow-hidden p-0.5">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 via-indigo-400 to-emerald-500 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </div>

      {/* Painel Comemorativo quando 100% Concluído */}
      {progress.isFullyReady && <SetupCelebration />}

      {/* 3 Grandes Cards de Ação */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: WhatsApp Conectado */}
        <SetupStepCard
          stepNumber={1}
          title="WhatsApp Conectado"
          icon={<Smartphone className="w-5 h-5" />}
          isDone={chipStepDone}
          statusLabel={chipStepDone ? "Conectado" : "Conexão Pendente"}
          description="Vincule um número de WhatsApp via Evolution API para envio de mensagens ativas e recebimento de respostas."
          details={
            chipStepDone ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Instâncias Ativas:</span>
                  <span className="font-semibold text-foreground">
                    {connectedInstances.length} chip(s)
                  </span>
                </div>
                {connectedInstances.slice(0, 2).map((inst: any, idx: number) => (
                  <div
                    key={inst.id || idx}
                    className="flex items-center justify-between text-[11px] text-muted-foreground truncate"
                  >
                    <span className="truncate">📱 {inst.name}</span>
                    <span className="text-emerald-400 font-medium shrink-0 ml-2">
                      {inst.chip_state === "warm" ? "Aquecido" : "Pronto"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-amber-400">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Nenhum chip de WhatsApp conectado ainda.</span>
              </div>
            )
          }
          ctaText={chipStepDone ? "Gerenciar Chips & Instâncias" : "Escanear QR Code / Conectar"}
          ctaRoute="/crm/chips-whatsapp?tab=conexoes"
          isPrimary={!chipStepDone}
        />

        {/* Card 2: Agente de IA Comercial */}
        <SetupStepCard
          stepNumber={2}
          title="Agente de IA Comercial"
          icon={<Bot className="w-5 h-5" />}
          isDone={agentStepDone}
          statusLabel={agentStepDone ? "Ativo" : "Desligado"}
          description="Configure as instruções, tom de voz e regras de qualificação do seu consultor comercial inteligente."
          details={
            <div className="space-y-1">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Status do Bot:</span>
                <span
                  className={
                    chatbotEnabled
                      ? "font-semibold text-emerald-400"
                      : "font-semibold text-muted-foreground"
                  }
                >
                  {chatbotEnabled ? "Ativo no Inbound" : "Desligado"}
                </span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Modelo LLM:</span>
                <span className="font-medium text-foreground truncate max-w-[150px]">
                  {chatbotModel}
                </span>
              </div>
            </div>
          }
          ctaText="Ajustar Tom de Voz / Configurar"
          ctaRoute="/crm/agente"
          isPrimary={chipStepDone && !agentStepDone}
        />

        {/* Card 3: Base de Leads & Disparos */}
        <SetupStepCard
          stepNumber={3}
          title="Base de Leads & Disparos"
          icon={<FileSpreadsheet className="w-5 h-5" />}
          isDone={leadsStepDone}
          statusLabel={leadsStepDone ? "Base Ativa" : "Base Vazia"}
          description="Importe planilhas de contatos ou integre fontes de leads para disparar campanhas de prospecção."
          details={
            <div className="space-y-1">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Volume de Contatos:</span>
                <span
                  className={
                    leadsStepDone
                      ? "font-semibold text-emerald-400"
                      : "font-semibold text-amber-400"
                  }
                >
                  {leadsStepDone ? "Contatos Cadastrados" : "Nenhum lead importado"}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {leadsStepDone
                  ? "Sua base possui leads aptos para receber mensagens."
                  : "Faça upload de um arquivo .xlsx ou .csv para começar."}
              </p>
            </div>
          }
          ctaText="Subir Planilha / Importar"
          ctaRoute="/crm/planilhas"
          isPrimary={chipStepDone && agentStepDone && !leadsStepDone}
        />
      </div>
    </PageShell>
  );
}
