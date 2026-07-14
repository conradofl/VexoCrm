import { useState, useEffect } from "react";
import { PageShell } from "@/components/PageShell";
import { GeracaoDigitalTabs } from "@/components/GeracaoDigitalTabs";
import { toast } from "@/components/ui/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CreditCard, Plus, Trash2, Copy, Pencil, X } from "lucide-react";
import {
  type PaymentTerm,
  type PaymentTermTipo,
  type PaymentTermConfig,
  type PaymentTermAplicaA,
  PAYMENT_TERM_TIPOS,
  APLICA_A_LABELS,
  termAplicaA,
  computePaymentBreakdown
} from "@/lib/geracaoDigital/paymentTerms";

const EXEMPLO_TOTAL = 10000;

const EMPTY_FORM: { nome: string; tipo: PaymentTermTipo; config: PaymentTermConfig; aplica_a: PaymentTermAplicaA } = {
  nome: "",
  tipo: "avista_desconto",
  config: {},
  aplica_a: "setup"
};

export default function GeracaoDigitalPaymentTerms() {
  const { isAuthenticated, getIdToken, clientId } = useAuth();

  const [terms, setTerms] = useState<PaymentTerm[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    if (isAuthenticated) {
      loadTerms();
    }
  }, [isAuthenticated, clientId]);

  async function authHeaders(json = false): Promise<HeadersInit> {
    const token = await getIdToken();
    const headers: HeadersInit = json ? { "Content-Type": "application/json" } : {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }

  async function loadTerms() {
    try {
      setIsLoading(true);
      const headers = await authHeaders();
      const res = await fetchApi(`/api/gd/payment-terms?client_id=${clientId || ""}`, { headers });
      if (!res.ok) throw new Error(`Falha ao buscar condições (Status ${res.status}).`);
      const data = await res.json();
      if (data.success) {
        setTerms(data.data);
      }
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Erro ao Carregar",
        description: err.message || "Não foi possível carregar as condições de pagamento.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  }

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (term: PaymentTerm) => {
    setEditingId(term.id);
    setForm({ nome: term.nome, tipo: term.tipo, config: term.config || {}, aplica_a: termAplicaA(term) });
    setShowForm(true);
  };

  const updateConfig = (field: keyof PaymentTermConfig, value: any) => {
    setForm((prev) => ({ ...prev, config: { ...prev.config, [field]: value } }));
  };

  const handleSave = async () => {
    if (!form.nome.trim()) {
      toast({ title: "Nome obrigatório", description: "Dê um nome à condição (ex: À vista 10% off).", variant: "destructive" });
      return;
    }
    try {
      const headers = await authHeaders(true);
      const body = JSON.stringify({ client_id: clientId, nome: form.nome, tipo: form.tipo, config: form.config, aplica_a: form.aplica_a });
      const res = editingId
        ? await fetchApi(`/api/gd/payment-terms/${editingId}`, { method: "PUT", headers, body })
        : await fetchApi(`/api/gd/payment-terms`, { method: "POST", headers, body });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Erro ao salvar condição de pagamento.");
      }
      toast({ title: editingId ? "Condição Atualizada" : "Condição Criada", description: form.nome });
      setShowForm(false);
      loadTerms();
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro ao Salvar", description: err.message, variant: "destructive" });
    }
  };

  const handleToggleAtivo = async (term: PaymentTerm) => {
    try {
      const headers = await authHeaders(true);
      const res = await fetchApi(`/api/gd/payment-terms/${term.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ client_id: clientId, ativo: !term.ativo })
      });
      if (!res.ok) throw new Error("Erro ao alterar status da condição.");
      loadTerms();
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const handleDuplicate = async (term: PaymentTerm) => {
    try {
      const headers = await authHeaders(true);
      const res = await fetchApi(`/api/gd/payment-terms/${term.id}/duplicate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ client_id: clientId })
      });
      if (!res.ok) throw new Error("Erro ao duplicar condição.");
      toast({ title: "Condição Duplicada", description: `${term.nome} (cópia)` });
      loadTerms();
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const handleDelete = async (term: PaymentTerm) => {
    if (!window.confirm(`Excluir a condição "${term.nome}"? Esta ação não pode ser desfeita.`)) return;
    try {
      const headers = await authHeaders();
      const res = await fetchApi(`/api/gd/payment-terms/${term.id}?client_id=${clientId || ""}`, {
        method: "DELETE",
        headers
      });
      if (!res.ok) throw new Error("Erro ao excluir condição.");
      toast({ title: "Condição Excluída", description: term.nome });
      loadTerms();
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const previewBreakdown = computePaymentBreakdown(form, EXEMPLO_TOTAL);

  return (
    <PageShell
      title="Condições de Pagamento GD"
      subtitle="Crie condições reutilizáveis para ofertar nas propostas comerciais: à vista, entrada + parcelas, cartão, boleto e mais."
      icon={CreditCard}
    >
      <GeracaoDigitalTabs />
      <div className="w-full bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 rounded-3xl p-6 border border-slate-200 dark:border-white/10 shadow-sm space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="text-xs font-mono font-bold text-purple-600 dark:text-purple-400 uppercase tracking-widest">Condições Salvas</h3>
          <Button size="sm" onClick={openCreate} className="bg-purple-600 hover:bg-purple-500 text-xs font-bold text-white">
            <Plus className="h-3.5 w-3.5 mr-1" />
            Nova Condição
          </Button>
        </div>

        {showForm && (
          <Card className="bg-slate-50 dark:bg-slate-850 border-purple-200 dark:border-purple-900/50">
            <CardHeader className="flex flex-row justify-between items-center space-y-0">
              <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-100">
                {editingId ? "Editar Condição" : "Nova Condição de Pagamento"}
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setShowForm(false)} className="h-7 w-7 text-slate-500 dark:text-slate-400">
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Nome (texto livre)</Label>
                  <Input
                    value={form.nome}
                    onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))}
                    placeholder='Ex: "À vista 10% off"'
                    className="bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 text-xs h-9 text-slate-900 dark:text-slate-100"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Tipo</Label>
                  <select
                    value={form.tipo}
                    onChange={(e) => setForm((p) => ({ ...p, tipo: e.target.value as PaymentTermTipo, config: {} }))}
                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded px-2 py-1 text-xs text-slate-850 dark:text-slate-200 h-9"
                  >
                    {PAYMENT_TERM_TIPOS.map((t) => (
                      <option key={t.value} value={t.value} className="dark:bg-slate-800">{t.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Aplica-se a</Label>
                  <select
                    value={form.aplica_a}
                    onChange={(e) => setForm((p) => ({ ...p, aplica_a: e.target.value as PaymentTermAplicaA }))}
                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded px-2 py-1 text-xs text-slate-850 dark:text-slate-200 h-9"
                  >
                    <option value="setup" className="dark:bg-slate-800">Setup / Entrada (valor único)</option>
                    <option value="mensalidade" className="dark:bg-slate-800">Mensalidade (recorrente)</option>
                  </select>
                  <span className="text-[9px] text-slate-450 dark:text-slate-500 block">
                    O desdobramento incide só sobre essa base — setup e mensalidade nunca se somam.
                  </span>
                </div>
              </div>

              {/* Campos condicionais por tipo */}
              <div className="grid gap-4 md:grid-cols-3">
                {form.tipo === "avista_desconto" && (
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">% de desconto</Label>
                    <Input
                      type="number"
                      value={form.config.percentual_desconto ?? ""}
                      onChange={(e) => updateConfig("percentual_desconto", Number(e.target.value) || 0)}
                      className="bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 text-xs h-9 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                )}
                {form.tipo === "entrada_parcelas" && (
                  <>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Valor da entrada (R$)</Label>
                      <Input
                        type="number"
                        value={form.config.valor_entrada ?? ""}
                        onChange={(e) => updateConfig("valor_entrada", Number(e.target.value) || 0)}
                        className="bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 text-xs h-9 text-slate-900 dark:text-slate-100"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Nº de parcelas</Label>
                      <Input
                        type="number"
                        value={form.config.num_parcelas ?? ""}
                        onChange={(e) => updateConfig("num_parcelas", Number(e.target.value) || 1)}
                        className="bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 text-xs h-9 text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  </>
                )}
                {(form.tipo === "parcelado_cartao" || form.tipo === "boleto_recorrente" || form.tipo === "semanal") && (
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Nº de parcelas</Label>
                    <Input
                      type="number"
                      value={form.config.num_parcelas ?? ""}
                      onChange={(e) => updateConfig("num_parcelas", Number(e.target.value) || 1)}
                      className="bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 text-xs h-9 text-slate-900 dark:text-slate-100"
                    />
                  </div>
                )}
                {(form.tipo === "avista_desconto" || form.tipo === "entrada_parcelas") && (
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Meio de pagamento</Label>
                    <select
                      value={form.config.meio ?? ""}
                      onChange={(e) => updateConfig("meio", e.target.value || undefined)}
                      className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded px-2 py-1 text-xs text-slate-850 dark:text-slate-200 h-9"
                    >
                      <option value="" className="dark:bg-slate-800">— opcional —</option>
                      <option value="pix" className="dark:bg-slate-800">PIX</option>
                      <option value="cartao" className="dark:bg-slate-800">Cartão</option>
                      <option value="boleto" className="dark:bg-slate-800">Boleto</option>
                    </select>
                  </div>
                )}
                {form.tipo === "custom" && (
                  <div className="space-y-1 md:col-span-3">
                    <Label className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Descrição da condição</Label>
                    <textarea
                      value={form.config.descricao ?? ""}
                      onChange={(e) => updateConfig("descricao", e.target.value)}
                      className="w-full min-h-[70px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg p-3 text-xs text-slate-800 dark:text-slate-200"
                      placeholder="Ex: 50% na assinatura e 50% na entrega, via PIX."
                    />
                  </div>
                )}
              </div>

              {/* Preview do desdobramento */}
              <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/30">
                <span className="text-[9px] text-purple-600 dark:text-purple-400 font-mono font-bold uppercase tracking-wider block mb-1">
                  Prévia (sobre um total de exemplo de R$ {EXEMPLO_TOTAL.toLocaleString("pt-BR")})
                </span>
                {previewBreakdown.linhas.map((linha, idx) => (
                  <p key={idx} className="text-xs text-slate-700 dark:text-slate-300 font-medium">{linha}</p>
                ))}
              </div>

              <Button onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs">
                {editingId ? "Salvar Alterações" : "Criar Condição"}
              </Button>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <span className="animate-spin h-8 w-8 border-4 border-purple-600 border-t-transparent rounded-full" />
          </div>
        ) : terms.length === 0 ? (
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 text-center py-10">
            <CardContent className="space-y-2">
              <CreditCard className="h-10 w-10 text-slate-400 dark:text-slate-500 mx-auto" />
              <p className="text-xs text-slate-500 dark:text-slate-400">Nenhuma condição cadastrada. Crie a primeira para ofertar nas propostas.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {terms.map((term) => {
              const breakdown = computePaymentBreakdown(term, EXEMPLO_TOTAL);
              return (
                <Card
                  key={term.id}
                  className={cn(
                    "border shadow-sm flex flex-col justify-between",
                    term.ativo
                      ? "bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10"
                      : "bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-white/10 opacity-60"
                  )}
                >
                  <CardHeader className="pb-2 space-y-1">
                    <div className="flex justify-between items-start gap-2">
                      <CardTitle className="text-sm font-black text-slate-800 dark:text-slate-100 leading-tight">{term.nome}</CardTitle>
                      <Badge className={cn("text-[9px] font-bold border-none shrink-0", term.ativo ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500")}>
                        {term.ativo ? "Ativa" : "Inativa"}
                      </Badge>
                    </div>
                    <CardDescription className="text-[10px] text-slate-500 dark:text-slate-450 flex items-center gap-1.5">
                      {PAYMENT_TERM_TIPOS.find((t) => t.value === term.tipo)?.label || term.tipo}
                      <Badge className={cn(
                        "text-[8px] font-bold border-none px-1.5 py-0",
                        termAplicaA(term) === "mensalidade" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                      )}>
                        {APLICA_A_LABELS[termAplicaA(term)]}
                      </Badge>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-[10px] text-slate-600 dark:text-slate-350 bg-slate-50 dark:bg-slate-800 rounded p-2 border border-slate-100 dark:border-white/5">
                      {breakdown.linhas.map((linha, idx) => (
                        <p key={idx}>{linha}</p>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5">
                        <Switch checked={term.ativo} onCheckedChange={() => handleToggleAtivo(term)} className="scale-75" />
                        <span className="text-[9px] text-slate-500 dark:text-slate-400 font-mono">{term.ativo ? "ativa" : "inativa"}</span>
                      </div>
                      <div className="flex gap-0.5">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(term)} className="h-7 w-7 text-slate-500 hover:text-indigo-600">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDuplicate(term)} className="h-7 w-7 text-slate-500 hover:text-purple-600">
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(term)} className="h-7 w-7 text-red-500 hover:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}
