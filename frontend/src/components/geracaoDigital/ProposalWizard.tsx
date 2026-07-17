import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ArrowRight, X, FileText, CheckCircle, Plus } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { calculateProposalValues } from "@/lib/geracaoDigital/proposalCalculator";
import { type PaymentTerm, termAplicaA, APLICA_A_LABELS } from "@/lib/geracaoDigital/paymentTerms";

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
    handleCreateDirectProposal: () => Promise<void>;
  };
  toast: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void;
  clientId: string | null;
  getIdToken: () => Promise<string | null>;
  onPackageCreated: (pkg: any) => void;
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
  onPackageCreated
}) => {
  const {
    wizardStep,
    setWizardStep,
    newProspect,
    setNewProspect,
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

  // Montador inline: cria um pacote SÓ para esta proposta (ad_hoc), que não
  // aparece na biblioteca de Modelos. Reaproveita gdProducts como catálogo.
  const [showMontador, setShowMontador] = React.useState<boolean>(false);
  const [mNome, setMNome] = React.useState<string>("");
  const [mPeriodo, setMPeriodo] = React.useState<string>("mensal");
  const [mValor, setMValor] = React.useState<number>(0);
  const [mProdutos, setMProdutos] = React.useState<Record<string, boolean>>({});
  const [mSaving, setMSaving] = React.useState<boolean>(false);

  const resetMontador = () => {
    setShowMontador(false); setMNome(""); setMPeriodo("mensal"); setMValor(0); setMProdutos({});
  };

  const criarPacoteAdHoc = async () => {
    const produtos = gdProducts.filter((p: any) => mProdutos[p.id]).map((p: any) => ({ product_id: p.id, nome: p.nome, origem: "gd" as const }));
    if (!mNome.trim() || produtos.length === 0) {
      toast({ title: "Faltam dados", description: "Dê um nome ao pacote e escolha ao menos 1 produto.", variant: "destructive" });
      return;
    }
    setMSaving(true);
    try {
      const token = await getIdToken();
      const res = await fetchApi("/api/gd/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          client_id: clientId,
          nome: mNome.trim(),
          tipo: "gd",
          periodo: mPeriodo,
          produtos_incluidos: produtos,
          valor: Number(mValor || 0),
          ad_hoc: true,
        }),
      });
      if (!res.ok) throw new Error("Falha ao criar o pacote.");
      const json = await res.json();
      const pkg = json.data;
      onPackageCreated(pkg);
      setNewPacotesOfertados((prev) => [...prev, pkg.id]);
      setNewPackageId(pkg.id);
      resetMontador();
      toast({ title: "Pacote criado", description: "Adicionado a esta proposta. Não aparece na biblioteca de Modelos." });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message || "Erro ao criar o pacote.", variant: "destructive" });
    } finally {
      setMSaving(false);
    }
  };

  const handleNextStep1 = () => {
    if (!newProspect.trim()) {
      toast({ title: "Atenção", description: "Por favor, digite o nome do prospect.", variant: "destructive" });
      return;
    }
    setWizardStep(2);
  };

  return (
    <Card className="bg-white dark:bg-slate-900 border-purple-200 dark:border-white/10 shadow-md overflow-hidden">
      <div className="bg-gradient-to-r from-indigo-900 via-purple-900 to-slate-900 p-6 text-white relative">
        <div className="absolute top-0 right-0 h-full w-64 bg-gradient-to-l from-purple-500/10 to-transparent pointer-events-none" />
        <div className="flex justify-between items-center relative z-10">
          <div>
            <h3 className="text-lg font-black tracking-tight">Assistente de Criação de Proposta Comercial</h3>
            <p className="text-xs text-purple-200 mt-1">Crie a proposta de forma estruturada e linear em 6 etapas simples.</p>
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
        <div className="grid grid-cols-6 gap-2 mt-6 relative z-10">
          {[
            { label: "Cliente", step: 1 },
            { label: "Pacotes", step: 2 },
            { label: "Módulos Avulsos", step: 3 },
            { label: "Condições", step: 4 },
            { label: "Revisão", step: 5 }
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

        {/* STEP 2: PACOTES (multi-seleção — o cliente escolhe um na proposta) */}
        {wizardStep === 2 && (
          <div className="space-y-5 animate-fade-in">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider block mb-1">Pacotes a Ofertar</Label>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Marque um ou vários pacotes. Todos aparecem na proposta para o cliente escolher.</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowMontador((v) => !v)}
                className="shrink-0 text-[11px] h-8 border-purple-300 text-purple-650 dark:text-purple-300"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Criar pacote pra esta proposta
              </Button>
            </div>

            {showMontador && (
              <div className="rounded-xl border border-purple-200 dark:border-purple-900/40 bg-purple-50/50 dark:bg-purple-950/10 p-4 space-y-3">
                <p className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                  Pacote exclusivo desta proposta. Não entra na biblioteca de Modelos.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1 sm:col-span-1">
                    <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Nome</Label>
                    <Input value={mNome} onChange={(e) => setMNome(e.target.value)} placeholder="Ex: Plano da Ótica Vista Clara" className="h-9 text-xs bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Período</Label>
                    <select value={mPeriodo} onChange={(e) => setMPeriodo(e.target.value)} className="w-full h-9 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg px-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none">
                      <option value="mensal">Mensal</option>
                      <option value="trimestral">Trimestral</option>
                      <option value="semestral">Semestral</option>
                      <option value="anual">Anual</option>
                      <option value="unico">Setup Único</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">{mPeriodo === "unico" ? "Valor Único (R$)" : "Valor do Período (R$)"}</Label>
                    <Input type="number" value={mValor || ""} onChange={(e) => setMValor(Number(e.target.value))} placeholder="0" className="h-9 text-xs bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Produtos incluídos</Label>
                  {gdProducts.length === 0 ? (
                    <p className="text-[10px] text-slate-400 italic">Nenhum produto no catálogo. Cadastre em Pacotes › Produtos GD.</p>
                  ) : (
                    <div className="grid gap-1.5 sm:grid-cols-2 max-h-[180px] overflow-y-auto pr-1">
                      {gdProducts.map((p: any) => (
                        <label key={p.id} className="flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                          <input type="checkbox" checked={!!mProdutos[p.id]} onChange={(e) => setMProdutos((prev) => ({ ...prev, [p.id]: e.target.checked }))} className="accent-purple-600" />
                          <span className="truncate">{p.nome}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="ghost" size="sm" onClick={resetMontador} className="text-[11px] h-8">Cancelar</Button>
                  <Button type="button" size="sm" onClick={criarPacoteAdHoc} disabled={mSaving} className="text-[11px] h-8 bg-purple-600 hover:bg-purple-700 text-white">
                    {mSaving ? "Criando..." : "Criar e ofertar"}
                  </Button>
                </div>
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-[340px] overflow-y-auto pr-1">
              {/* Mostra os Modelos (ad_hoc=false) + qualquer pacote ad_hoc já
                  ofertado nesta proposta. Pacotes ad_hoc de OUTRAS propostas
                  (que entram em availablePackages ao carregar a lista) ficam de fora. */}
              {availablePackages.filter((pk: any) => !pk.ad_hoc || newPacotesOfertados.includes(pk.id)).map((pk: any) => {
                const isOn = newPacotesOfertados.includes(pk.id);
                const meses = pk.periodo === "anual" ? 12 : pk.periodo === "semestral" ? 6 : pk.periodo === "trimestral" ? 3 : 1;
                return (
                  <button
                    key={pk.id}
                    type="button"
                    onClick={() => {
                      setNewPacotesOfertados((prev) => {
                        const next = prev.includes(pk.id) ? prev.filter((x) => x !== pk.id) : [...prev, pk.id];
                        const firstGd = next.find((id) => { const p = availablePackages.find((a: any) => a.id === id); return p && (p.tipo === "gd" || !p.tipo); }) || "";
                        const firstVexo = next.find((id) => { const p = availablePackages.find((a: any) => a.id === id); return p && p.tipo === "vexo"; }) || "";
                        setNewPackageId(firstGd);
                        setNewPackageVexoId(firstVexo);
                        return next;
                      });
                    }}
                    className={cn(
                      "p-3 rounded-xl border text-left transition-all flex flex-col gap-1.5",
                      isOn
                        ? "bg-purple-50 dark:bg-purple-950/20 border-purple-300 dark:border-purple-900/40"
                        : "bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 hover:border-purple-300"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-slate-850 dark:text-white block truncate">{pk.nome}</span>
                        <span className="text-[9px] text-slate-500 dark:text-slate-400 block">
                          {pk.tipo === "vexo" ? "Vexo OS" : "Geração Digital"} · {(Number(pk.valor || 0) / meses).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês
                        </span>
                      </div>
                      {isOn && <CheckCircle className="h-4 w-4 text-purple-600 shrink-0" />}
                    </div>
                  </button>
                );
              })}
              {availablePackages.length === 0 && (
                <p className="text-[10px] text-slate-400 italic col-span-3">Nenhum pacote cadastrado. Crie na aba Pacotes.</p>
              )}
            </div>
            {newPacotesOfertados.length > 1 && (
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block">
                {newPacotesOfertados.length} pacotes serão exibidos na proposta para o cliente escolher.
              </span>
            )}

            <div className="flex justify-between pt-4 border-t border-slate-100 dark:border-white/5">
              <Button variant="outline" onClick={() => setWizardStep(1)} className="border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                Voltar
              </Button>
              <Button onClick={() => setWizardStep(3)} className="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-6">
                Avançar
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: MÓDULOS AVULSOS */}
        {wizardStep === 3 && (
          <div className="space-y-5 animate-fade-in">
            <div className="space-y-1">
              <Label className="text-xs font-bold text-slate-800 dark:text-slate-200">Módulos Avulsos</Label>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">Selecione módulos adicionais. Os valores aparecem descritos na proposta.</p>
            </div>

            <div className="space-y-1.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-indigo-500 dark:text-indigo-300">Vexo OS</span>
              <div className="flex flex-wrap gap-1.5">
                {vexoProducts.map((p) => {
                  const isIncluded = !!newVexoAvulsoIds[p.id];
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setNewVexoAvulsoIds((prev) => ({ ...prev, [p.id]: !isIncluded }))}
                      className={cn(
                        "px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-all flex items-center gap-1",
                        isIncluded
                          ? "bg-indigo-600 text-white border-indigo-500"
                          : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300"
                      )}
                    >
                      {p.nome}{isIncluded && <CheckCircle className="h-3 w-3 shrink-0" />}
                    </button>
                  );
                })}
                {vexoProducts.length === 0 && <span className="text-[10px] text-slate-400 italic">Nenhum módulo Vexo cadastrado.</span>}
              </div>
            </div>

            <div className="space-y-1.5 pt-3 border-t border-dashed border-slate-200 dark:border-white/10">
              <span className="text-[10px] font-black uppercase tracking-wider text-pink-500 dark:text-pink-300">Geração Digital</span>
              <div className="flex flex-wrap gap-1.5">
                {gdProducts.map((p) => {
                  const isIncluded = !!newGdAvulsoIds[p.id];
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setNewGdAvulsoIds((prev) => ({ ...prev, [p.id]: !isIncluded }))}
                      className={cn(
                        "px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-all flex items-center gap-1",
                        isIncluded
                          ? "bg-pink-600 text-white border-pink-500"
                          : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-pink-300"
                      )}
                    >
                      {p.nome}{isIncluded && <CheckCircle className="h-3 w-3 shrink-0" />}
                    </button>
                  );
                })}
                {gdProducts.length === 0 && <span className="text-[10px] text-slate-400 italic">Nenhum módulo GD cadastrado.</span>}
              </div>
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

        {/* STEP 4: SETUP */}
        {/* STEP 4: CONDIÇÕES COMERCIAIS */}
        {wizardStep === 4 && (
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

            {/* Condições de pagamento a ofertar — o cliente escolhe na proposta pública */}
            <div className="space-y-2">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-350">Condições de Pagamento a Ofertar</Label>
              <p className="text-[10px] text-slate-450 dark:text-slate-500">Selecione as condições que aparecerão na proposta para o cliente escolher a que melhor se encaixa.</p>
              <div className="flex flex-wrap gap-1.5">
                {availableTerms.filter((t) => t.ativo).map((term) => {
                  const isOn = newOfferedTermIds.includes(term.id);
                  return (
                    <button
                      key={term.id}
                      type="button"
                      onClick={() => setNewOfferedTermIds((prev) => isOn ? prev.filter((x) => x !== term.id) : [...prev, term.id])}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all",
                        isOn
                          ? "bg-purple-600 text-white border-purple-500"
                          : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:border-purple-300"
                      )}
                    >
                      {term.nome} · {APLICA_A_LABELS[termAplicaA(term)]}{isOn ? " ✓" : ""}
                    </button>
                  );
                })}
                {availableTerms.filter((t) => t.ativo).length === 0 && (
                  <span className="text-[10px] text-slate-400 italic">Nenhuma condição salva. Crie na aba Condições.</span>
                )}
              </div>
            </div>

            <div className="flex justify-between pt-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setWizardStep(3)} className="border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                Voltar
              </Button>
              <Button onClick={() => setWizardStep(5)} className="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-6">
                Avançar
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 5: REVISÃO E FECHAMENTO */}
        {wizardStep === 5 && (() => {
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
                <Button variant="outline" onClick={() => setWizardStep(4)} className="border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                  Voltar
                </Button>
                <Button onClick={handleCreateDirectProposal} className="bg-gradient-to-r from-purple-700 to-indigo-600 text-white font-black text-xs px-8">
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
