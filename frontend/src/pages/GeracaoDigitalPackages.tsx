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
import { API_BASE_URL, fetchApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { computePackagePricing, brlPkg } from "@/lib/geracaoDigital/packagePricing";
import {
  Layers,
  Plus,
  Trash2,
  Copy,
  Edit2,
  CheckCircle,
  AlertCircle,
  Briefcase,
  DollarSign,
  Calendar,
  Layers2,
  ChevronRight,
  Info
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ProductApi {
  id: string;
  nome: string;
  descricao?: string | null;
  valor_padrao?: number | string | null;
  recorrencia: string;
  ativo?: boolean;
}

interface Package {
  id: string;
  nome: string;
  tipo?: "gd" | "vexo";
  periodo: string;
  produtos_incluidos: { product_id: string; nome: string }[];
  valor: number;
  valor_tabela?: number | null;
  destaque: boolean;
  ativo: boolean;
}

interface VexoProduct {
  id: string;
  nome: string;
  descricao: string;
  valor: number;
  recorrencia: string;
  ativo: boolean;
}

export default function GeracaoDigitalPackages() {
  const { isAuthenticated, getIdToken, clientId } = useAuth();

  // State
  const [activeSection, setActiveSection] = useState<"packages" | "vexo-packages" | "vexo-products" | "gd-products">("packages");
  // Seção de módulos parametrizada: "vexo-products" e "gd-products" reusam o mesmo form/lista
  const moduleOrigin: "gd" | "vexo" = activeSection === "gd-products" ? "gd" : "vexo";
  const [packages, setPackages] = useState<Package[]>([]);
  const [products, setProducts] = useState<ProductApi[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Package Form state
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [selectedPackage, setSelectedPackage] = useState<Package | null>(null);
  const [packageName, setPackageName] = useState<string>("");
  const [packageTipo, setPackageTipo] = useState<"gd" | "vexo">("gd");
  const [packagePeriod, setPackagePeriod] = useState<string>("mensal");
  const [packageValue, setPackageValue] = useState<number>(0);
  const [packageTabela, setPackageTabela] = useState<number>(0);
  const [packageDestaque, setPackageDestaque] = useState<boolean>(false);
  const [packageAtivo, setPackageAtivo] = useState<boolean>(true);
  const [packageIncludedProductIds, setPackageIncludedProductIds] = useState<Record<string, boolean>>({});

  // Vexo Products CRUD state
  const [vexoProducts, setVexoProducts] = useState<VexoProduct[]>([]);
  const [isVexoEditing, setIsVexoEditing] = useState<boolean>(false);
  const [selectedVexoProduct, setSelectedVexoProduct] = useState<VexoProduct | null>(null);
  const [vexoNome, setVexoNome] = useState<string>("");
  const [vexoDescricao, setVexoDescricao] = useState<string>("");
  const [vexoValor, setVexoValor] = useState<number>(0);
  const [vexoRecorrencia, setVexoRecorrencia] = useState<string>("mensal");
  const [vexoAtivo, setVexoAtivo] = useState<boolean>(true);

  // Load packages and products
  useEffect(() => {
    if (isAuthenticated) {
      loadPackages();
      loadProducts();
      loadVexoProducts();
    }
  }, [isAuthenticated, clientId]);

  async function loadPackages() {
    try {
      setIsLoading(true);
      setError(null);
      const token = await getIdToken();
      const headers: HeadersInit = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetchApi(`/api/gd/packages?client_id=${clientId || ""}`, { headers });
      if (!res.ok) {
        throw new Error(`Erro ao buscar pacotes (Status ${res.status}).`);
      }
      const data = await res.json();
      if (data.success) {
        setPackages(data.data);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Erro desconhecido ao carregar pacotes.");
      toast({
        title: "Erro ao Carregar",
        description: "Não foi possível buscar a lista de pacotes.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  }

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

  // Open packages form
  const handleOpenCreate = () => {
    setSelectedPackage(null);
    setPackageName("");
    setPackageTipo(activeSection === "vexo-packages" ? "vexo" : "gd");
    setPackagePeriod("mensal");
    setPackageValue(0);
    setPackageTabela(0);
    setPackageDestaque(false);
    setPackageAtivo(true);

    const initialMap: Record<string, boolean> = {};
    const catalog = (activeSection === "vexo-packages") ? vexoProducts : products;
    catalog.forEach((p) => {
      initialMap[p.id] = false;
    });
    setPackageIncludedProductIds(initialMap);
    setIsEditing(true);
  };

  const handleOpenEdit = (pkg: Package) => {
    setSelectedPackage(pkg);
    setPackageName(pkg.nome);
    setPackageTipo(pkg.tipo || "gd");
    setPackagePeriod(pkg.periodo);
    setPackageValue(pkg.valor);
    setPackageTabela(Number(pkg.valor_tabela || 0));
    setPackageDestaque(pkg.destaque);
    setPackageAtivo(pkg.ativo);

    const map: Record<string, boolean> = {};
    const catalog = (pkg.tipo === "vexo") ? vexoProducts : products;
    catalog.forEach((p) => {
      map[p.id] = (pkg.produtos_incluidos || []).some((pi) => pi.product_id === p.id);
    });
    setPackageIncludedProductIds(map);
    setIsEditing(true);
  };

  // Duplicate Package
  const handleDuplicate = async (pkgId: string) => {
    try {
      const token = await getIdToken();
      const headers: HeadersInit = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetchApi(`/api/gd/packages/${pkgId}/duplicate?client_id=${clientId || ""}`, {
        method: "POST",
        headers
      });

      if (!res.ok) {
        throw new Error("Erro ao duplicar pacote no servidor.");
      }

      toast({
        title: "Pacote Duplicado",
        description: "Nova cópia do pacote criada com sucesso."
      });
      loadPackages();
    } catch (err) {
      console.error(err);
      toast({
        title: "Erro ao Duplicar",
        description: "Não foi possível duplicar este pacote.",
        variant: "destructive"
      });
    }
  };

  // Toggle Active/Inactive Package
  const handleToggleActive = async (pkg: Package, newStatus: boolean) => {
    try {
      const token = await getIdToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const body = {
        client_id: clientId,
        nome: pkg.nome,
        tipo: pkg.tipo || "gd",
        periodo: pkg.periodo,
        produtos_incluidos: pkg.produtos_incluidos,
        valor: pkg.valor,
        valor_tabela: Number(pkg.valor_tabela || 0) || null,
        destaque: pkg.destaque,
        ativo: newStatus
      };

      const res = await fetchApi(`/api/gd/packages/${pkg.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        throw new Error("Erro ao atualizar status do pacote.");
      }

      toast({
        title: newStatus ? "Pacote Ativado" : "Pacote Desativado",
        description: `O pacote foi ${newStatus ? "ativado" : "desativado"} com sucesso.`
      });
      loadPackages();
    } catch (err) {
      console.error(err);
      toast({
        title: "Erro ao Atualizar",
        description: "Não foi possível atualizar o status do pacote.",
        variant: "destructive"
      });
    }
  };

  // Delete Package
  const handleDelete = async (pkgId: string) => {
    if (!window.confirm("Deseja realmente excluir este pacote?")) return;
    try {
      const token = await getIdToken();
      const headers: HeadersInit = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetchApi(`/api/gd/packages/${pkgId}?client_id=${clientId || ""}`, {
        method: "DELETE",
        headers
      });

      if (!res.ok) {
        throw new Error("Erro ao excluir pacote.");
      }

      toast({
        title: "Pacote Excluído",
        description: "O pacote foi removido da listagem de templates ativos."
      });
      loadPackages();
    } catch (err) {
      console.error(err);
      toast({
        title: "Erro ao Excluir",
        description: "Não foi possível excluir o pacote.",
        variant: "destructive"
      });
    }
  };

  // Save/Create Package template
  const handleSave = async () => {
    if (!packageName.trim()) {
      toast({
        title: "Nome Obrigatório",
        description: "Por favor, insira o nome do pacote.",
        variant: "destructive"
      });
      return;
    }

    const includedList = Object.entries(packageIncludedProductIds)
      .filter(([_, included]) => included)
      .map(([id]) => {
        const prod = packageTipo === "gd"
          ? products.find((p) => p.id === id)
          : vexoProducts.find((p) => p.id === id);
        return {
          product_id: id,
          nome: prod?.nome || ""
        };
      });

    try {
      const token = await getIdToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const body = {
        client_id: clientId,
        nome: packageName,
        tipo: packageTipo,
        periodo: packagePeriod,
        produtos_incluidos: includedList,
        valor: Number(packageValue || 0),
        valor_tabela: Number(packageTabela || 0) || null,
        destaque: packageDestaque,
        ativo: packageAtivo
      };

      let res;
      if (selectedPackage) {
        res = await fetchApi(`/api/gd/packages/${selectedPackage.id}`, {
          method: "PUT",
          headers,
          body: JSON.stringify(body)
        });
      } else {
        res = await fetchApi("/api/gd/packages", {
          method: "POST",
          headers,
          body: JSON.stringify(body)
        });
      }

      if (!res.ok) {
        throw new Error("Erro ao salvar pacote.");
      }

      toast({
        title: selectedPackage ? "Pacote Atualizado" : "Pacote Criado",
        description: "O modelo de pacote comercial foi salvo com sucesso."
      });

      setIsEditing(false);
      loadPackages();
    } catch (err) {
      console.error(err);
      toast({
        title: "Erro ao Salvar",
        description: "Não foi possível salvar o pacote comercial no servidor.",
        variant: "destructive"
      });
    }
  };

  // ================= VEXO PRODUCTS CRUD HANDLERS =================
  const handleOpenVexoCreate = () => {
    setSelectedVexoProduct(null);
    setVexoNome("");
    setVexoDescricao("");
    setVexoValor(0);
    setVexoRecorrencia("mensal");
    setVexoAtivo(true);
    setIsVexoEditing(true);
  };

  const handleOpenVexoEdit = (prod: VexoProduct) => {
    setSelectedVexoProduct(prod);
    setVexoNome(prod.nome);
    setVexoDescricao(prod.descricao || "");
    setVexoValor(prod.valor);
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
            recorrencia: vexoRecorrencia,
            ativo: vexoAtivo
          }
        : {
            client_id: clientId,
            nome: vexoNome,
            descricao: vexoDescricao,
            valor: Number(vexoValor || 0),
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

      <div className="w-full min-h-screen bg-white text-slate-800 rounded-3xl p-6 border border-slate-200 shadow-sm relative overflow-hidden">

        {/* Glow Effects */}
        <div className="absolute top-0 right-0 h-96 w-96 bg-purple-50 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 h-96 w-96 bg-pink-50 rounded-full blur-[100px] pointer-events-none" />

        {/* Toggle between Pacotes and Módulos Vexo */}
        <div className="flex justify-center mb-8 relative z-10">
          <div className="bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-white/10 flex gap-1">
            <button
              onClick={() => {
                setActiveSection("packages");
                setIsEditing(false);
              }}
              className={cn(
                "px-5 py-2 rounded-lg text-xs font-bold transition-all",
                activeSection === "packages"
                  ? "bg-white dark:bg-slate-800 text-purple-650 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              Pacotes Geração Digital
            </button>
            <button
              onClick={() => {
                setActiveSection("gd-products");
                setIsVexoEditing(false);
              }}
              className={cn(
                "px-5 py-2 rounded-lg text-xs font-bold transition-all",
                activeSection === "gd-products"
                  ? "bg-white dark:bg-slate-800 text-purple-650 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              Módulos Geração Digital
            </button>
            <button
              onClick={() => {
                setActiveSection("vexo-packages");
                setIsEditing(false);
              }}
              className={cn(
                "px-5 py-2 rounded-lg text-xs font-bold transition-all",
                activeSection === "vexo-packages"
                  ? "bg-white dark:bg-slate-800 text-purple-650 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              Pacotes Vexo OS
            </button>
            <button
              onClick={() => {
                setActiveSection("vexo-products");
                setIsVexoEditing(false);
              }}
              className={cn(
                "px-5 py-2 rounded-lg text-xs font-bold transition-all",
                activeSection === "vexo-products"
                  ? "bg-white dark:bg-slate-800 text-purple-650 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              Módulos Vexo OS
            </button>
          </div>
        </div>

        {/* SECTION 1: PACKAGES CRUD */}
        {(activeSection === "packages" || activeSection === "vexo-packages") && (
          <>
            {/* Top Header Controls */}
            <div className="flex justify-between items-center mb-8 relative z-10 border-b border-slate-200 pb-4">
              <div className="space-y-0.5">
                <h2 className="text-base font-bold text-slate-800">
                  {activeSection === "vexo-packages" ? "Templates de Pacotes Vexo OS" : "Templates de Pacotes Geração Digital"}
                </h2>
                <p className="text-xs text-slate-500">
                  {activeSection === "vexo-packages"
                    ? "Estes pacotes estarão disponíveis para simulação Vexo OS em propostas comerciais futuras."
                    : "Estes pacotes estarão disponíveis para simulação em qualquer apresentação comercial futura."}
                </p>
              </div>
              {!isEditing && (
                <Button onClick={handleOpenCreate} size="sm" className="bg-gradient-to-r from-purple-600 to-pink-500 font-extrabold text-white text-xs">
                  <Plus className="h-4 w-4 mr-1.5" />
                  Novo Pacote
                </Button>
              )}
            </div>

            {/* 1. Package Form Editor (Create/Edit Mode) */}
            {isEditing ? (
              <Card className="bg-white border-slate-200 max-w-2xl mx-auto relative z-10 animate-fade-in shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
                    <Layers className="h-4.5 w-4.5 text-purple-650" />
                    {selectedPackage ? "Editar Pacote Comercial" : "Novo Pacote Comercial"}
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500">Preencha os campos para salvar este modelo de pacote comercial.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-550 font-medium">Nome do Pacote</Label>
                      <Input
                        value={packageName}
                        onChange={(e) => setPackageName(e.target.value)}
                        placeholder="Ex: Pacote Tração Premium"
                        className="bg-white border-slate-200 text-xs text-slate-800"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-550 font-medium">Tipo de Pacote</Label>
                      <select
                        value={packageTipo}
                        onChange={(e) => {
                          const newTipo = e.target.value as "gd" | "vexo";
                          setPackageTipo(newTipo);
                          setPackageIncludedProductIds({});
                        }}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none h-10"
                      >
                        <option value="gd">Geração Digital</option>
                        <option value="vexo">Vexo OS</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-550 font-medium">Período de Recorrência</Label>
                      <select
                        value={packagePeriod}
                        onChange={(e) => setPackagePeriod(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none h-10"
                      >
                        <option value="mensal">Mensal</option>
                        <option value="trimestral">Trimestral</option>
                        <option value="semestral">Semestral</option>
                        <option value="anual">Anual</option>
                        <option value="unico">Setup Único</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 items-start">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-550 font-medium">
                        {packagePeriod === "unico" ? "Valor Único (R$)" : "Valor Total do Período (R$)"}
                      </Label>
                      <Input
                        type="number"
                        value={packageValue}
                        onChange={(e) => setPackageValue(Number(e.target.value) || 0)}
                        placeholder={packagePeriod === "unico" ? "Ex: 2900" : "Ex: 48000"}
                        className="bg-white border-slate-200 text-xs text-slate-800 font-mono"
                      />
                      {(() => {
                        const pr = computePackagePricing(packageValue, packagePeriod, packageTabela);
                        if (pr.meses === null) {
                          return (
                            <span className="text-[10px] text-slate-500 block">
                              Valor único (setup) — sem recorrência.
                            </span>
                          );
                        }
                        return (
                          <span className="text-[10px] text-purple-650 font-medium block">
                            Total do período ({pr.meses} {pr.meses === 1 ? "mês" : "meses"}): {brlPkg(pr.totalPeriodo)} · Equivale a {pr.aprox ? "aprox. " : ""}{brlPkg(pr.mensalidade || 0)}/mês
                            {pr.descontoPct !== null && (
                              <> · <span className="line-through text-slate-400">{brlPkg(pr.valorTabela || 0)}</span> ({pr.descontoPct}% off)</>
                            )}
                          </span>
                        );
                      })()}
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-550 font-medium">Valor de Tabela (R$, opcional)</Label>
                      <Input
                        type="number"
                        value={packageTabela || ""}
                        onChange={(e) => setPackageTabela(Number(e.target.value) || 0)}
                        placeholder="Preço cheio, sem desconto — para exibir riscado"
                        className="bg-white border-slate-200 text-xs text-slate-800 font-mono"
                      />
                      <span className="text-[9px] text-slate-450 block">
                        Se maior que o valor do período, o desconto aparece riscado na apresentação, mesa e proposta.
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 items-center">

                    <div className="grid gap-2 grid-cols-2 mt-4">
                      <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200 shadow-sm">
                        <div className="space-y-0.5">
                          <Label className="text-[11px] text-slate-700 font-bold">Destaque</Label>
                          <span className="text-[8px] text-slate-500 block">Exibir em destaque</span>
                        </div>
                        <Switch checked={packageDestaque} onCheckedChange={setPackageDestaque} />
                      </div>

                      <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200 shadow-sm">
                        <div className="space-y-0.5">
                          <Label className="text-[11px] text-slate-700 font-bold">Ativo</Label>
                          <span className="text-[8px] text-slate-500 block">Disponível para venda</span>
                        </div>
                        <Switch checked={packageAtivo} onCheckedChange={setPackageAtivo} />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-slate-550 font-medium">
                      {packageTipo === "gd" ? "Produtos/Serviços de Solução Incluídos (Sem Valor)" : "Módulos Vexo OS Incluídos (Sem Valor)"}
                    </Label>
                    <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 max-h-[220px] overflow-y-auto pr-1">
                      {((packageTipo === "vexo" ? vexoProducts : products) || []).map((p) => {
                        const isIncluded = packageIncludedProductIds[p.id] || false;
                        return (
                          <div
                            key={p.id}
                            onClick={() =>
                              setPackageIncludedProductIds((prev) => ({
                               ...prev,
                                [p.id]: !isIncluded
                              }))
                            }
                            className={cn(
                              "p-2.5 rounded-lg border transition-all flex items-center justify-between cursor-pointer text-left shadow-sm",
                              isIncluded
                                ? "bg-purple-50 border-purple-300"
                                : "bg-white border-slate-200 hover:border-slate-350"
                            )}
                          >
                            <span className="text-xs font-semibold text-slate-800 leading-tight">{p.nome}</span>
                            {isIncluded && (
                              <div className="h-3.5 w-3.5 rounded-full bg-purple-600 flex items-center justify-center shrink-0">
                                <CheckCircle className="h-2.5 w-2.5 text-white" />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2.5 border-t border-slate-200 pt-4 mt-2">
                    <Button variant="outline" size="sm" onClick={() => setIsEditing(false)} className="border-slate-200 text-slate-700 hover:bg-slate-50">
                      Cancelar
                    </Button>
                    <Button onClick={handleSave} size="sm" className="bg-gradient-to-r from-purple-600 to-pink-500 text-white font-extrabold">
                      Salvar Modelo de Pacote
                    </Button>
                  </div>

                </CardContent>
              </Card>
            ) : (
              /* 2. Packages list view */
              isLoading ? (
                <div className="flex h-64 items-center justify-center">
                  <span className="animate-spin h-8 w-8 border-4 border-purple-600 border-t-transparent rounded-full" />
                </div>
              ) : error ? (
                <Card className="bg-red-50 border-red-200 text-center max-w-lg mx-auto py-12 relative z-10 shadow-sm">
                  <CardContent className="space-y-4">
                    <Info className="h-12 w-12 text-red-500 mx-auto" />
                    <h3 className="text-lg font-bold text-slate-850">Falha na Conexão</h3>
                    <p className="text-xs text-slate-650">
                      {error}
                    </p>
                    <Button onClick={loadPackages} className="bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs px-6 py-2 rounded-xl">
                      Tentar Novamente
                    </Button>
                  </CardContent>
                </Card>
              ) : (() => {
                const displayedPackages = activeSection === "vexo-packages"
                  ? packages.filter(p => p.tipo === "vexo")
                  : packages.filter(p => p.tipo === "gd" || !p.tipo);

                const titleText = activeSection === "vexo-packages"
                  ? "Pacotes Vexo OS"
                  : "Pacotes Geração Digital (GD)";

                const renderPackageGrid = (pkgList: Package[]) => (
                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 relative z-10 animate-fade-in">
                    {pkgList.map((pkg) => (
                      <Card
                        key={pkg.id}
                        className={cn(
                          "bg-white border-slate-200 p-5 flex flex-col justify-between space-y-4 hover:border-purple-500/20 transition-all shadow-sm",
                          !pkg.ativo && "opacity-60 hover:border-slate-300"
                        )}
                      >
                        <div className="space-y-2">
                          <div className="flex justify-between items-start">
                            <div className="space-y-0.5">
                              <h4 className="text-sm font-black text-slate-800 leading-tight">{pkg.nome}</h4>
                              {!pkg.ativo && (
                                <Badge className="bg-red-50 border border-red-200 text-red-650 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0">
                                  Inativo
                                </Badge>
                              )}
                            </div>
                            {pkg.destaque && (
                              <Badge className="bg-pink-600 text-white border-none font-bold uppercase tracking-wider text-[8px] px-1.5 py-0.5">
                                Destaque
                              </Badge>
                            )}
                          </div>

                          <div className="space-y-1 pt-1">
                            <span className="text-[10px] text-slate-500 block font-mono">
                              {pkg.tipo === "vexo" ? "Módulos Vexo" : "Produtos"} Incluídos ({pkg.produtos_incluidos?.length || 0}):
                            </span>
                            <div className="flex flex-wrap gap-1 max-h-[80px] overflow-y-auto pr-1">
                              {pkg.produtos_incluidos?.map((p, idx) => (
                                <Badge key={idx} variant="outline" className="bg-slate-50 border-slate-200 text-slate-600 text-[9px] font-normal font-sans py-0">
                                  {p.nome}
                                </Badge>
                              ))}
                              {(!pkg.produtos_incluidos || pkg.produtos_incluidos.length === 0) && (
                                <span className="text-[10px] text-slate-400 italic">Nenhum produto incluído</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                          <div className="space-y-0.5">
                            <span className="text-[9px] text-slate-500 uppercase font-mono tracking-wider block">Valor</span>
                            {(() => {
                              const pr = computePackagePricing(pkg.valor, pkg.periodo, pkg.valor_tabela);
                              if (pr.meses === null) {
                                  return (
                                  <span className="text-base font-black text-pink-600 font-mono">
                                    {brlPkg(pr.totalPeriodo)}
                                    <span className="text-[10px] text-slate-500 font-normal">/setup único</span>
                                  </span>
                                );
                              }
                              return (
                                <>
                                  <span className="text-base font-black text-pink-600 font-mono block">
                                    {pr.valorTabela !== null && (
                                      <span className="text-[11px] text-slate-400 line-through font-bold mr-1.5">De {brlPkg(pr.valorTabela)}</span>
                                    )}
                                    {pr.valorTabela !== null ? "por " : ""}{brlPkg(pr.totalPeriodo)}
                                    {pr.descontoPct !== null && (
                                      <span className="text-[10px] text-emerald-600 font-bold ml-1">({pr.descontoPct}% off)</span>
                                    )}
                                  </span>
                                  <span className="text-[10px] text-slate-500 font-mono block">
                                    {pr.meses > 1 ? `total do período · ${pr.aprox ? "aprox. " : ""}${brlPkg(pr.mensalidade || 0)}/mês` : `${brlPkg(pr.mensalidade || 0)}/mês`}
                                  </span>
                                </>
                              );
                            })()}
                          </div>

                          <div className="flex gap-1.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleToggleActive(pkg, !pkg.ativo)}
                              title={pkg.ativo ? "Desativar pacote" : "Ativar pacote"}
                              className="text-slate-500 hover:text-slate-700 hover:bg-slate-50 h-8 w-8"
                            >
                              <Switch checked={pkg.ativo} className="scale-75 cursor-pointer pointer-events-none" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleOpenEdit(pkg)}
                              className="text-slate-500 hover:text-slate-700 hover:bg-slate-50 h-8 w-8"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDuplicate(pkg.id)}
                              title="Duplicar pacote"
                              className="text-slate-500 hover:text-slate-700 hover:bg-slate-50 h-8 w-8"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(pkg.id)}
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

                if (displayedPackages.length === 0) {
                  return (
                    <Card className="bg-white border-slate-200 p-8 text-center max-w-md mx-auto shadow-sm">
                      <CardContent className="space-y-4">
                        <Layers className="h-12 w-12 text-slate-400 mx-auto" />
                        <h3 className="text-base font-bold text-slate-800">Nenhum Pacote Cadastrado</h3>
                        <p className="text-xs text-slate-500">
                          Clique em "Novo Pacote" no topo para criar seus templates comerciais fechados.
                        </p>
                      </CardContent>
                    </Card>
                  );
                }

                return (
                  <div className="space-y-8">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{titleText}</span>
                        <Badge className="bg-slate-100 text-slate-600 text-[10px] font-bold border-none">{displayedPackages.length}</Badge>
                      </div>
                      {renderPackageGrid(displayedPackages)}
                    </div>
                  </div>
                );
              })()
            )}
          </>
        )}

        {/* SECTION 2: VEXO PRODUCTS CRUD */}
        {(activeSection === "vexo-products" || activeSection === "gd-products") && (
          <>
            {/* Top Header Controls */}
            <div className="flex justify-between items-center mb-8 relative z-10 border-b border-slate-200 pb-4">
              <div className="space-y-0.5">
                <h2 className="text-base font-bold text-slate-800">
                  {moduleOrigin === "gd" ? "Catálogo de Módulos Geração Digital (avulsos)" : "Catálogo de Módulos Vexo OS"}
                </h2>
                <p className="text-xs text-slate-500">
                  {moduleOrigin === "gd"
                    ? "Serviços GD vendidos avulsos, fora de pacote — nome, descrição, valor mensal e recorrência."
                    : "Configure as opções de módulos e funcionalidades Vexo com valores e recorrências editáveis."}
                </p>
              </div>
              {!isVexoEditing && (
                <Button onClick={handleOpenVexoCreate} size="sm" className="bg-gradient-to-r from-purple-600 to-pink-500 font-extrabold text-white text-xs">
                  <Plus className="h-4 w-4 mr-1.5" />
                  Novo Módulo
                </Button>
              )}
            </div>

            {/* 1. Vexo Product Form Editor */}
            {isVexoEditing ? (
              <Card className="bg-white border-slate-200 max-w-2xl mx-auto relative z-10 animate-fade-in shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
                    <Layers className="h-4.5 w-4.5 text-purple-650" />
                    {selectedVexoProduct ? (moduleOrigin === "gd" ? "Editar Módulo GD" : "Editar Módulo Vexo OS") : (moduleOrigin === "gd" ? "Novo Módulo GD" : "Novo Módulo Vexo OS")}
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500">Preencha os campos para salvar as configurações do módulo Vexo.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-550 font-medium">Nome do Módulo</Label>
                      <Input
                        value={vexoNome}
                        onChange={(e) => setVexoNome(e.target.value)}
                        placeholder="Ex: Agente de IA / SDR"
                        className="bg-white border-slate-200 text-xs text-slate-800"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-550 font-medium">Recorrência comercial</Label>
                      <select
                        value={vexoRecorrencia}
                        onChange={(e) => setVexoRecorrencia(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none h-10"
                      >
                        <option value="mensal">Mensal</option>
                        <option value="unico">Pagamento Único</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-550 font-medium">Descrição detalhada</Label>
                    <Input
                      value={vexoDescricao}
                      onChange={(e) => setVexoDescricao(e.target.value)}
                      placeholder="Ex: Agente inteligente para prospecção ativa via WhatsApp."
                      className="bg-white border-slate-200 text-xs text-slate-800"
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 items-center">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-550 font-medium">Valor de Venda (R$)</Label>
                      <Input
                        type="number"
                        value={vexoValor}
                        onChange={(e) => setVexoValor(Number(e.target.value) || 0)}
                        placeholder="Ex: 980"
                        className="bg-white border-slate-200 text-xs text-slate-800 font-mono"
                      />
                    </div>

                    <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200 shadow-sm mt-4">
                      <div className="space-y-0.5">
                        <Label className="text-[11px] text-slate-700 font-bold">Módulo Ativo</Label>
                        <span className="text-[8px] text-slate-500 block">Exibir nas opções de fechamento</span>
                      </div>
                      <Switch checked={vexoAtivo} onCheckedChange={setVexoAtivo} />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2.5 border-t border-slate-200 pt-4 mt-2">
                    <Button variant="outline" size="sm" onClick={() => setIsVexoEditing(false)} className="border-slate-200 text-slate-700 hover:bg-slate-50">
                      Cancelar
                    </Button>
                    <Button onClick={handleSaveVexoProduct} size="sm" className="bg-gradient-to-r from-purple-600 to-pink-500 text-white font-extrabold">
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
                <Card className="bg-white border-slate-200 text-center max-w-lg mx-auto py-12 relative z-10 animate-fade-in shadow-sm">
                  <CardContent className="space-y-4">
                    <Layers className="h-12 w-12 text-slate-400 mx-auto" />
                    <h3 className="text-base font-bold text-slate-800">Nenhum Módulo Cadastrado</h3>
                    <p className="text-xs text-slate-500">
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
                        "bg-white border-slate-200 p-5 flex flex-col justify-between space-y-4 hover:border-purple-500/20 transition-all shadow-sm",
                        !prod.ativo && "opacity-60 hover:border-slate-300"
                      )}
                    >
                      <div className="space-y-2">
                        <div className="flex justify-between items-start">
                          <div className="space-y-0.5">
                            <h4 className="text-sm font-black text-slate-800 leading-tight">{prod.nome}</h4>
                            <span className="text-[10px] text-slate-500 block leading-tight mt-1">{prod.descricao || "Sem descrição"}</span>
                          </div>
                          <Badge className="bg-slate-50 border border-slate-200 text-slate-600 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0">
                            {prod.recorrencia === "unico" ? "único" : "mensal"}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                        <div className="space-y-0.5">
                          <span className="text-[9px] text-slate-500 uppercase font-mono tracking-wider block">Valor Sugerido</span>
                          <span className="text-base font-black text-pink-600 font-mono">
                            R$ {prod.valor.toLocaleString("pt-BR")}
                            <span className="text-[10px] text-slate-500 font-normal">/{prod.recorrencia === "unico" ? "único" : "mês"}</span>
                          </span>
                        </div>

                        <div className="flex gap-1.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleToggleVexoActive(prod, !prod.ativo)}
                            title={prod.ativo ? "Desativar módulo" : "Ativar módulo"}
                            className="text-slate-500 hover:text-slate-700 hover:bg-slate-50 h-8 w-8"
                          >
                            <Switch checked={prod.ativo} className="scale-75 cursor-pointer pointer-events-none" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenVexoEdit(prod)}
                            className="text-slate-500 hover:text-slate-700 hover:bg-slate-50 h-8 w-8"
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
