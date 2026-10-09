import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Smartphone,
  Bot,
  FileSpreadsheet,
  Building2,
  Clock,
  BrainCircuit,
  ShieldAlert,
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ArrowRight,
  Save,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SetupStepCard } from "./SetupStepCard";
import { SimulatorChat } from "./SimulatorChat";
import { cn } from "@/lib/utils";
import type { LeadClient } from "@/hooks/useLeadClients";
import type { OnboardingProgress } from "@/lib/onboarding/progress";

interface PracticalPipelineTabProps {
  clientId: string;
  selectedClient: LeadClient | null;
  progress: OnboardingProgress;
  connectedInstances: any[];
  chatbotEnabled: boolean;
  chatbotModel: string;
  chipStepDone: boolean;
  agentStepDone: boolean;
  leadsStepDone: boolean;
}

export function PracticalPipelineTab({
  clientId,
  selectedClient,
  progress,
  connectedInstances,
  chatbotEnabled,
  chatbotModel,
  chipStepDone,
  agentStepDone,
  leadsStepDone,
}: PracticalPipelineTabProps) {
  // Estado do Passo 1: Identidade da Empresa & Horários
  const [companyName, setCompanyName] = useState(selectedClient?.name || "");
  const [segment, setSegment] = useState(
    (selectedClient as any)?.segment || "Comércio & Serviços Especializados"
  );
  const [operatingHours, setOperatingHours] = useState(
    (selectedClient as any)?.operating_hours || "Segunda a Sexta, das 08h30 às 18h30"
  );

  // Estado do Passo 2: O Cérebro do Agente (5 Pilares Simplificados)
  const [products, setProducts] = useState(
    (selectedClient as any)?.products_summary ||
      "Consultoria, serviços comerciais e soluções sob medida para empresas"
  );
  const [priceRange, setPriceRange] = useState(
    (selectedClient as any)?.price_range || "Planos a partir de R$ 980 / mês ou projetos sob demanda"
  );
  const [deliveryTerms, setDeliveryTerms] = useState(
    (selectedClient as any)?.delivery_terms || "Ativação em até 48 horas úteis após validação de dados"
  );
  const [faq, setFaq] = useState(
    (selectedClient as any)?.faq || "Dúvidas sobre formas de pagamento, garantias e suporte técnico contínuo"
  );
  const [forbiddenRules, setForbiddenRules] = useState(
    (selectedClient as any)?.forbidden_rules || "Prometer descontos sem autorização ou garantir resultados fora do contrato"
  );
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([
    "Tabela_Oficial_Precos_2026.pdf",
    "Manual_Servicos_Empresa.pdf",
  ]);

  // Mensagem de feedback de salvamento
  const [isSaved, setIsSaved] = useState(false);

  // Carrega do localStorage se houver
  useEffect(() => {
    if (!clientId) return;
    try {
      const stored = localStorage.getItem(`vexo_pipeline_${clientId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.companyName) setCompanyName(parsed.companyName);
        if (parsed.segment) setSegment(parsed.segment);
        if (parsed.operatingHours) setOperatingHours(parsed.operatingHours);
        if (parsed.products) setProducts(parsed.products);
        if (parsed.priceRange) setPriceRange(parsed.priceRange);
        if (parsed.deliveryTerms) setDeliveryTerms(parsed.deliveryTerms);
        if (parsed.faq) setFaq(parsed.faq);
        if (parsed.forbiddenRules) setForbiddenRules(parsed.forbiddenRules);
        if (parsed.uploadedFiles) setUploadedFiles(parsed.uploadedFiles);
      }
    } catch {
      // Ignora erro de storage
    }
  }, [clientId]);

  const handleSave = () => {
    if (!clientId) return;
    try {
      const payload = {
        companyName,
        segment,
        operatingHours,
        products,
        priceRange,
        deliveryTerms,
        faq,
        forbiddenRules,
        uploadedFiles,
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(`vexo_pipeline_${clientId}`, JSON.stringify(payload));
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch {
      // Ignora erro de storage
    }
  };

  const handleSimulatedFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const names = Array.from(files).map((f) => f.name);
      setUploadedFiles((prev) => [...prev, ...names]);
    }
  };

  return (
    <div className="space-y-8">
      {/* 3 Grandes Cards de Status Técnico (Preserva estrutura e testes) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>Status Técnico da Operação</span>
            <span className="text-xs font-normal text-slate-500">
              ({progress.completedCount} de 3 pilares ativos)
            </span>
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
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
                  <div className="flex items-center justify-between text-slate-500 dark:text-muted-foreground">
                    <span>Instâncias Ativas:</span>
                    <span className="font-semibold text-slate-900 dark:text-foreground">
                      {connectedInstances.length} chip(s)
                    </span>
                  </div>
                  {connectedInstances.slice(0, 2).map((inst: any, idx: number) => (
                    <div
                      key={inst.id || idx}
                      className="flex items-center justify-between text-[11px] text-slate-500 dark:text-muted-foreground truncate"
                    >
                      <span className="truncate">📱 {inst.name}</span>
                      <span className="text-emerald-700 dark:text-emerald-400 font-medium shrink-0 ml-2">
                        {inst.chip_state === "warm" ? "Aquecido" : "Pronto"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
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
                <div className="flex items-center justify-between text-slate-500 dark:text-muted-foreground">
                  <span>Status do Bot:</span>
                  <span
                    className={
                      chatbotEnabled
                        ? "font-semibold text-emerald-700 dark:text-emerald-400"
                        : "font-semibold text-slate-500 dark:text-muted-foreground"
                    }
                  >
                    {chatbotEnabled ? "Ativo no Inbound" : "Desligado"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-500 dark:text-muted-foreground">
                  <span>Modelo LLM:</span>
                  <span className="font-medium text-slate-900 dark:text-foreground truncate max-w-[150px]">
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
                <div className="flex items-center justify-between text-slate-500 dark:text-muted-foreground">
                  <span>Volume de Contatos:</span>
                  <span
                    className={
                      leadsStepDone
                        ? "font-semibold text-emerald-700 dark:text-emerald-400"
                        : "font-semibold text-amber-700 dark:text-amber-400"
                    }
                  >
                    {leadsStepDone ? "Contatos Cadastrados" : "Nenhum lead importado"}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-muted-foreground">
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
      </div>

      {/* Divisor Visual */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200/80 dark:border-border/60" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-3 text-slate-400 font-semibold tracking-wider">
            Esteira Simplificada de Implantação
          </span>
        </div>
      </div>

      {/* Os 3 Passos Objetivos do Briefing Didático */}
      <div className="space-y-6">
        {/* PASSO 1: Identidade da Empresa & Horários */}
        <div className="rounded-xl border border-slate-200/80 bg-white dark:bg-card dark:border-border/80 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 dark:bg-indigo-500/10 dark:border-indigo-500/20 dark:text-indigo-400">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                  Etapa 1 de 3
                </span>
                <h4 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Identidade da Empresa & Horários
                </h4>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20 self-start sm:self-auto">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Identidade Configurada
            </span>
          </div>

          {/* Caixa de Explicação Didática */}
          <div className="rounded-lg bg-indigo-50/70 border border-indigo-100 dark:bg-indigo-950/20 dark:border-indigo-500/20 p-3.5 text-xs text-indigo-950 dark:text-indigo-200 space-y-1">
            <p className="font-semibold flex items-center gap-1.5 text-indigo-800 dark:text-indigo-300">
              💡 Por que pedimos isso?
            </p>
            <p className="leading-relaxed">
              Para o robô saber a hora certa de transferir para sua equipe ou avisar que o escritório está fechado.
            </p>
          </div>

          {/* Campos do Formulário */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Nome da Empresa
              </label>
              <Input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Ex: Minha Empresa"
                className="text-xs h-9 bg-slate-50/50 dark:bg-slate-900/50 border-slate-200"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Segmento de Atuação
              </label>
              <Input
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                placeholder="Ex: Clínica Odontológica, Imobiliária, etc."
                className="text-xs h-9 bg-slate-50/50 dark:bg-slate-900/50 border-slate-200"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                Horário de Atendimento Humano
              </label>
              <Input
                value={operatingHours}
                onChange={(e) => setOperatingHours(e.target.value)}
                placeholder="Ex: Seg a Sex, 09h às 18h"
                className="text-xs h-9 bg-slate-50/50 dark:bg-slate-900/50 border-slate-200"
              />
            </div>
          </div>
        </div>

        {/* PASSO 2: O Cérebro do Agente (5 Pilares Simplificados) */}
        <div className="rounded-xl border border-slate-200/80 bg-white dark:bg-card dark:border-border/80 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-purple-50 border border-purple-100 text-purple-600 dark:bg-purple-500/10 dark:border-purple-500/20 dark:text-purple-400">
                <BrainCircuit className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[11px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
                  Etapa 2 de 3
                </span>
                <h4 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  O Cérebro do Agente (5 Pilares Simplificados)
                </h4>
              </div>
            </div>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="text-xs border-slate-200 hover:border-purple-300 self-start sm:self-auto"
            >
              <Link to="/crm/agente">
                <span>Personalizar Prompt Completo</span>
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Link>
            </Button>
          </div>

          {/* Caixa de Explicação Didática */}
          <div className="rounded-lg bg-purple-50/70 border border-purple-100 dark:bg-purple-950/20 dark:border-purple-500/20 p-3.5 text-xs text-purple-950 dark:text-purple-200 space-y-1">
            <p className="font-semibold flex items-center gap-1.5 text-purple-800 dark:text-purple-300">
              💡 Por que pedimos isso?
            </p>
            <p className="leading-relaxed">
              Para blindar as respostas da IA contra promessas falsas e garantir precisão cirúrgica no atendimento ao cliente.
            </p>
          </div>

          {/* 5 Pilares Simplificados */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            {/* Pilar 1: O que vende */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                1. O que vende (Produtos & Serviços)
              </label>
              <Textarea
                rows={2}
                value={products}
                onChange={(e) => setProducts(e.target.value)}
                placeholder="Descreva os principais produtos ou serviços oferecidos..."
                className="text-xs bg-slate-50/50 dark:bg-slate-900/50 border-slate-200 resize-none"
              />
            </div>

            {/* Pilar 2: Faixa de Preços */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                2. Faixa de Preços (Ticket Médio)
              </label>
              <Textarea
                rows={2}
                value={priceRange}
                onChange={(e) => setPriceRange(e.target.value)}
                placeholder="Valores médios ou modelo de precificação..."
                className="text-xs bg-slate-50/50 dark:bg-slate-900/50 border-slate-200 resize-none"
              />
            </div>

            {/* Pilar 3: Prazos de Entrega / Execução */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                3. Prazos de Entrega & Execução
              </label>
              <Input
                value={deliveryTerms}
                onChange={(e) => setDeliveryTerms(e.target.value)}
                placeholder="Ex: Em até 5 dias úteis..."
                className="text-xs h-9 bg-slate-50/50 dark:bg-slate-900/50 border-slate-200"
              />
            </div>

            {/* Pilar 4: Dúvidas Frequentes + Upload */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                4. Dúvidas Frequentes (FAQ & Materiais)
              </label>
              <Input
                value={faq}
                onChange={(e) => setFaq(e.target.value)}
                placeholder="Principais dúvidas dos clientes..."
                className="text-xs h-9 bg-slate-50/50 dark:bg-slate-900/50 border-slate-200"
              />
            </div>
          </div>

          {/* Upload de Documentos/PDFs (Pilar 4 Avançado) */}
          <div className="rounded-lg border border-dashed border-slate-200 dark:border-border p-3.5 bg-slate-50/40 dark:bg-muted/10 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5 text-indigo-500" />
                  Documentos & PDFs para Conhecimento do Robô (RAG)
                </span>
                <p className="text-[11px] text-slate-500">
                  Suba tabelas de preços, manuais de produtos ou propostas para a IA ler e citar nas respostas.
                </p>
              </div>

              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-indigo-300 text-xs font-medium cursor-pointer shadow-2xs text-slate-700 dark:bg-card dark:border-border dark:text-slate-200">
                <Upload className="w-3.5 h-3.5" />
                <span>Anexar PDF / Doc</span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.txt"
                  className="hidden"
                  onChange={handleSimulatedFileUpload}
                />
              </label>
            </div>

            {/* Lista de Documentos Anexados */}
            {uploadedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {uploadedFiles.map((file, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 dark:bg-slate-900/80 dark:border-border dark:text-slate-300"
                  >
                    <FileText className="w-3 h-3 text-indigo-500" />
                    {file}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Pilar 5: O que a IA NUNCA pode prometer (Blindagem) */}
          <div className="space-y-1.5 rounded-lg bg-rose-50/40 border border-rose-200/60 dark:bg-rose-950/10 dark:border-rose-500/20 p-3.5">
            <label className="text-xs font-bold text-rose-900 dark:text-rose-300 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              5. Blindagem: O que a IA NUNCA pode prometer
            </label>
            <p className="text-[11px] text-rose-700/80 dark:text-rose-400">
              Regras e restrições inegociáveis que impedem o bot de dar descontos indevidos ou criar falsas expectativas.
            </p>
            <Input
              value={forbiddenRules}
              onChange={(e) => setForbiddenRules(e.target.value)}
              placeholder="Ex: Nunca dar mais de 10% de desconto ou prometer prazo menor que 72h..."
              className="text-xs h-9 bg-white dark:bg-slate-900 border-rose-200 focus-visible:ring-rose-500 text-slate-800 dark:text-slate-200"
            />
          </div>

          {/* Botão de Salvar Alterações */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-border/50">
            <span className="text-xs text-slate-500">
              {isSaved ? "✅ Parâmetros salvos com sucesso!" : "As informações alimentam o simulador abaixo em tempo real."}
            </span>
            <Button
              size="sm"
              onClick={handleSave}
              className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white gap-1.5 shadow-xs"
            >
              <Save className="w-3.5 h-3.5" />
              Salvar Parâmetros
            </Button>
          </div>
        </div>

        {/* PASSO 3: Conectar WhatsApp & Testar no Simulador ao Vivo */}
        <div className="rounded-xl border border-slate-200/80 bg-white dark:bg-card dark:border-border/80 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                  Etapa 3 de 3
                </span>
                <h4 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Conectar WhatsApp & Testar no Simulador ao Vivo
                </h4>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              <Button
                asChild
                variant="outline"
                size="sm"
                className="text-xs border-slate-200 hover:border-emerald-300"
              >
                <Link to="/crm/chips-whatsapp?tab=conexoes">
                  <Smartphone className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                  Escanear QR Code
                </Link>
              </Button>
            </div>
          </div>

          {/* Status do QR Code / Instâncias */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200/80 dark:bg-muted/30 dark:border-border/60">
            <div className="flex items-center gap-2.5">
              <div
                className={cn(
                  "w-3 h-3 rounded-full shrink-0",
                  chipStepDone ? "bg-emerald-500 animate-pulse" : "bg-amber-400"
                )}
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {chipStepDone
                    ? `WhatsApp Conectado (${connectedInstances.length} chip(s) ativo(s))`
                    : "Conexão WhatsApp Pendente"}
                </span>
                <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                  {chipStepDone
                    ? "Tudo pronto para receber mensagens e disparar com segurança."
                    : "Escaneie o QR Code no seu WhatsApp para sincronizar o número comercial."}
                </p>
              </div>
            </div>

            <Link
              to="/crm/chips-whatsapp?tab=conexoes"
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 hover:underline shrink-0"
            >
              Ver QR Code e Instâncias ➔
            </Link>
          </div>

          {/* Simulador Interativo Integrado */}
          <div className="pt-2">
            <SimulatorChat
              companyName={companyName}
              segment={segment}
              operatingHours={operatingHours}
              products={products}
              priceRange={priceRange}
              deliveryTerms={deliveryTerms}
              forbiddenRules={forbiddenRules}
              hasConnectedChip={chipStepDone}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
