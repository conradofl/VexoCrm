import { useState, useEffect } from "react";
import { PageShell } from "@/components/PageShell";
import { GeracaoDigitalTabs } from "@/components/GeracaoDigitalTabs";
import { toast } from "@/components/ui/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { isCobrancaUnica } from "@/lib/geracaoDigital/proposalCalculator";
import { Layers, Plus, Trash2, Edit2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ProductApi {
  id: string;
  nome: string;
  descricao?: string | null;
  valor_padrao?: number | string | null;
  recorrencia: string;
  ativo?: boolean;
}

interface VexoProduct {
  id: string;
  nome: string;
  descricao: string;
  valor: number;
  valor_vp?: number | string | null;
  recorrencia: string;
  ativo: boolean;
}

export default function GeracaoDigitalPackages() {
  const { isAuthenticated, getIdToken, clientId } = useAuth();

  // State
  const [activeSection, setActiveSection] = useState<"vexo-products" | "gd-products">("gd-products");
  // Seção de módulos parametrizada: "vexo-products" e "gd-products" reusam o mesmo form/lista
  const moduleOrigin: "gd" | "vexo" = activeSection === "gd-products" ? "gd" : "vexo";
  const [products, setProducts] = useState<ProductApi[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Vexo Products CRUD state
  const [vexoProducts, setVexoProducts] = useState<VexoProduct[]>([]);
  const [vexoVpActive, setVexoVpActive] = useState<boolean>(false);
  const [vexoVpValue, setVexoVpValue] = useState<number>(0);
  const [isVexoEditing, setIsVexoEditing] = useState<boolean>(false);
  const [selectedVexoProduct, setSelectedVexoProduct] = useState<VexoProduct | null>(null);
  const [vexoNome, setVexoNome] = useState<string>("");
  const [vexoDescricao, setVexoDescricao] = useState<string>("");
  const [vexoValor, setVexoValor] = useState<number>(0);
  const [vexoRecorrencia, setVexoRecorrencia] = useState<string>("mensal");
  const [vexoAtivo, setVexoAtivo] = useState<boolean>(true);

  // Load products
  useEffect(() => {
    if (isAuthenticated) {
      loadProducts();
      loadVexoProducts();
    }
  }, [isAuthenticated, clientId]);

  async function loadProducts() {
    try {
      const token = await getIdToken();
      const headers: HeadersInit = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetchApi(`/api/gd/products?client_id=${clientId || ""}&include_inactive=1`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setProducts(data.data);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function loadVexoProducts() {
    try {
      setIsLoading(true);
      const token = await getIdToken();
      const headers: HeadersInit = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetchApi(`/api/gd/vexo-products?client_id=${clientId || ""}`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setVexoProducts(data.data);
        }
      }
    } catch (err) {
      console.error("Erro ao carregar vexo-products:", err);
    } finally {
      setIsLoading(false);
    }
  }

  // ================= VEXO PRODUCTS CRUD HANDLERS =================
  const handleOpenVexoCreate = () => {
    setSelectedVexoProduct(null);
    setVexoNome("");
    setVexoDescricao("");
    setVexoValor(0);
    setVexoVpActive(false);
    setVexoVpValue(0);
    setVexoRecorrencia("mensal");
    setVexoAtivo(true);
    setIsVexoEditing(true);
  };

  const handleOpenVexoEdit = (prod: VexoProduct) => {
    setSelectedVexoProduct(prod);
    setVexoNome(prod.nome);
    setVexoDescricao(prod.descricao || "");
    setVexoValor(prod.valor);
    setVexoVpActive(!!prod.valor_vp);
    setVexoVpValue(Number(prod.valor_vp || 0));
    setVexoRecorrencia(prod.recorrencia);
    setVexoAtivo(prod.ativo);
    setIsVexoEditing(true);
  };

  const handleSaveVexoProduct = async () => {
    if (!vexoNome.trim()) {
      toast({
        title: "Nome Obrigatório",
        description: "Por favor, insira o nome do módulo Vexo.",
        variant: "destructive"
      });
      return;
    }
    try {
      const token = await getIdToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const body = moduleOrigin === "gd"
        ? {
            client_id: clientId,
            nome: vexoNome,
            descricao: vexoDescricao,
            valor_padrao: Number(vexoValor || 0),
            valor_vp: vexoVpActive ? Number(vexoVpValue || 0) : null,
            recorrencia: vexoRecorrencia,
            ativo: vexoAtivo
          }
        : {
            client_id: clientId,
            nome: vexoNome,
            descricao: vexoDescricao,
            valor: Number(vexoValor || 0),
            valor_vp: vexoVpActive ? Number(vexoVpValue || 0) : null,
            recorrencia: vexoRecorrencia,
            ativo: vexoAtivo
          };

      const baseUrl = moduleOrigin === "gd" ? "/api/gd/products" : "/api/gd/vexo-products";
      const url = selectedVexoProduct ? `${baseUrl}/${selectedVexoProduct.id}` : baseUrl;
      const method = selectedVexoProduct ? "PUT" : "POST";

      const res = await fetchApi(url, {
        method,
        headers,
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        throw new Error("Erro ao salvar módulo Vexo.");
      }

      toast({
        title: selectedVexoProduct ? "Módulo Atualizado" : "Módulo Criado",
        description: "O módulo Vexo OS foi salvo com sucesso."
      });

      setIsVexoEditing(false);
      if (moduleOrigin === "gd") loadProducts(); else loadVexoProducts();
    } catch (err) {
      console.error(err);
      toast({
        title: "Erro ao Salvar",
        description: "Não foi possível salvar o módulo Vexo no servidor.",
        variant: "destructive"
      });
    }
  };

  const handleDeleteVexoProduct = async (id: string) => {
    if (!window.confirm("Deseja realmente excluir este módulo Vexo? Esta ação não pode ser desfeita.")) {
      return;
    }
    try {
      const token = await getIdToken();
      const headers: HeadersInit = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetchApi(
        moduleOrigin === "gd"
          ? `/api/gd/products/${id}?client_id=${clientId || ""}`
          : `/api/gd/vexo-products/${id}?client_id=${clientId || ""}`,
        { method: "DELETE", headers }
      );
      if (res.ok) {
        toast({
          title: moduleOrigin === "gd" ? "Módulo Desativado" : "Módulo Removido",
          description: moduleOrigin === "gd" ? "O módulo GD foi desativado (pode estar em pacotes antigos)." : "O módulo Vexo foi excluído com sucesso."
        });
        if (moduleOrigin === "gd") loadProducts(); else loadVexoProducts();
      } else {
        throw new Error("Erro ao excluir módulo.");
      }
    } catch (err) {
      console.error(err);
      toast({
        title: "Erro ao Excluir",
        description: "Não foi possível excluir o módulo Vexo.",
        variant: "destructive"
      });
    }
  };

  const handleToggleVexoActive = async (prod: VexoProduct, newStatus: boolean) => {
    try {
      const token = await getIdToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const body = moduleOrigin === "gd"
        ? { client_id: clientId, ativo: newStatus }
        : {
            client_id: clientId,
            nome: prod.nome,
            descricao: prod.descricao,
            valor: prod.valor,
            recorrencia: prod.recorrencia,
            ativo: newStatus
          };

      const res = await fetchApi(
        moduleOrigin === "gd" ? `/api/gd/products/${prod.id}` : `/api/gd/vexo-products/${prod.id}`,
        { method: "PUT", headers, body: JSON.stringify(body) }
      );

      if (!res.ok) {
        throw new Error("Erro ao atualizar status do módulo.");
      }

      toast({
        title: newStatus ? "Módulo Ativado" : "Módulo Desativado",
        description: `O módulo foi ${newStatus ? "ativado" : "desativado"} com sucesso.`
      });
      if (moduleOrigin === "gd") loadProducts(); else loadVexoProducts();
    } catch (err) {
      console.error(err);
      toast({
        title: "Erro ao Atualizar",
        description: "Não foi possível atualizar o status do módulo.",
        variant: "destructive"
      });
    }
  };

  return (
    <PageShell
      title="Configurações Comerciais GD"
      subtitle="Monte e gerencie templates de pacotes fechados e valores dos módulos Vexo OS."
      icon={Layers}
    >
      <GeracaoDigitalTabs />

      <div className="w-full min-h-screen bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 rounded-3xl p-6 border border-slate-200 dark:border-white/10 shadow-sm relative overflow-hidden">

        {/* Glow Effects */}
        <div className="absolute top-0 right-0 h-96 w-96 bg-purple-50 dark:bg-purple-950/20 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 h-96 w-96 bg-pink-50 dark:bg-pink-950/20 rounded-full blur-[100px] pointer-events-none" />

        {/* Toggle between Pacotes and Módulos Vexo */}
        <div className="flex justify-center mb-8 relative z-10">
          <div className="bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-white/10 flex gap-1">
                        <button
              onClick={() => {
                setActiveSection("gd-products");
                setIsVexoEditing(false);
              }}
              className={cn(
                "px-5 py-2 rounded-lg text-xs font-bold transition-all",
                activeSection === "gd-products"
                  ? "bg-white dark:bg-slate-800 text-purple-650 dark:text-purple-400 shadow-sm"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              )}
            >
              Módulos Geração Digital
            </button>
                        <button
              onClick={() => {
                setActiveSection("vexo-products");
                setIsVexoEditing(false);
              }}
              className={cn(
                "px-5 py-2 rounded-lg text-xs font-bold transition-all",
                activeSection === "vexo-products"
                  ? "bg-white dark:bg-slate-800 text-purple-650 dark:text-purple-400 shadow-sm"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              )}
            >
              Módulos Vexo OS
            </button>
          </div>
        </div>


        {/* SECTION 2: VEXO PRODUCTS CRUD */}
        {(activeSection === "vexo-products" || activeSection === "gd-products") && (
          <>
            {/* Top Header Controls */}
            <div className="flex justify-between items-center mb-8 relative z-10 border-b border-slate-200 pb-4">
              <div className="space-y-0.5">
                <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">
                  {moduleOrigin === "gd" ? "Catálogo de Módulos Geração Digital (avulsos)" : "Catálogo de Módulos Vexo OS"}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {moduleOrigin === "gd"
                    ? "Serviços GD vendidos avulsos, fora de pacote — nome, descrição, valor mensal e recorrência."
                    : "Configure as opções de módulos e funcionalidades Vexo com valores e recorrências editáveis."}
                </p>
              </div>
              {!isVexoEditing && (
                <Button onClick={handleOpenVexoCreate} size="sm" className="bg-gradient-to-r from-purple-700 to-indigo-600 font-extrabold text-white text-xs">
                  <Plus className="h-4 w-4 mr-1.5" />
                  Novo Módulo
                </Button>
              )}
            </div>

            {/* 1. Vexo Product Form Editor */}
            {isVexoEditing ? (
              <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 max-w-2xl mx-auto relative z-10 animate-fade-in shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <Layers className="h-4.5 w-4.5 text-purple-650" />
                    {selectedVexoProduct ? (moduleOrigin === "gd" ? "Editar Módulo GD" : "Editar Módulo Vexo OS") : (moduleOrigin === "gd" ? "Novo Módulo GD" : "Novo Módulo Vexo OS")}
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500 dark:text-slate-400">Preencha os campos para salvar as configurações do módulo Vexo.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-550 dark:text-slate-400 font-medium">Nome do Módulo</Label>
                      <Input
                        value={vexoNome}
                        onChange={(e) => setVexoNome(e.target.value)}
                        placeholder="Ex: Agente de IA / SDR"
                        className="bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 text-xs text-slate-800 dark:text-slate-100"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-550 dark:text-slate-400 font-medium">Recorrência comercial</Label>
                      <select
                        value={vexoRecorrencia}
                        onChange={(e) => setVexoRecorrencia(e.target.value)}
                        className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none h-10"
                      >
                        <option value="mensal" className="dark:bg-slate-850">Mensal</option>
                        <option value="unico" className="dark:bg-slate-850">Pagamento Único</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-550 dark:text-slate-400 font-medium">Descrição detalhada</Label>
                    <Input
                      value={vexoDescricao}
                      onChange={(e) => setVexoDescricao(e.target.value)}
                      placeholder="Ex: Agente inteligente para prospecção ativa via WhatsApp."
                      className="bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 text-xs text-slate-800 dark:text-slate-100"
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 items-center">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-550 dark:text-slate-400 font-medium">Valor de Venda (R$)</Label>
                      <Input
                        type="number"
                        value={vexoValor || ""}
                        onChange={(e) => setVexoValor(e.target.value === "" ? 0 : Number(e.target.value))}
                        placeholder="Ex: 980"
                        className="bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 text-xs text-slate-800 dark:text-slate-100 font-mono"
                      />
                    </div>

                    <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 shadow-sm mt-4">
                      <div className="space-y-0.5">
                        <Label className="text-[11px] text-slate-700 dark:text-slate-300 font-bold">Módulo Ativo</Label>
                        <span className="text-[8px] text-slate-500 dark:text-slate-400 block">Exibir nas opções de fechamento</span>
                      </div>
                      <Switch checked={vexoAtivo} onCheckedChange={setVexoAtivo} />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 items-center border-t border-slate-100 dark:border-white/5 dark:border-white/5 pt-3">
                    <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 shadow-sm h-14">
                      <div className="space-y-0.5">
                        <Label className="text-[11px] text-slate-700 dark:text-slate-300 font-bold">Ativar VP (Permuta)</Label>
                        <span className="text-[8px] text-slate-500 dark:text-slate-400 block">Este módulo aceita permuta</span>
                      </div>
                      <Switch checked={vexoVpActive} onCheckedChange={setVexoVpActive} />
                    </div>

                    {vexoVpActive ? (
                      <div className="space-y-1.5 animate-fade-in">
                        <Label className="text-xs text-slate-550 dark:text-slate-400 font-medium">Valor em VP (R$)</Label>
                        <Input
                          type="number"
                          value={vexoVpValue || ""}
                          onChange={(e) => setVexoVpValue(Number(e.target.value) || 0)}
                          placeholder="Valor para permuta"
                          className="bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 text-xs text-slate-850 dark:text-slate-100 font-mono h-10"
                        />
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-400 italic">
                        Permuta desativada para este módulo.
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2.5 border-t border-slate-200 dark:border-white/10 pt-4 mt-2">
                    <Button variant="outline" size="sm" onClick={() => setIsVexoEditing(false)} className="border-slate-200 text-slate-700 hover:bg-slate-50 dark:text-slate-200">
                      Cancelar
                    </Button>
                    <Button onClick={handleSaveVexoProduct} size="sm" className="bg-gradient-to-r from-purple-700 to-indigo-600 text-white font-extrabold">
                      {moduleOrigin === "gd" ? "Salvar Módulo GD" : "Salvar Módulo Vexo"}
                    </Button>
                  </div>

                </CardContent>
              </Card>
            ) : (
              /* 2. Vexo Products List View */
              isLoading ? (
                <div className="flex h-64 items-center justify-center">
                  <span className="animate-spin h-8 w-8 border-4 border-purple-600 border-t-transparent rounded-full" />
                </div>
              ) : (() => {
                const moduleList: VexoProduct[] = moduleOrigin === "gd"
                  ? products.map((prod) => ({
                      id: prod.id,
                      nome: prod.nome,
                      descricao: prod.descricao || "",
                      valor: Number(prod.valor_padrao || 0),
                      recorrencia: prod.recorrencia,
                      ativo: prod.ativo !== false
                    }))
                  : vexoProducts;
                return moduleList.length === 0 ? (
                <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 text-center max-w-lg mx-auto py-12 relative z-10 animate-fade-in shadow-sm">
                  <CardContent className="space-y-4">
                    <Layers className="h-12 w-12 text-slate-400 mx-auto" />
                    <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">Nenhum Módulo Cadastrado</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Clique em "Novo Módulo" no topo para criar opções personalizadas de módulos Vexo.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 relative z-10 animate-fade-in">
                  {moduleList.map((prod) => (
                    <Card
                      key={prod.id}
                      className={cn(
                        "bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 p-5 flex flex-col justify-between space-y-4 hover:border-purple-500/20 transition-all shadow-sm",
                        !prod.ativo && "opacity-60 hover:border-slate-300"
                      )}
                    >
                      <div className="space-y-2">
                        <div className="flex justify-between items-start">
                          <div className="space-y-0.5">
                            <h4 className="text-sm font-black text-slate-800 dark:text-slate-100 leading-tight">{prod.nome}</h4>
                            <span className="text-[10px] text-slate-500 block leading-tight mt-1 dark:text-slate-400">{prod.descricao || "Sem descrição"}</span>
                          </div>
                          <Badge className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0">
                            {isCobrancaUnica(prod) ? "único" : "mensal"}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex justify-between items-center pt-2 border-t border-slate-100 dark:border-white/5">
                        <div className="space-y-0.5">
                          <span className="text-[9px] text-slate-500 uppercase font-mono tracking-wider block dark:text-slate-400">Valor Sugerido</span>
                          <span className="text-base font-black text-pink-600 font-mono">
                            R$ {prod.valor.toLocaleString("pt-BR")}
                            <span className="text-[10px] text-slate-500 font-normal dark:text-slate-400">/{isCobrancaUnica(prod) ? "único" : "mês"}</span>
                          </span>
                        </div>

                        <div className="flex gap-1.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleVexoActive(prod, !prod.ativo)}
                            title={prod.ativo ? "Desativar módulo" : "Ativar módulo"}
                            className="text-slate-500 hover:text-slate-700 hover:bg-slate-50 h-8 w-8 dark:text-slate-200"
                          >
                            <Switch checked={prod.ativo} className="scale-75 cursor-pointer pointer-events-none" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenVexoEdit(prod)}
                            className="text-slate-500 hover:text-slate-700 hover:bg-slate-50 h-8 w-8 dark:text-slate-200"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteVexoProduct(prod.id)}
                            className="text-red-500 hover:text-red-650 hover:bg-red-50 h-8 w-8"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              );
              })()
            )}
          </>
        )}

      </div>
    </PageShell>
  );
}
