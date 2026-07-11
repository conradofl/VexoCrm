import { useState, useEffect, useMemo, ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
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
import { API_BASE_URL, fetchApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  Building2,
  Upload,
  Trash2,
  ArrowRight,
  Calculator,
  Play,
  CheckCircle,
  FileText,
  Info,
  DollarSign,
  Briefcase
} from "lucide-react";

// Import slides & simulator utilities from VexoPitch
import GeracaoDigitalCommercialPitch from "./GeracaoDigitalCommercialPitch";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SEGMENTS, type SegmentScenario } from "@/pages/demoSegments";
import { computeRoi } from "@/lib/vexoPitch/helpers";

const DEFAULT_SEGMENTS = [
  { id: "1", nome: "Energia solar", faturamento_min: 50000 },
  { id: "2", nome: "Consórcios", faturamento_min: 30000 },
  { id: "3", nome: "Imobiliário e incorporadoras", faturamento_min: 80000 },
  { id: "4", nome: "Clínicas de estética e odontologia", faturamento_min: 40000 },
  { id: "5", nome: "E-commerce e varejo escalável", faturamento_min: 60000 },
  { id: "6", nome: "Automotivo (concessionárias e seminovos)", faturamento_min: 100000 },
  { id: "7", nome: "Advocacia e contabilidade", faturamento_min: 20000 },
  { id: "8", nome: "Educação (cursos e escolas)", faturamento_min: 35000 },
  { id: "9", nome: "Saúde (clínicas e laboratórios)", faturamento_min: 50000 },
  { id: "10", nome: "Franquias e redes multiunidade", faturamento_min: 150000 },
  { id: "11", nome: "Turismo e hospitalidade", faturamento_min: 45000 },
  { id: "12", nome: "Food service premium e delivery", faturamento_min: 30000 }
];

const SEGMENT_MAPPING: Record<string, string> = {
  "Energia solar": "b2b",
  "Consórcios": "b2b",
  "Imobiliário e incorporadoras": "b2b",
  "Clínicas de estética e odontologia": "academia",
  "E-commerce e varejo escalável": "restaurante",
  "Automotivo (concessionárias e seminovos)": "b2b",
  "Advocacia e contabilidade": "b2b",
  "Educação (cursos e escolas)": "b2b",
  "Saúde (clínicas e laboratórios)": "b2b",
  "Franquias e redes multiunidade": "b2b",
  "Turismo e hospitalidade": "turismo",
  "Food service premium e delivery": "restaurante",
};

interface SegmentApi {
  id: string;
  nome: string;
  faturamento_min: number;
}

interface PackageApi {
  id: string;
  nome: string;
  periodo: string;
  produtos_incluidos: { product_id: string; nome: string }[];
  valor: number;
  destaque: boolean;
}

