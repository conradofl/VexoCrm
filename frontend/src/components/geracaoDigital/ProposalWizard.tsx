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

interface ProposalWizardProps {
  onClose: () => void;
  availablePackages: any[];
  vexoProducts: any[];
  gdProducts: any[];
  wizardState: {
    wizardStep: number;
    setWizardStep: (step: number) => void;
    newProspect: string;
    setNewProspect: (val: string) => void;
    newPackageId: string;
    setNewPackageId: (val: string) => void;
    newPackageVexoId: string;
    setNewPackageVexoId: (val: string) => void;
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
}

export const ProposalWizard: React.FC<ProposalWizardProps> = ({
  onClose,
  availablePackages,
  vexoProducts,
  gdProducts,
  wizardState,
  toast
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

  const handleNextStep1 = () => {
    if (!newProspect.trim()) {
      toast({ title: "Atenção", description: "Por favor, digite o nome do prospect.", variant: "destructive" });
      return;
    }
    setWizardStep(2);
  };

  return (
    <Card className="bg-white border-purple-200 shadow-md overflow-hidden">
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
            { label: "Vexo Avulsos", step: 3 },
            { label: "Setup", step: 4 },
            { label: "Condições", step: 5 },
            { label: "Revisão", step: 6 }
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
              <Label className="text-xs font-bold text-slate-700">Nome do Prospect / Empresa *</Label>
              <Input
                value={newProspect}
                onChange={(e) => setNewProspect(e.target.value)}
                placeholder="Ex: ACME Corp Ltda"
                className="bg-white border-slate-200 text-xs h-10 shadow-sm focus:border-indigo-500"
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

        {/* STEP 2: PACOTES */}
        {wizardStep === 2 && (
          <div className="space-y-5 animate-fade-in">
            <div className="grid gap-6 md:grid-cols-2">
              {/* GD Packages */}
              <div className="space-y-2 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <Label className="text-xs font-black text-slate-800 uppercase tracking-wider block mb-1">1. Combo Geração Digital (GD)</Label>
                <select
                  value={newPackageId}
                  onChange={(e) => setNewPackageId(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-850 h-10 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">— Sem Pacote GD —</option>
                  {availablePackages.filter(p => p.tipo === "gd" || !p.tipo).map((pk: any) => (
                    <option key={pk.id} value={pk.id}>
                      {pk.nome} ({(pk.valor / (pk.periodo === "anual" ? 12 : pk.periodo === "semestral" ? 6 : pk.periodo === "trimestral" ? 3 : 1)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês)
                    </option>
                  ))}
                </select>
                {(() => {
                  const pkg = availablePackages.find(p => p.id === newPackageId);
                  if (!pkg) return <p className="text-[10px] text-slate-400 italic mt-2">Nenhum pacote de marketing digital selecionado.</p>;
                  return (
                    <div className="mt-3 space-y-1.5">
                      <span className="text-[10px] font-bold text-slate-500 block">Itens inclusos neste pacote GD:</span>
                      <div className="flex flex-wrap gap-1">
                        {(pkg.produtos_incluidos || []).map((prod: any, idx: number) => (
                          <Badge key={idx} variant="outline" className="bg-white border-slate-200 text-slate-600 text-[9px] py-0">{prod.nome}</Badge>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Vexo Packages */}
              <div className="space-y-2 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <Label className="text-xs font-black text-slate-800 uppercase tracking-wider block mb-1">2. Combo Vexo OS (Software)</Label>
                <select
                  value={newPackageVexoId}
                  onChange={(e) => setNewPackageVexoId(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-850 h-10 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">— Sem Combo Vexo OS —</option>
                  {availablePackages.filter(p => p.tipo === "vexo").map((pk: any) => (
                    <option key={pk.id} value={pk.id}>
                      {pk.nome} ({(pk.valor / (pk.periodo === "anual" ? 12 : pk.periodo === "semestral" ? 6 : pk.periodo === "trimestral" ? 3 : 1)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês)
                    </option>
                  ))}
                </select>
                {(() => {
                  const pkg = availablePackages.find(p => p.id === newPackageVexoId);
                  if (!pkg) return <p className="text-[10px] text-slate-400 italic mt-2">Nenhum combo Vexo OS selecionado.</p>;
                  return (
                    <div className="mt-3 space-y-1.5">
                      <span className="text-[10px] font-bold text-slate-500 block">Módulos do sistema inclusos:</span>
                      <div className="flex flex-wrap gap-1">
                        {(pkg.produtos_incluidos || []).map((prod: any, idx: number) => (
                          <Badge key={idx} variant="outline" className="bg-white border-slate-200 text-slate-600 text-[9px] py-0">{prod.nome}</Badge>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="flex justify-between pt-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setWizardStep(1)} className="border-slate-200 text-slate-700">
                Voltar
              </Button>
              <Button onClick={() => setWizardStep(3)} className="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-6">
                Avançar
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: VEXO AVULSOS */}
        {wizardStep === 3 && (
          <div className="space-y-5 animate-fade-in">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-800">Módulos Extras Vexo OS (Avulsos)</Label>
              <p className="text-[10px] text-slate-500">Selecione módulos adicionais que serão somados avulsamente à mensalidade da proposta.</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 max-h-[260px] overflow-y-auto pr-1">
              {vexoProducts.map((p) => {
                const isIncluded = !!newVexoAvulsoIds[p.id];
                return (
                  <div
                    key={p.id}
                    onClick={() =>
                      setNewVexoAvulsoIds((prev) => ({
                        ...prev,
                        [p.id]: !isIncluded
                      }))
                    }
                    className={cn(
                      "p-3 rounded-lg border transition-all flex items-center justify-between cursor-pointer text-left shadow-sm",
                      isIncluded
                        ? "bg-indigo-50 border-indigo-300"
                        : "bg-white border-slate-200 hover:border-slate-350"
                    )}
                  >
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-slate-800 leading-tight block">{p.nome}</span>
                      <span className="text-[10px] font-mono font-bold text-purple-650">
                        {Number(p.valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês
                      </span>
                    </div>
                    {isIncluded && (
                      <div className="h-4 w-4 rounded-full bg-indigo-600 flex items-center justify-center shrink-0">
                        <CheckCircle className="h-2.5 w-2.5 text-white" />
                      </div>
                    )}
                  </div>
                );
              })}
              {vexoProducts.length === 0 && (
                <p className="text-xs text-slate-450 italic col-span-3 text-center py-6">Nenhum módulo cadastrado no catálogo.</p>
              )}
            </div>

            <div className="space-y-1.5 pt-4 border-t border-dashed border-slate-200">
              <Label className="text-xs font-bold text-slate-800">Módulos Extras Geração Digital (Avulsos)</Label>
              <p className="text-[10px] text-slate-500">Serviços GD avulsos somados à mensalidade da proposta.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 max-h-[260px] overflow-y-auto pr-1">
              {gdProducts.map((p) => {
                const isIncluded = !!newGdAvulsoIds[p.id];
                return (
                  <div
                    key={p.id}
                    onClick={() =>
                      setNewGdAvulsoIds((prev) => ({ ...prev, [p.id]: !isIncluded }))
                    }
                    className={cn(
                      "p-3 rounded-lg border transition-all flex items-center justify-between cursor-pointer text-left shadow-sm",
                      isIncluded ? "bg-pink-50 border-pink-300" : "bg-white border-slate-200 hover:border-slate-350"
                    )}
                  >
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-slate-800 leading-tight block">{p.nome}</span>
                      <span className="text-[10px] font-mono font-bold text-pink-600">
                        {Number(p.valor_padrao || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/{p.recorrencia === "unico" ? "único" : "mês"}
                      </span>
                    </div>
                    {isIncluded && (
                      <div className="h-4 w-4 rounded-full bg-pink-600 flex items-center justify-center shrink-0">
                        <CheckCircle className="h-2.5 w-2.5 text-white" />
                      </div>
                    )}
                  </div>
                );
              })}
              {gdProducts.length === 0 && (
                <p className="text-xs text-slate-450 italic col-span-3 text-center py-6">Nenhum módulo GD cadastrado no catálogo.</p>
              )}
            </div>

            <div className="flex justify-between pt-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setWizardStep(2)} className="border-slate-200 text-slate-700">
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
        {wizardStep === 4 && (
          <div className="space-y-5 max-w-md mx-auto py-4 animate-fade-in">
            <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-200 shadow-sm">
              <div className="space-y-0.5">
                <Label className="text-xs font-bold text-slate-800">Cobrar taxa de setup de implantação?</Label>
                <span className="text-[10px] text-slate-450 block">Cobrança única e de entrada na assinatura do contrato.</span>
              </div>
              <Switch checked={newCobrarSetup} onCheckedChange={setNewCobrarSetup} />
            </div>

            {newCobrarSetup && (
              <div className="space-y-1.5 animate-slide-down">
                <Label className="text-xs font-bold text-slate-700">Valor do Setup de Implantação (R$)</Label>
                <div className="relative">
                  <span className="absolute left-3.5 top-3 text-xs text-slate-500 font-mono">R$</span>
                  <Input
                    type="number"
                    value={newValorSetup || ""}
                    onChange={(e) => setNewValorSetup(Number(e.target.value) || 0)}
                    placeholder="Ex: 1500"
                    className="bg-white border-slate-200 text-xs pl-8 h-10 font-mono focus:border-indigo-500"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-between pt-6 border-t border-slate-100 mt-6">
              <Button variant="outline" onClick={() => setWizardStep(3)} className="border-slate-200 text-slate-700">
                Voltar
              </Button>
              <Button onClick={() => setWizardStep(5)} className="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-6">
                Avançar
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 5: CONDIÇÕES COMERCIAIS */}
        {wizardStep === 5 && (
          <div className="space-y-5 animate-fade-in">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Período de Compromisso do Plano</Label>
                <select
                  value={newPeriodo}
                  onChange={(e) => setNewPeriodo(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-850 h-10 focus:outline-none focus:border-indigo-500"
                >
                  <option value="mensal">Mensal (1 mês)</option>
                  <option value="trimestral">Trimestral (3 meses)</option>
                  <option value="semestral">Semestral (6 meses)</option>
                  <option value="anual">Anual (12 meses)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Validade da Proposta</Label>
                <Input
                  type="date"
                  value={newValidade}
                  onChange={(e) => setNewValidade(e.target.value)}
                  className="bg-white border-slate-200 text-xs h-10 focus:border-indigo-500"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">1º Vencimento da Mensalidade (carência)</Label>
                <select
                  value={newCarencia}
                  onChange={(e) => setNewCarencia(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-850 h-10 focus:outline-none focus:border-indigo-500"
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
                <Label className="text-xs font-bold text-slate-700">Condições Contratuais / Comerciais</Label>
                <Input
                  value={newCondicoes}
                  onChange={(e) => setNewCondicoes(e.target.value)}
                  placeholder="Ex: Contrato de 12 meses. Mensalidade reajustada pelo IGPM."
                  className="bg-white border-slate-200 text-xs h-10 focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Link de Checkout / Pagamento</Label>
                <Input
                  value={newPaymentLink}
                  onChange={(e) => setNewPaymentLink(e.target.value)}
                  placeholder="Ex: https://checkout.vexo.com.br/proposta"
                  className="bg-white border-slate-200 text-xs h-10 focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-between pt-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setWizardStep(4)} className="border-slate-200 text-slate-700">
                Voltar
              </Button>
              <Button onClick={() => setWizardStep(6)} className="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-6">
                Avançar
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 6: REVISÃO E FECHAMENTO */}
        {wizardStep === 6 && (() => {
          const selectedGdPkg = availablePackages.find(p => p.id === newPackageId && (p.tipo === "gd" || !p.tipo));
          const selectedVexoPkg = availablePackages.find(p => p.id === newPackageVexoId && p.tipo === "vexo");

          const tempProposal = {
            cobrar_setup: newCobrarSetup,
            valor_setup_vexo: newValorSetup,
            package_id: newPackageId || null,
            package_vexo_id: newPackageVexoId || null,
            periodo_plano: newPeriodo || "mensal",
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
                <div className="p-4 rounded-xl bg-purple-50/50 border border-purple-200">
                  <span className="text-[10px] text-purple-750 uppercase font-black tracking-wider block">Taxa de Setup</span>
                  <h4 className="text-xl font-black text-slate-800 mt-1 font-mono">
                    {calc.setupFinal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  </h4>
                  <span className="text-[9px] text-slate-500 block mt-0.5">Investimento único de entrada</span>
                </div>

                <div className="p-4 rounded-xl bg-pink-50/50 border border-pink-200">
                  <span className="text-[10px] text-pink-750 uppercase font-black tracking-wider block">Valor Mensal</span>
                  <h4 className="text-xl font-black text-pink-600 mt-1 font-mono">
                    {calc.mensalidadeFinal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês
                  </h4>
                  <span className="text-[9px] text-slate-500 block mt-0.5">Soma dos pacotes e extras</span>
                </div>

                <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-200">
                  <span className="text-[10px] text-indigo-750 uppercase font-black tracking-wider block">Compromisso do Período</span>
                  <h4 className="text-xl font-black text-indigo-600 mt-1 font-mono">
                    {calc.compromissoFinal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  </h4>
                  <span className="text-[9px] text-slate-500 block mt-0.5">Total de {calc.mesesPeriodo} {calc.mesesPeriodo === 1 ? "mês" : "meses"} de contrato</span>
                </div>
              </div>

              {/* Detail of proposal scope */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <h4 className="text-xs font-bold text-slate-850 border-b border-slate-200 pb-1.5 uppercase tracking-wider">Escopo da Proposta ({newProspect})</h4>
                <div className="space-y-2">
                  {selectedGdPkg && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-slate-800">Combo GD: {selectedGdPkg.nome}</span>
                      <span className="font-mono text-slate-500">{(selectedGdPkg.valor / (selectedGdPkg.periodo === "anual" ? 12 : 1)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}/mês</span>
                    </div>
                  )}
                  {selectedVexoPkg && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-slate-800">Combo Vexo OS: {selectedVexoPkg.nome}</span>
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
                <Button variant="outline" onClick={() => setWizardStep(5)} className="border-slate-200 text-slate-700">
                  Voltar
                </Button>
                <Button onClick={handleCreateDirectProposal} className="bg-gradient-to-r from-purple-600 to-pink-500 text-white font-black text-xs px-8">
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
