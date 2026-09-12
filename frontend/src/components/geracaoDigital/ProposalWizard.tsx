import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  X,
  FileText,
  CheckCircle,
  Sparkles,
  Building2,
  Target,
  Package,
  DollarSign,
  CreditCard,
} from "lucide-react";
import { calculateProposalValues } from "@/lib/geracaoDigital/proposalCalculator";
import { type PaymentTerm, termAplicaA, APLICA_A_LABELS } from "@/lib/geracaoDigital/paymentTerms";
import PlanoEditor from "@/components/geracaoDigital/PlanoEditor";
import { type Plano, planoVazio, planoValido } from "@/lib/geracaoDigital/plano";
import { syncPlanoPackages } from "@/lib/geracaoDigital/planoSync";
import FormasPagamentoEditor from "@/components/geracaoDigital/FormasPagamentoEditor";
import {
  type FormasSelecionadas,
  formasVazias,
  formasParaTerms,
  TODAS_FORMAS,
  parcelasDe,
} from "@/lib/geracaoDigital/formasPagamento";
import {
  PERIODOS,
  mesesDoPeriodo,
  prazosOfertados,
  VEXO_STANDARD_MODULES,
} from "@/lib/geracaoDigital/plano";

interface ProposalWizardProps {
  onClose: () => void;
  availablePackages: any[];
  vexoProducts: any[];
  gdProducts: any[];
  availableTerms: PaymentTerm[];
  wizardState: {
    wizardStep: number;
    setWizardStep: (step: number) => void;
    newProspect: string;
    setNewProspect: (val: string) => void;
    newSegmentId: string;
    setNewSegmentId: (val: string) => void;
    customSegmentName?: string;
    setCustomSegmentName?: (val: string) => void;
    newProspectLogo: string | null;
    setNewProspectLogo: (val: string | null) => void;
    newPackageId: string;
    setNewPackageId: (val: string) => void;
    newPackageVexoId: string;
    setNewPackageVexoId: (val: string) => void;
    newPacotesOfertados: string[];
    setNewPacotesOfertados: React.Dispatch<React.SetStateAction<string[]>>;
    newOfferedTermIds: string[];
    setNewOfferedTermIds: React.Dispatch<React.SetStateAction<string[]>>;
    newVexoAvulsoIds: Record<string, boolean>;
    setNewVexoAvulsoIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    newGdAvulsoIds: Record<string, boolean>;
    setNewGdAvulsoIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    newCarencia: string;
    setNewCarencia: (val: string) => void;
    newCobrarSetup: boolean;
    setNewCobrarSetup: (val: boolean) => void;
    newValorSetup: number;
    setNewValorSetup: (val: number) => void;
    newPeriodo: string;
    setNewPeriodo: (val: string) => void;
    newValidade: string;
    setNewValidade: (val: string) => void;
    newCondicoes: string;
    setNewCondicoes: (val: string) => void;
    newEsconderValores?: boolean;
    setNewEsconderValores?: (val: boolean) => void;
    newPaymentLink: string;
    setNewPaymentLink: (val: string) => void;
    handleCreateDirectProposal: (formasFixas?: any[]) => Promise<void>;
  };
  toast: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void;
  clientId: string | null;
  getIdToken: () => Promise<string | null>;
  onPackageCreated: (pkg: any) => void;
  /** Plano com que o step 2 abre. Preenchido ao editar uma proposta. */
  planoInicial?: Plano;
  segmentsList: any[];
  isVexoCommercial?: boolean;
}