export default function GeracaoDigitalCommercialSetup() {
  const { isAuthenticated, getIdToken, clientId } = useAuth();
  const navigate = useNavigate();

  // State
  const [activeFlow, setActiveFlow] = useState<"A" | "B">("A");
  const [segments, setSegments] = useState<SegmentApi[]>(DEFAULT_SEGMENTS);
  const [packages, setPackages] = useState<PackageApi[]>([]);

  const [selectedSegmentId, setSelectedSegmentId] = useState<string>("3"); // Default to Imobiliário
  const [prospectName, setProspectName] = useState<string>("");
  const [prospectLogo, setProspectLogo] = useState<string | null>(null);

  const [selectedPackages, setSelectedPackages] = useState<Record<string, boolean>>({});
  const [packageOverrides, setPackageOverrides] = useState<Record<string, number>>({});

  const [vendaCasada, setVendaCasada] = useState<boolean>(false);
  const [availableVexoProducts, setAvailableVexoProducts] = useState<any[]>([]);
  const [selectedVexoProducts, setSelectedVexoProducts] = useState<any[]>([]);

  // ROI metrics
  const [leadsCount, setLeadsCount] = useState<number>(500);
  const [customTicket, setCustomTicket] = useState<number>(1500);
  const [customConv, setCustomConv] = useState<number>(2.5);

  // Presentation Deck States
  const [isPresenting, setIsPresenting] = useState<boolean>(false);
  const [presentationId, setPresentationId] = useState<string | undefined>(undefined);

  const handleToggleVexoProduct = (prod: any) => {
    setSelectedVexoProducts((prev) => {
      const exists = prev.some((p) => p.id === prod.id);
      if (exists) {
        return prev.filter((p) => p.id !== prod.id);
      } else {
        return [...prev, { ...prod }];
      }
    });
  };

  const handleUpdateVexoProductPrice = (id: string, newPrice: number) => {
    setSelectedVexoProducts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, valor: newPrice } : p))
    );
  };

  const vexoSubtotal = useMemo(() => {
    return selectedVexoProducts.reduce((sum, p) => sum + Number(p.valor || 0), 0);
  }, [selectedVexoProducts]);

  // Load Segments and Packages from Backend
  useEffect(() => {
    async function loadData() {
      try {
        const token = await getIdToken();
        const headers: HeadersInit = {};
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const [segmentsRes, packagesRes, vexoProductsRes] = await Promise.all([
          fetchApi(`/api/gd/segments?client_id=${clientId || ""}`, { headers }),
          fetchApi(`/api/gd/packages?client_id=${clientId || ""}`, { headers }),
          fetchApi(`/api/gd/vexo-products?client_id=${clientId || ""}`, { headers })
        ]);

        if (segmentsRes.ok) {
          const segmentsData = await segmentsRes.json();
          if (segmentsData.success && segmentsData.data?.length > 0) {
            setSegments(segmentsData.data);
            setSelectedSegmentId(segmentsData.data[0].id);
          }
        }
        if (packagesRes.ok) {
          const packagesData = await packagesRes.json();
          if (packagesData.success) {
            setPackages(packagesData.data);
            const initialPackMap: Record<string, boolean> = {};
            const initialOverrides: Record<string, number> = {};
            packagesData.data.forEach((pk: PackageApi) => {
              initialPackMap[pk.id] = pk.destaque || false;
              initialOverrides[pk.id] = pk.valor;
            });
            setSelectedPackages(initialPackMap);
            setPackageOverrides(initialOverrides);
          }
        }
        if (vexoProductsRes.ok) {
          const vexoData = await vexoProductsRes.json();
          if (vexoData.success) {
            // Only active ones
            const activeVexo = vexoData.data.filter((p: any) => p.ativo);
            setAvailableVexoProducts(activeVexo);
          }
        }
      } catch (err) {
        console.warn("Falha ao se conectar à API. Usando dados locais de semente.", err);
      }
    }
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated, clientId]);

  // Get active segment details
  const activeSegmentObj = useMemo(() => {
    return segments.find((s) => s.id === selectedSegmentId) || segments[0];
  }, [segments, selectedSegmentId]);

  // Map chosen segment name to Vexo's simulator segment
  const mappedVexoSegment: SegmentScenario = useMemo(() => {
    const gdSegmentName = activeSegmentObj?.nome || "Imobiliário e incorporadoras";
    const mappedKey = SEGMENT_MAPPING[gdSegmentName] || "b2b";
    return SEGMENTS[mappedKey] || SEGMENTS.b2b;
  }, [activeSegmentObj]);

  // Compute ROI
  const { operatorHoursSaved, extraSales, additionalRevenue } = useMemo(() => {
    return computeRoi(leadsCount, customTicket, customConv);
  }, [leadsCount, customTicket, customConv]);

  // Upload Logo handler
  const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setProspectLogo(reader.result as string);
      toast({
        title: "Logo importada",
        description: "Logotipo do prospect convertido para base64 com sucesso."
      });
    };
    reader.readAsDataURL(file);
  };

  // Confirm Fluxo B -> routes to existing /crm/geracao-digital
  const handleConfirmFluxoB = () => {
    toast({
      title: "Redirecionando",
      description: "Abrindo o briefing existente, sem alterações..."
    });
    // Direct navigate
    window.location.href = "/crm/geracao-digital";
  };

  // Start Presentation (Fluxo A) -> saves to DB and opens overlay
  const handleStartPresentation = async () => {
    if (!prospectName.trim()) {
      toast({
        title: "Nome Obrigatório",
        description: "Por favor, insira o nome da empresa do prospect.",
        variant: "destructive"
      });
      return;
    }

    // Build offered packages payload
    const pacotesOfertadosPayload = Object.entries(selectedPackages)
      .filter(([_, selected]) => selected)
      .map(([id]) => {
        const pk = packages.find((p) => p.id === id);
        const val = packageOverrides[id] ?? pk?.valor ?? 0;
        return {
          package_id: id,
          nome: pk?.nome || "",
          valor: val
        };
      });

    // Consolidate selected products as the union of products included in the offered packages
    const selectedProductsPayload: { product_id: string; nome: string }[] = [];
    const seenProductIds = new Set<string>();

    Object.entries(selectedPackages)
      .filter(([_, selected]) => selected)
      .forEach(([id]) => {
        const pk = packages.find((p) => p.id === id);
        if (pk && Array.isArray(pk.produtos_incluidos)) {
          pk.produtos_incluidos.forEach((prod) => {
            if (prod.product_id && !seenProductIds.has(prod.product_id)) {
              seenProductIds.add(prod.product_id);
              selectedProductsPayload.push({
                product_id: prod.product_id,
                nome: prod.nome
              });
            }
          });
        }
      });

    try {
      const token = await getIdToken();
      const headers: HeadersInit = {
        "Content-Type": "application/json"
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const body = {
        client_id: clientId || "00000000-0000-0000-0000-000000000000",
        prospect_name: prospectName,
        prospect_logo: prospectLogo,
        segment_id: selectedSegmentId,
        venda_casada: vendaCasada,
        produtos_selecionados: selectedProductsPayload,
        pacotes_ofertados: pacotesOfertadosPayload,
        roi: {
          leadsCount,
          customTicket,
          customConv,
          extraSales,
          additionalRevenue
        },
        status: "ativo",
        vexo_selecionados: selectedVexoProducts.map((p) => ({
          vexo_product_id: p.id,
          nome: p.nome,
          valor: Number(p.valor || 0),
          recorrencia: p.recorrencia
        }))
      };

      const res = await fetchApi("/api/gd/presentations", {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        throw new Error("Erro ao gravar apresentação comercial no servidor.");
      }

      const resData = await res.json();
      if (resData.success && resData.data?.id) {
        setPresentationId(resData.data.id);
      }

      toast({
        title: "Apresentação Gravada",
        description: "Os dados da simulação comercial foram salvos no histórico."
      });

      setIsPresenting(true);

    } catch (err) {
      console.error(err);
      toast({
        title: "Erro ao Salvar",
        description: "Não foi possível persistir a apresentação, mas você pode continuar a simulação.",
        variant: "destructive"
      });
      setIsPresenting(true);
    }
  };

  const selectedPackagesList = useMemo(() => {
    return Object.entries(selectedPackages)
      .filter(([_, selected]) => selected)
      .map(([id]) => {
        const pk = packages.find((p) => p.id === id);
        const val = packageOverrides[id] ?? pk?.valor ?? 0;
        return {
          package_id: id,
          nome: pk?.nome || "",
          valor: val,
          produtos_incluidos: pk?.produtos_incluidos || [],
          destaque: pk?.destaque || false
        };
      });
  }, [selectedPackages, packages, packageOverrides]);

  // Consolidate selected products list for pitch overlay
  const consolidatedProductsList = useMemo(() => {
    const list: { product_id: string; nome: string }[] = [];
    const seen = new Set<string>();

    Object.entries(selectedPackages)
      .filter(([_, selected]) => selected)
      .forEach(([id]) => {
        const pk = packages.find((p) => p.id === id);
        if (pk && Array.isArray(pk.produtos_incluidos)) {
          pk.produtos_incluidos.forEach((prod) => {
            if (prod.product_id && !seen.has(prod.product_id)) {
              seen.add(prod.product_id);
              list.push({
                product_id: prod.product_id,
                nome: prod.nome
              });
            }
          });
        }
      });
    return list;
  }, [selectedPackages, packages]);

  return (
    <PageShell
      title="Apresentação Geração Digital"
      subtitle="Configurador comercial do módulo Geração Digital (GD) com simulação ao vivo de Roi e Pacotes."
      icon={Sparkles}
    >
      <GeracaoDigitalTabs />
      <div className="w-full bg-white text-slate-800 rounded-3xl p-6 border border-slate-200 shadow-sm relative overflow-hidden">

        {/* Decorative background blur */}
        <div className="absolute top-0 right-0 h-96 w-96 bg-purple-50 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 h-96 w-96 bg-pink-50 rounded-full blur-[100px] pointer-events-none" />

        {/* 1. Selector of Flow (A vs B) */}
        <div className="flex justify-center mb-8 relative z-10">
          <div className="bg-slate-100 p-1.5 rounded-2xl border border-slate-200 flex gap-2">
            <button
              onClick={() => setActiveFlow("A")}
              className={cn(
                "px-6 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-widest transition-all",
                activeFlow === "A"
                  ? "bg-gradient-to-r from-purple-600 to-pink-500 text-white shadow-md shadow-purple-600/20"
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              Fluxo A · Comercial
            </button>
            <button
              onClick={() => setActiveFlow("B")}
              className={cn(
                "px-6 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-widest transition-all",
                activeFlow === "B"
                  ? "bg-gradient-to-r from-purple-600 to-pink-500 text-white shadow-md shadow-purple-600/20"
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              Fluxo B · Briefing
            </button>
          </div>
        </div>

        {/* 2. Flow B View */}
        {activeFlow === "B" ? (
          <Card className="bg-white border-slate-200 max-w-lg mx-auto py-8 text-center relative z-10 shadow-sm">
            <CardContent className="space-y-6">
              <Briefcase className="h-12 w-12 text-slate-500 mx-auto" />
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-slate-800">Fluxo de Briefing GD</h3>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  Este botão abrirá diretamente a tela operacional de coleta de briefings existentes, sem alterações.
                </p>
              </div>
              <Button
                onClick={handleConfirmFluxoB}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-8 py-3 rounded-xl"
              >
                Abrir Briefing
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        ) : (
          /* 3. Flow A View (Commercial Config) */
          <div className="space-y-6 relative z-10">

            <div className="grid gap-6 md:grid-cols-2">

              {/* Left Column: Prospect and Segment settings */}
              <div className="space-y-6">
                <Card className="bg-white border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-800">
                      <Building2 className="h-4 w-4 text-purple-600" />
                      Dados do Prospect
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500">Identificação e segmento para o pitch comercial.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">

                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-500 font-medium">Nome da Empresa Prospect</Label>
                      <Input
                        value={prospectName}
                        onChange={(e) => setProspectName(e.target.value)}
                        placeholder="Ex: Hostery Tech"
                        className="bg-white border-slate-200 focus:border-indigo-500/50 text-slate-800 text-xs h-10"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-500 font-medium">Segmento de Atuação</Label>
                      <select
                        value={selectedSegmentId}
                        onChange={(e) => setSelectedSegmentId(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500/50 h-10"
                      >
                        {segments.map((seg) => (
                          <option key={seg.id} value={seg.id}>
                            {seg.nome} (Fat. Min: R$ {Number(seg.faturamento_min).toLocaleString()})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs text-slate-500 font-medium block">Logotipo do Prospect</Label>
                      <div className="flex items-center gap-4">
                        {prospectLogo ? (
                          <div className="relative h-16 w-16 rounded-xl bg-white p-1 flex items-center justify-center border border-slate-200">
                            <img src={prospectLogo} alt="Logo" className="h-full w-full object-contain" />
                            <button
                              onClick={() => setProspectLogo(null)}
                              className="absolute -top-1.5 -right-1.5 bg-red-600 rounded-full p-1 text-white hover:bg-red-500"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <Label className="h-16 w-16 rounded-xl border border-dashed border-slate-200 hover:border-slate-300 cursor-pointer flex flex-col items-center justify-center text-slate-400 hover:text-slate-600 bg-slate-50">
                            <Upload className="h-4 w-4 mb-1" />
                            <span className="text-[9px] uppercase font-mono">logo</span>
                            <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                          </Label>
                        )}
                        <span className="text-[10px] text-slate-500 leading-snug">Selecione uma imagem PNG ou JPG para personalizar a capa e os slides do pitch comercial.</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Venda Casada Block */}
                <Card className="bg-white border-slate-200 shadow-sm">
                  <CardContent className="py-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <Label className="text-sm font-bold text-slate-800">Venda Casada · Módulo Vexo OS</Label>
                        <p className="text-xs text-slate-500">Inclui módulos adicionais do Vexo OS no pacote comercial do cliente.</p>
                      </div>
                      <Switch checked={vendaCasada} onCheckedChange={setVendaCasada} />
                    </div>

                    {vendaCasada && (
                      <div className="border-t border-slate-100 pt-4 space-y-3 animate-fade-in">
                        <div className="flex justify-between items-center">
                          <Label className="text-xs font-bold text-slate-700">Módulos Vexo a incluir:</Label>
                          <Badge className="bg-purple-100 text-purple-750 font-mono text-[10px] font-bold border-none px-2 py-0.5">
                            Subtotal Vexo: R$ {vexoSubtotal.toLocaleString("pt-BR")}/mês
                          </Badge>
                        </div>

                        {availableVexoProducts.length === 0 ? (
                          <p className="text-[10px] text-slate-400 italic">Nenhum módulo Vexo ativo cadastrado no catálogo.</p>
                        ) : (
                          <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                            {availableVexoProducts.map((prod) => {
                              const isSelected = selectedVexoProducts.some((p) => p.id === prod.id);
                              const currentSelected = selectedVexoProducts.find((p) => p.id === prod.id);
                              const displayValue = currentSelected ? currentSelected.valor : prod.valor;

                              return (
                                <div
                                  key={prod.id}
                                  className={cn(
                                    "flex items-center justify-between p-2 rounded-lg border text-left transition-all",
                                    isSelected
                                      ? "bg-purple-50/50 border-purple-200"
                                      : "bg-white border-slate-150"
                                  )}
                                >
                                  <div className="flex items-center gap-2.5">
                                    <Switch
                                      checked={isSelected}
                                      onCheckedChange={() => handleToggleVexoProduct(prod)}
                                      className="scale-90"
                                    />
                                    <div className="space-y-0.5">
                                      <span className="text-[11px] font-bold text-slate-800 leading-tight block">
                                        {prod.nome}
                                      </span>
                                      {prod.descricao && (
                                        <span className="text-[9px] text-slate-400 block leading-tight">
                                          {prod.descricao}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[9px] text-slate-500 font-mono">R$</span>
                                    <Input
                                      type="number"
                                      value={displayValue}
                                      disabled={!isSelected}
                                      onChange={(e) =>
                                        handleUpdateVexoProductPrice(prod.id, Number(e.target.value) || 0)
                                      }
                                      className="w-20 h-7 text-right text-xs font-mono bg-white border-slate-200 disabled:opacity-60 disabled:bg-slate-50 p-1"
                                    />
                                    <span className="text-[9px] text-slate-450 font-sans">
                                      /{prod.recorrencia === "unico" ? "único" : "mês"}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Right Column: ROI Calculator */}
              <div className="space-y-6">
                <Card className="bg-white border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-800">
                      <Calculator className="h-4 w-4 text-purple-600" />
                      Simulador de ROI Comercial
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500">Previsão financeira de retorno sobre o investimento.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <Label className="text-slate-500 font-medium">Contatos/Leads Mensais</Label>
                        <span className="font-bold text-indigo-600">{leadsCount} leads</span>
                      </div>
                      <input
                        type="range"
                        min="50"
                        max="2000"
                        step="50"
                        value={leadsCount}
                        onChange={(e) => setLeadsCount(Number(e.target.value))}
                        className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-indigo-500"
                      />
                    </div>

                    <div className="grid gap-3 grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500 font-medium">Ticket Médio (R$)</Label>
                        <Input
                          type="number"
                          value={customTicket}
                          onChange={(e) => setCustomTicket(Number(e.target.value) || 0)}
                          className="bg-white border-slate-200 focus:border-indigo-500/50 text-slate-800 text-xs h-10"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500 font-medium">Conversão Atual (%)</Label>
                        <Input
                          type="number"
                          step="0.5"
                          value={customConv}
                          onChange={(e) => setCustomConv(Number(e.target.value) || 0)}
                          className="bg-white border-slate-200 focus:border-indigo-500/50 text-slate-800 text-xs h-10"
                        />
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-between mt-2">
                      <span className="text-xs text-slate-650 font-medium">Faturamento Mensal Extra Estimado:</span>
                      <span className="text-sm font-extrabold text-emerald-600">
                        R$ {additionalRevenue.toLocaleString("pt-BR")} / mês
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* Iniciar Apresentação Button */}
                <Button
                  onClick={handleStartPresentation}
                  className="w-full bg-gradient-to-r from-purple-600 to-pink-500 hover:opacity-90 font-extrabold text-sm py-6 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-purple-600/15"
                >
                  <Play className="h-4.5 w-4.5" />
                  Iniciar Apresentação (Tela Cheia)
                </Button>
              </div>
            </div>

            <Card className="bg-white border-slate-200 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-800">
                    <Briefcase className="h-4 w-4 text-pink-500" />
                    Pacotes Comerciais a Ofertar (gd_packages)
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500">Selecione os pacotes salvos que apresentará e ajuste o valor final se desejar.</CardDescription>
                </div>
                <button
                  onClick={() => navigate("/crm/pacotes-gd")}
                  className="text-[11px] text-pink-600 hover:text-pink-500 font-bold underline transition-colors"
                >
                  Gerenciar pacotes
                </button>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-3">
                  {packages.map((pk) => {
                    const isSelected = selectedPackages[pk.id] || false;
                    const overrideVal = packageOverrides[pk.id] ?? pk.valor;
                    return (
                      <div
                        key={pk.id}
                        className={cn(
                          "p-4 rounded-xl border transition-all flex flex-col justify-between space-y-3",
                          isSelected
                            ? "bg-pink-50 border-pink-200 shadow-md shadow-pink-500/5"
                            : "bg-white border-slate-200 hover:border-slate-350 shadow-sm"
                        )}
                      >
                        <div className="flex items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) =>
                              setSelectedPackages((prev) => ({
                                ...prev,
                                [pk.id]: e.target.checked
                              }))
                            }
                            className="mt-1 rounded text-pink-600 focus:ring-pink-500 bg-white border-slate-200"
                          />
                          <div className="space-y-0.5">
                            <span className="text-xs font-bold text-slate-800 block">{pk.nome}</span>
                            <span className="text-[9px] uppercase font-mono text-slate-500">
                              Período: {pk.periodo === "mensal" ? "Mensal" : "Setup Único"}
                            </span>
                          </div>
                        </div>

                        {isSelected && (
                          <div className="space-y-1">
                            <Label className="text-[9px] text-slate-550 font-mono">Valor Fechado da Oferta (R$)</Label>
                            <Input
                              type="number"
                              value={overrideVal}
                              onChange={(e) =>
                                setPackageOverrides((prev) => ({
                                  ...prev,
                                  [pk.id]: Number(e.target.value) || 0
                                }))
                              }
                              className="bg-white border-slate-200 text-xs text-slate-800 h-8 font-mono"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {packages.length === 0 && (
                    <p className="text-xs text-slate-400 italic py-4 col-span-3">Nenhum pacote cadastrado. Cadastre pacotes na aba de Pacotes.</p>
                  )}
                </div>
              </CardContent>
            </Card>

          </div>
        )}
      </div>

      {/* Fullscreen Deck Overlay */}
      {isPresenting && (
        <ErrorBoundary
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 p-8">
              <div className="max-w-lg rounded-xl border border-red-400/30 bg-white p-6 text-center space-y-4">
                <h2 className="text-lg font-bold text-slate-900">Erro ao exibir a apresentação</h2>
                <p className="text-sm text-slate-600">
                  Um dos slides encontrou um erro inesperado. Feche a apresentação e tente novamente.
                </p>
                <button
                  onClick={() => setIsPresenting(false)}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Fechar apresentação
                </button>
              </div>
            </div>
          }
        >
        <GeracaoDigitalCommercialPitch
          prospectName={prospectName}
          prospectLogo={prospectLogo}
          segmentName={activeSegmentObj?.nome || "Comercial"}
          mappedVexoSegment={mappedVexoSegment}
          vendaCasada={vendaCasada}
          selectedProductsList={consolidatedProductsList}
          packagesOfertados={selectedPackagesList}
          leadsCount={leadsCount}
          customTicket={customTicket}
          customConv={customConv}
          onClose={() => setIsPresenting(false)}
          presentationId={presentationId}
          vexoSelectedProducts={selectedVexoProducts}
        />
        </ErrorBoundary>
      )}
    </PageShell>
  );
}
