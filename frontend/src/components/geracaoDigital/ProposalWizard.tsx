import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ArrowRight, X, FileText, CheckCircle } from "lucide-react";
import { calculateProposalValues } from "@/lib/geracaoDigital/proposalCalculator";
import { type PaymentTerm, termAplicaA, APLICA_A_LABELS } from "@/lib/geracaoDigital/paymentTerms";
import PlanoEditor from "@/components/geracaoDigital/PlanoEditor";
import { type Plano, planoVazio, planoValido } from "@/lib/geracaoDigital/plano";
import { syncPlanoPackages } from "@/lib/geracaoDigital/planoSync";
import FormasPagamentoEditor from "@/components/geracaoDigital/FormasPagamentoEditor";
import { type FormasSelecionadas, formasVazias, formasParaTerms } from "@/lib/geracaoDigital/formasPagamento";
import { PERIODOS, mesesDoPeriodo, prazosOfertados } from "@/lib/geracaoDigital/plano";

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
  segmentsList
}) => {
  const {
    wizardStep,
    setWizardStep,
    newProspect,
    setNewProspect,
    newSegmentId,
    setNewSegmentId,
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

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-350">Segmento</Label>
              <select
                value={newSegmentId}
                onChange={(e) => setNewSegmentId(e.target.value)}
                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 h-10 text-xs text-slate-800 dark:text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="">Selecione o segmento…</option>
                {segmentsList.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </select>
              <p className="text-[10px] text-slate-400 italic">Define o roteiro da apresentação comercial ao iniciar a partir desta proposta.</p>
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
            {/* Fase 4: taxa de Setup passa a viver AQUI, no mesmo formulário de
                criação. Antes só existia no painel de configuração pós-criação,
                o que obrigava um segundo salvamento (e era esse save que
                derrubava os pacotes ofertados). */}
            <div className="rounded-xl border border-purple-200 dark:border-purple-900/40 bg-purple-50/50 dark:bg-purple-950/10 p-4">
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                  {/* "Isentar" em vez de "Cobrar": a ação da mesa é conceder
                      a cortesia. Valor > 0 + isento faz a proposta mostrar o
                      valor riscado com "Isento". */}
                  <input
                    type="checkbox"
                    checked={!newCobrarSetup}
                    onChange={(e) => setNewCobrarSetup(!e.target.checked)}
                    className="accent-purple-600"
                  />
                  Isentar setup
                </label>
                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Valor do Setup (R$)</Label>
                  <Input
                    type="number"
                    value={newValorSetup || ""}
                    onChange={(e) => setNewValorSetup(Number(e.target.value))}
                    placeholder="0"
                    className="h-9 w-40 text-xs bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10"
                  />
                </div>
                {!newCobrarSetup && Number(newValorSetup || 0) > 0 && (
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 pb-2">
                    Isento — o cliente vê R$ {Number(newValorSetup).toLocaleString("pt-BR")} riscado
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2">
                Investimento único de entrada. Ao isentar, deixe o valor preenchido:
                a proposta mostra ele riscado com "Isento" ao lado, deixando a
                cortesia visível para o cliente.
              </p>
            </div>

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

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-350">Condições Contratuais / Comerciais</Label>
                <Input
                  value={newCondicoes}
                  onChange={(e) => setNewCondicoes(e.target.value)}
                  placeholder="Ex: Contrato de 12 meses. Mensalidade reajustada pelo IGPM."
                  className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-xs dark:text-white h-10 focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-350">Link de Checkout / Pagamento</Label>
                <Input
                  value={newPaymentLink}
                  onChange={(e) => setNewPaymentLink(e.target.value)}
                  placeholder="Ex: https://checkout.vexo.com.br/proposta"
                  className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-xs dark:text-white h-10 focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Formas fixas de pagamento — caminho principal. */}
            <div className="pt-2 border-t border-slate-100 dark:border-white/5">
              <FormasPagamentoEditor
                formas={formasPgto}
                onChange={setFormasPgto}
                totalSetup={newCobrarSetup ? Number(newValorSetup || 0) : 0}
                mensalidade={mensalidadePlano}
                meses={mesesPlano}
              />
            </div>


            <div className="flex justify-between pt-4 border-t border-slate-100">
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

        {/* STEP 5: REVISÃO E FECHAMENTO */}
        {wizardStep === 4 && (() => {
          const selectedGdPkg = availablePackages.find(p => p.id === newPackageId && (p.tipo === "gd" || !p.tipo));
          const selectedVexoPkg = availablePackages.find(p => p.id === newPackageVexoId && p.tipo === "vexo");

          const tempProposal = {
            cobrar_setup: newCobrarSetup,
            valor_setup_vexo: newValorSetup,
            package_id: newPackageId || null,
            package_vexo_id: newPackageVexoId || null,
            periodo_plano: selectedGdPkg?.periodo || selectedVexoPkg?.periodo || "mensal",
            itens: [
              ...(selectedGdPkg ? [{ categoria: "gd", valor: 0 }] : []),
              ...(selectedVexoPkg ? [{ categoria: "vexo", valor: 0 }] : []),
              ...Object.entries(newVexoAvulsoIds).filter(([_, checked]) => checked).map(([id]) => {
                const prod = vexoProducts.find(vp => vp.id === id);
                return {
                  product_id: id,
                  categoria: "vexo",
                  valor: prod ? Number(prod.valor) : 0,
                  descricao: prod ? prod.nome : ""
                };
              })
            ]
          };

          const calc = calculateProposalValues(tempProposal, availablePackages);

          return (
            <div className="space-y-6 animate-fade-in">
              {/* Financial blocks */}
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="p-4 rounded-xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/40">
                  <span className="text-[10px] text-purple-750 dark:text-purple-300 uppercase font-black tracking-wider block">Taxa de Setup</span>
                  <h4 className="text-xl font-black text-slate-800 dark:text-slate-100 mt-1 font-mono">
                    {calc.setupFinal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  </h4>
                  <span className="text-[9px] text-slate-500 block mt-0.5">Investimento único de entrada</span>
                </div>

                <div className="p-4 rounded-xl bg-pink-50/50 dark:bg-pink-950/20 border border-pink-200 dark:border-pink-900/40">
                  <span className="text-[10px] text-pink-750 dark:text-pink-300 uppercase font-black tracking-wider block">Valor Mensal</span>
                  <h4 className="text-xl font-black text-pink-600 mt-1 font-mono">
                    {calc.mensalidadeFinal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês
                  </h4>
                  <span className="text-[9px] text-slate-500 block mt-0.5">Soma dos pacotes e extras</span>
                </div>

                <div className="p-4 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/40">
                  <span className="text-[10px] text-indigo-750 dark:text-indigo-300 uppercase font-black tracking-wider block">Compromisso do Período</span>
                  <h4 className="text-xl font-black text-indigo-600 mt-1 font-mono">
                    {calc.compromissoFinal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  </h4>
                  <span className="text-[9px] text-slate-500 block mt-0.5">Total de {calc.mesesPeriodo} {calc.mesesPeriodo === 1 ? "mês" : "meses"} de contrato</span>
                </div>
              </div>

              {/* Detail of proposal scope */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-3">
                <h4 className="text-xs font-bold text-slate-850 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700 pb-1.5 uppercase tracking-wider">Escopo da Proposta ({newProspect})</h4>
                <div className="space-y-2">
                  {selectedGdPkg && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">Combo GD: {selectedGdPkg.nome}</span>
                      <span className="font-mono text-slate-500">{(selectedGdPkg.valor / (selectedGdPkg.periodo === "anual" ? 12 : 1)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês</span>
                    </div>
                  )}
                  {selectedVexoPkg && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">Combo Vexo OS: {selectedVexoPkg.nome}</span>
                      <span className="font-mono text-slate-500">{(selectedVexoPkg.valor / (selectedVexoPkg.periodo === "anual" ? 12 : 1)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês</span>
                    </div>
                  )}
                  {Object.entries(newVexoAvulsoIds).filter(([_, checked]) => checked).map(([id]) => {
                    const prod = vexoProducts.find(vp => vp.id === id);
                    if (!prod) return null;
                    return (
                      <div key={id} className="flex justify-between items-center text-xs pl-3 border-l-2 border-slate-300">
                        <span className="text-slate-650">Vexo Extra: {prod.nome}</span>
                        <span className="font-mono text-slate-500">{Number(prod.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-between pt-4 border-t border-slate-100">
                <Button variant="outline" onClick={() => setWizardStep(3)} className="border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                  Voltar
                </Button>
                <Button onClick={() => handleCreateDirectProposal(formasParaTerms(formasPgto))} className="bg-gradient-to-r from-purple-700 to-indigo-600 text-white font-black text-xs px-8">
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