export const ProposalWizard: React.FC<ProposalWizardProps> = ({
  onClose,
  availablePackages,
  vexoProducts,
  gdProducts,
  availableTerms,
  wizardState,
  toast,
  clientId,
  getIdToken,
  onPackageCreated,
  planoInicial,
  segmentsList = [],
  isVexoCommercial = false,
}) => {
  const {
    wizardStep,
    setWizardStep,
    newProspect,
    setNewProspect,
    newSegmentId,
    setNewSegmentId,
    customSegmentName,
    setCustomSegmentName,
    newProspectLogo,
    setNewProspectLogo,
    newPackageId,
    setNewPackageId,
    newPackageVexoId,
    setNewPackageVexoId,
    newPacotesOfertados,
    setNewPacotesOfertados,
    newOfferedTermIds,
    setNewOfferedTermIds,
    newVexoAvulsoIds,
    setNewVexoAvulsoIds,
    newGdAvulsoIds,
    setNewGdAvulsoIds,
    newCarencia,
    setNewCarencia,
    newCobrarSetup,
    setNewCobrarSetup,
    newValorSetup,
    setNewValorSetup,
    newPeriodo,
    setNewPeriodo,
    newValidade,
    setNewValidade,
    newCondicoes,
    setNewCondicoes,
    newPaymentLink,
    setNewPaymentLink,
    handleCreateDirectProposal
  } = wizardState;

  // Plano da proposta: um escopo, até 4 preços (mensal/tri/semestral/anual).
  // Substituiu a biblioteca de pacotes + o montador com nome manual. Ver o
  // cabeçalho de lib/geracaoDigital/plano.ts para o porquê.
  const [plano, setPlano] = React.useState<Plano>(planoInicial || planoVazio);
  // Ao abrir para editar, o step 2 vinha em branco: o escopo e os prazos já
  // gravados não eram carregados.
  React.useEffect(() => {
    if (planoInicial) setPlano(planoInicial);
  }, [planoInicial]);
  const [planoSaving, setPlanoSaving] = React.useState<boolean>(false);
  const [formasPgto, setFormasPgto] = React.useState<FormasSelecionadas>(formasVazias);

  // Base para exibir o valor das parcelas: usa o prazo mais longo ofertado,
  // que é o pré-selecionado da proposta.
  const prazoBase = prazosOfertados(plano).slice(-1)[0];
  const mensalidadePlano = prazoBase ? Number(plano.precos[prazoBase] || 0) : 0;
  const mesesPlano = prazoBase ? mesesDoPeriodo(prazoBase) : 1;

  const handleNextStep1 = () => {
    if (!newProspect.trim()) {
      toast({ title: "Atenção", description: "Por favor, digite o nome do prospect.", variant: "destructive" });
      return;
    }
    setWizardStep(2);
  };

  // Ao avançar, cada prazo com preço vira uma linha de preço gravada.
  // O vendedor não nomeia nem gerencia essas linhas.
  const handleNextStep2 = async () => {
    if (!planoValido(plano)) {
      toast({
        title: "Plano incompleto",
        description: "Escolha ao menos 1 item no escopo e preencha o preço de ao menos 1 prazo.",
        variant: "destructive",
      });
      return;
    }
    setPlanoSaving(true);
    try {
      const existentes = availablePackages.filter(
        (p: any) => p?.ad_hoc && newPacotesOfertados.includes(p.id)
      );
      const r = await syncPlanoPackages({
        plano,
        nomeBase: newProspect,
        clientId,
        gdProducts,
        vexoProducts,
        existentes,
        getIdToken,
      });
      r.pacotes.forEach(onPackageCreated);
      setNewPacotesOfertados(r.pacotesOfertados);
      setNewPackageId(r.packageId);
      setNewPackageVexoId("");
      const setupVal = Number((plano as any).valorSetupVexo ?? (plano as any).valor_setup_vexo ?? 0);
      setNewValorSetup(setupVal);
      setNewCobrarSetup(setupVal > 0);
      setWizardStep(3);
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Falha ao gravar o plano.", variant: "destructive" });
    } finally {
      setPlanoSaving(false);
    }
  };

  return (
    <Card className="bg-white dark:bg-slate-900 border-purple-200 dark:border-white/10 shadow-md overflow-hidden">
      <div className="bg-gradient-to-r from-indigo-900 via-purple-900 to-slate-900 p-6 text-white relative">
        <div className="absolute top-0 right-0 h-full w-64 bg-gradient-to-l from-purple-500/10 to-transparent pointer-events-none" />
        <div className="flex justify-between items-center relative z-10">
          <div>
            <h3 className="text-lg font-black tracking-tight">Assistente de Criação de Proposta Comercial</h3>
            <p className="text-xs text-purple-200 mt-1">Crie a proposta de forma estruturada e linear em 4 etapas simples.</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 text-purple-200 hover:text-white hover:bg-white/10 rounded-full"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Stepper Indicators */}
        <div className="grid grid-cols-4 gap-2 mt-6 relative z-10">
          {[
            { label: "Cliente", step: 1 },
            { label: "Plano", step: 2 },
            { label: "Condições", step: 3 },
            { label: "Revisão", step: 4 }
          ].map((s) => (
            <div key={s.step} className="space-y-2">
              <div className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                wizardStep >= s.step ? "bg-pink-500" : "bg-white/20"
              )} />
              <span className={cn(
                "text-[10px] font-bold block truncate",
                wizardStep === s.step ? "text-pink-400 font-black" : "text-purple-300"
              )}>
                {s.step}. {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <CardContent className="p-6 space-y-6">
        {/* STEP 1: CLIENTE */}
        {wizardStep === 1 && (
          <div className="space-y-4 max-w-md mx-auto py-4 animate-fade-in">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-350">Nome do Prospect / Empresa *</Label>
              <Input
                value={newProspect}
                onChange={(e) => setNewProspect(e.target.value)}
                placeholder="Ex: ACME Corp Ltda"
                className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-xs h-10 shadow-sm focus:border-indigo-500 dark:text-white"
              />
              <p className="text-[10px] text-slate-400 italic">Identifique o cliente final que irá assinar a proposta.</p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-350">Segmento / Nicho de Atuação</Label>
              <select
                value={newSegmentId}
                onChange={(e) => {
                  setNewSegmentId(e.target.value);
                  if (e.target.value !== "custom" && setCustomSegmentName) {
                    setCustomSegmentName("");
                  }
                }}
                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 h-10 text-xs text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">Selecione o segmento…</option>
                <option value="custom" className="font-bold text-purple-600 dark:text-purple-400">
                  ✨ Outro Segmento (Personalizado com IA)...
                </option>
                {(() => {
                  const segs = [...segmentsList];
                  if (!segs.some(s => String(s.nome).toLowerCase().includes("turismo"))) {
                    segs.push({ id: "turismo", nome: "Agências de Turismo & Viagens" });
                  }
                  if (!segs.some(s => String(s.nome).toLowerCase().includes("cafeteria") || String(s.nome).toLowerCase().includes("café"))) {
                    segs.push({ id: "cafeteria", nome: "Cafeterias, Bistrôs & Cafés Especiais" });
                  }
                  segs.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
                  return segs.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ));
                })()}
              </select>
              <p className="text-[10px] text-slate-400 italic">Define o roteiro da apresentação comercial ao iniciar a partir desta proposta.</p>

              {newSegmentId === "custom" && (
                <div className="space-y-1.5 pt-1 animate-in fade-in duration-200">
                  <Label className="text-xs font-bold text-purple-700 dark:text-purple-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    Digite o Segmento / Nicho Livre
                  </Label>
                  <Input
                    placeholder="Ex: Clínica Odontológica, Energia Solar, Indústria, etc."
                    value={customSegmentName || ""}
                    onChange={(e) => setCustomSegmentName?.(e.target.value)}
                    className="h-10 text-xs bg-white dark:bg-slate-800 border-purple-300 dark:border-purple-800 focus:border-purple-500 rounded-lg shadow-sm"
                  />
                  <p className="text-[10px] text-muted-foreground italic">
                    A IA da Groq criará os 6 slides do pitch SPIN Selling adaptados exclusivamente a este nicho.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-350">Logo do Prospect (opcional)</Label>
              <div className="flex items-center gap-3">
                {newProspectLogo && (
                  <img src={newProspectLogo} alt="logo" className="h-10 w-10 rounded-lg object-contain border border-slate-200 dark:border-slate-700 bg-white" />
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => setNewProspectLogo(reader.result as string);
                    reader.readAsDataURL(file);
                  }}
                  className="text-[11px] text-slate-500 dark:text-slate-400 file:mr-2 file:rounded-md file:border-0 file:bg-indigo-50 file:px-2 file:py-1 file:text-indigo-600 file:text-[11px]"
                />
                {newProspectLogo && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setNewProspectLogo(null)} className="text-[11px] h-7">Remover</Button>
                )}
              </div>
              <p className="text-[10px] text-slate-400 italic">Aparece na capa e nos slides da apresentação.</p>
            </div>

            <div className="flex justify-end pt-4">
              <Button
                onClick={handleNextStep1}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-6"
              >
                Avançar
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: PLANO — um escopo, até 4 preços por prazo */}
        {wizardStep === 2 && (
          <div className="space-y-5 animate-fade-in">
            <PlanoEditor
              plano={plano}
              onChange={setPlano}
              gdProducts={gdProducts}
              vexoProducts={vexoProducts}
              isVexoCommercial={isVexoCommercial}
            />

            <div className="flex justify-between pt-4 border-t border-slate-100 dark:border-white/5">
              <Button variant="outline" onClick={() => setWizardStep(1)} className="border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                Voltar
              </Button>
              <Button onClick={handleNextStep2} disabled={planoSaving} className="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-6">
                {planoSaving ? "Gravando..." : "Avançar"}
                {!planoSaving && <ArrowRight className="h-3.5 w-3.5 ml-1.5" />}
              </Button>
            </div>
          </div>
        )}

                {/* STEP 3: CONDIÇÕES COMERCIAIS */}
        {wizardStep === 3 && (
          <div className="space-y-5 animate-fade-in">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-350">Validade da Proposta</Label>
                <Input
                  type="date"
                  value={newValidade}
                  onChange={(e) => setNewValidade(e.target.value)}
                  className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-xs dark:text-white h-10 focus:border-indigo-500"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-350">1º Vencimento da Mensalidade (carência)</Label>
                <select
                  value={newCarencia}
                  onChange={(e) => setNewCarencia(e.target.value)}
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-850 dark:text-white h-10 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Imediato (na contratação)</option>
                  <option value="15">15 dias após a contratação</option>
                  <option value="20">20 dias após a contratação</option>
                  <option value="30">30 dias após a contratação</option>
                </select>
                <span className="text-[9px] text-slate-450 block">Carência: não altera valores — só a data do primeiro vencimento.</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-350">Link de Checkout / Pagamento (Opcional)</Label>
              <Input
                value={newPaymentLink}
                onChange={(e) => setNewPaymentLink(e.target.value)}
                placeholder="Ex: https://checkout.vexo.com.br/proposta"
                className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-xs dark:text-white h-10 focus:border-indigo-500"
              />
            </div>

            {/* Formas fixas de pagamento — caminho principal (gerencia setup, mensalidade e condições especiais). */}
            <div className="pt-2 border-t border-slate-100 dark:border-white/5">
              <FormasPagamentoEditor
                formas={formasPgto}
                onChange={setFormasPgto}
                totalSetup={newCobrarSetup ? Number(newValorSetup || 0) : 0}
                mensalidade={mensalidadePlano}
                meses={mesesPlano}
                condicaoEspecialTexto={newCondicoes}
                onCondicaoEspecialChange={setNewCondicoes}
                esconderValores={wizardState.newEsconderValores}
                onEsconderValoresChange={wizardState.setNewEsconderValores}
              />
            </div>

            <div className="flex justify-between pt-4 border-t border-slate-100 dark:border-white/5">
              <Button variant="outline" onClick={() => setWizardStep(2)} className="border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                Voltar
              </Button>
              <Button onClick={() => setWizardStep(4)} className="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-6">
                Avançar
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 4: REVISÃO E FECHAMENTO */}
        {wizardStep === 4 && (() => {
          const brl = (v: number) =>
            Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

          const resolvedSegmentText =
            newSegmentId === "custom" || customSegmentName
              ? customSegmentName || "Personalizado"
              : newSegmentId === "cafeteria"
              ? "Cafeterias, Bistrôs & Cafés Especiais"
              : newSegmentId === "turismo"
              ? "Agências de Turismo & Viagens"
              : segmentsList.find((s) => s.id === newSegmentId)?.nome || "Geral / B2B";

          const gdItemsSelected = (plano?.gdIds || [])
            .map((id) => gdProducts.find((p) => p.id === id))
            .filter(Boolean);

          const combinedVexoPool = [...(vexoProducts || [])];
          VEXO_STANDARD_MODULES.forEach((mod) => {
            if (!combinedVexoPool.some((p) => p.id === mod.id)) {
              combinedVexoPool.push(mod);
            }
          });
          if (!combinedVexoPool.some(p => p.id === "essencial")) {
            combinedVexoPool.push({ id: "essencial", nome: "🟢 Plano Essencial Vexo OS" });
          }
          if (!combinedVexoPool.some(p => p.id === "avancado")) {
            combinedVexoPool.push({ id: "avancado", nome: "🟣 Plano Avançado Vexo OS" });
          }

          const vexoModulesSelected = (plano?.vexoIds || [])
            .map((id) => combinedVexoPool.find((p) => p.id === id))
            .filter(Boolean);

          const activeTerms = PERIODOS.filter(
            (p) => plano?.precos?.[p.key] !== undefined && Number(plano.precos[p.key]) > 0
          );

          const selectedPaymentMethods = formasPgto.marcadas.map((id) => {
            const def = TODAS_FORMAS.find((f) => f.id === id);
            const n = parcelasDe(formasPgto, id, mesesPlano);
            return {
              id,
              label: def?.label || id,
              parcelas: def?.parcelavel ? n : null,
              aplica_a: def?.aplica_a || "mensalidade",
            };
          });

          return (
            <div className="space-y-6 animate-fade-in">
              <div className="rounded-xl border border-purple-200/70 dark:border-purple-900/40 bg-gradient-to-r from-purple-50/70 to-indigo-50/50 dark:from-purple-950/20 dark:to-indigo-950/20 p-4">
                <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-purple-600" />
                  Revisão Geral da Proposta
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Confira todos os parâmetros antes de finalizar a criação do rascunho oficial.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {/* 1. 🏢 Identificação do Cliente */}
                <div className="p-4 rounded-xl bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700/80 space-y-3 shadow-sm">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-2">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-purple-600" />
                      1. Identificação do Cliente
                    </span>
                    <Badge variant="outline" className="text-[10px] border-purple-300 text-purple-600 dark:text-purple-400">
                      Cliente
                    </Badge>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between items-center py-1">
                      <span className="text-slate-500 font-medium">Nome / Razão Social:</span>
                      <span className="font-bold text-slate-800 dark:text-slate-100 text-right">{newProspect}</span>
                    </div>
                    <div className="flex justify-between items-center py-1">
                      <span className="text-slate-500 font-medium flex items-center gap-1">
                        <Target className="h-3 w-3 text-indigo-500" />
                        Segmento / Nicho:
                      </span>
                      <span className="font-semibold text-indigo-600 dark:text-indigo-400 text-right">{resolvedSegmentText}</span>
                    </div>
                    <div className="flex justify-between items-center py-1">
                      <span className="text-slate-500 font-medium">Logo da Empresa:</span>
                      {newProspectLogo ? (
                        <div className="flex items-center gap-2">
                          <img src={newProspectLogo} alt="Logo" className="h-6 w-6 object-contain rounded border bg-white" />
                          <span className="text-[10px] text-emerald-600 font-semibold">Anexada</span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-400 italic">Sem logo anexada</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 2. 📦 Escopo do Projeto */}
                <div className="p-4 rounded-xl bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700/80 space-y-3 shadow-sm">
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-2">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
                      <Package className="h-3.5 w-3.5 text-indigo-600" />
                      2. Escopo do Projeto
                    </span>
                    <Badge variant="outline" className="text-[10px] border-indigo-300 text-indigo-600 dark:text-indigo-400">
                      {gdItemsSelected.length + vexoModulesSelected.length} itens
                    </Badge>
                  </div>
                  <div className="space-y-2 text-xs max-h-40 overflow-y-auto pr-1">
                    {gdItemsSelected.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Serviços Geração Digital</span>
                        <div className="space-y-1 pl-1">
                          {gdItemsSelected.map((item: any) => (
                            <div key={item.id} className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-purple-500 shrink-0" />
                              <span className="truncate">{item.nome}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {vexoModulesSelected.length > 0 && (
                      <div className="space-y-1 pt-1">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Módulos Vexo OS</span>
                        <div className="space-y-1 pl-1">
                          {vexoModulesSelected.map((mod: any) => (
                            <div key={mod.id} className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
                              <span className="truncate">{mod.nome}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {gdItemsSelected.length === 0 && vexoModulesSelected.length === 0 && (
                      <p className="text-slate-400 italic">Nenhum item adicionado ao escopo.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* 3. 💰 Preços Ofertados por Prazo */}
              <div className="p-4 rounded-xl bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700/80 space-y-3 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-2">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-emerald-600" />
                    3. Preços Ofertados por Prazo ({activeTerms.length} {activeTerms.length === 1 ? "prazo" : "prazos"})
                  </span>
                  <span className="text-[10px] text-slate-500">Valores com tabela e desconto já aplicados</span>
                </div>

                {activeTerms.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {activeTerms.map((t) => {
                      const valMensal = Number(plano?.precos?.[t.key] || 0);
                      const compromisso = valMensal * t.meses;
                      return (
                        <div key={t.key} className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 space-y-1">
                          <span className="text-[11px] font-black text-slate-700 dark:text-slate-200 uppercase block">{t.label}</span>
                          <p className="text-base font-black text-purple-700 dark:text-purple-400 font-mono">
                            {brl(valMensal)}<span className="text-[10px] font-normal text-slate-500">/mês</span>
                          </p>
                          <span className="text-[10px] text-slate-500 block">
                            Compromisso total: <strong className="font-mono text-slate-700 dark:text-slate-300">{brl(compromisso)}</strong>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-amber-600">Nenhum prazo configurado com valor.</p>
                )}
              </div>

              {/* 4. 💳 Condições Comerciais & Pagamento */}
              <div className="p-4 rounded-xl bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700/80 space-y-3 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-white/5 pb-2">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
                    <CreditCard className="h-3.5 w-3.5 text-purple-600" />
                    4. Condições Comerciais & Pagamento
                  </span>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 text-xs">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-white/5">
                      <span className="text-slate-500 font-medium">Taxa de Setup:</span>
                      <span className="font-bold font-mono text-slate-800 dark:text-slate-200">
                        {newCobrarSetup && Number(newValorSetup || 0) > 0 ? (
                          brl(Number(newValorSetup))
                        ) : Number(newValorSetup || 0) > 0 ? (
                          <span className="text-emerald-600">Isento (R$ {Number(newValorSetup).toLocaleString("pt-BR")})</span>
                        ) : (
                          <span className="text-slate-500">Isento / Não aplicável</span>
                        )}
                      </span>
                    </div>

                    <div className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-white/5">
                      <span className="text-slate-500 font-medium">Validade da Proposta:</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {newValidade ? new Date(`${newValidade}T00:00:00`).toLocaleDateString("pt-BR") : "Não definida"}
                      </span>
                    </div>

                    <div className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-white/5">
                      <span className="text-slate-500 font-medium">1º Vencimento (Carência):</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {newCarencia ? `${newCarencia} dias após a contratação` : "Imediato (na contratação)"}
                      </span>
                    </div>

                    {newPaymentLink && (
                      <div className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-white/5">
                        <span className="text-slate-500 font-medium">Link de Pagamento:</span>
                        <span className="font-mono text-[10px] text-purple-600 truncate max-w-[180px]">{newPaymentLink}</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 block">Formas de Pagamento Selecionadas:</span>
                    {selectedPaymentMethods.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {selectedPaymentMethods.map((m) => (
                          <Badge key={m.id} variant="outline" className="text-[11px] font-medium bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                            {m.label} {m.parcelas ? `(${m.parcelas}x)` : ""}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400 italic">Nenhuma forma de pagamento marcada</span>
                    )}

                    {newCondicoes && (
                      <div className="pt-2">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Condições Contratuais:</span>
                        <p className="text-slate-600 dark:text-slate-300 italic mt-0.5 bg-slate-50 dark:bg-slate-800/60 p-2 rounded border border-slate-200 dark:border-slate-700">
                          {newCondicoes}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-between pt-4 border-t border-slate-100 dark:border-white/5">
                <Button variant="outline" onClick={() => setWizardStep(3)} className="border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                  Voltar
                </Button>
                <Button onClick={() => handleCreateDirectProposal(formasParaTerms(formasPgto, mesesPlano))} className="bg-gradient-to-r from-purple-700 to-indigo-600 hover:from-purple-800 hover:to-indigo-700 text-white font-black text-xs px-8 shadow-md">
                  Confirmar & Criar Proposta
                </Button>
              </div>
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
};
