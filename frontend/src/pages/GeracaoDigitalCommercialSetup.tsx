import { useState, useEffect, useMemo, ChangeEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { PresentationViewer } from "@/components/presentation/PresentationViewer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SEGMENTS, type SegmentScenario } from "@/pages/demoSegments";
import { computeRoi } from "@/lib/vexoPitch/helpers";

const DEFAULT_SEGMENTS = [
  { id: "1", nome: "Energia solar", faturamento_min: 50000 },
  { id: "2", nome: "Consórcios", faturamento_min: 30000 },
  { id: "3", nome: "Imobiliário", faturamento_min: 80000 },
  { id: "4", nome: "Incorporadoras", faturamento_min: 100000 },
  { id: "5", nome: "Clínicas de Estética", faturamento_min: 40000 },
  { id: "6", nome: "Odontologia", faturamento_min: 40000 },
  { id: "23", nome: "Clínicas de Saúde", faturamento_min: 50000 },
  { id: "7", nome: "E-commerce", faturamento_min: 60000 },
  { id: "8", nome: "Varejo Escalável", faturamento_min: 60000 },
  { id: "9", nome: "Automotivo (Concessionárias)", faturamento_min: 100000 },
  { id: "10", nome: "Automotivo (Seminovos)", faturamento_min: 80000 },
  { id: "11", nome: "Advocacia", faturamento_min: 20000 },
  { id: "12", nome: "Contabilidade", faturamento_min: 20000 },
  { id: "13", nome: "Educação (Cursos)", faturamento_min: 35000 },
  { id: "14", nome: "Educação (Escolas)", faturamento_min: 40000 },
  { id: "15", nome: "Saúde (Clínicas)", faturamento_min: 50000 },
  { id: "16", nome: "Saúde (Laboratórios)", faturamento_min: 60000 },
  { id: "17", nome: "Franquias", faturamento_min: 150000 },
  { id: "18", nome: "Redes Multiunidade", faturamento_min: 150000 },
  { id: "19", nome: "Turismo", faturamento_min: 45000 },
  { id: "20", nome: "Hospitalidade", faturamento_min: 50000 },
  { id: "21", nome: "Food Service Premium", faturamento_min: 30000 },
  { id: "22", nome: "Delivery", faturamento_min: 25000 },
  { id: "24", nome: "Óticas", faturamento_min: 25000 }
];

const SEGMENT_MAPPING: Record<string, string> = {
  "Energia solar": "b2b",
  "Consórcios": "b2b",
  "Imobiliário": "b2b",
  "Incorporadoras": "b2b",
  "Clínicas de Estética": "academia",
  "Odontologia": "academia",
  "Clínicas de Saúde": "academia",
  "E-commerce": "restaurante",
  "Varejo Escalável": "restaurante",
  "Automotivo (Concessionárias)": "b2b",
  "Automotivo (Seminovos)": "b2b",
  "Advocacia": "b2b",
  "Contabilidade": "b2b",
  "Educação (Cursos)": "b2b",
  "Educação (Escolas)": "b2b",
  "Saúde (Clínicas)": "b2b",
  "Saúde (Laboratórios)": "b2b",
  "Franquias": "b2b",
  "Redes Multiunidade": "b2b",
  "Turismo": "turismo",
  "Hospitalidade": "turismo",
  "Food Service Premium": "restaurante",
  "Delivery": "restaurante",
  "Óticas": "academia",
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
  valor_tabela?: number | null;
  destaque: boolean;
}

export default function GeracaoDigitalCommercialSetup() {
  const { isAuthenticated, getIdToken, clientId } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const proposalId = searchParams.get("proposalId");

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

  // Load Proposal Details if proposalId is present
  useEffect(() => {
    async function loadProposal() {
      if (!proposalId || !isAuthenticated) return;
      try {
        const token = await getIdToken();
        const headers: HeadersInit = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetchApi(`/api/gd/proposals/${proposalId}?client_id=${clientId || ""}`, { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.data) {
            if (data.data.prospect_name) setProspectName(data.data.prospect_name);
            if (data.data.cobrar_setup !== undefined) setVendaCasada(data.data.cobrar_setup);
            if (data.data.segment_id) setSelectedSegmentId(data.data.segment_id);
            if (data.data.prospect_logo) setProspectLogo(data.data.prospect_logo);
            if (data.data.roi) {
              const roiParsed = typeof data.data.roi === "string" ? JSON.parse(data.data.roi) : data.data.roi;
              if (roiParsed.leads) setLeadsCount(roiParsed.leads);
              if (roiParsed.ticket) setCustomTicket(roiParsed.ticket);
              if (roiParsed.conv) setCustomConv(roiParsed.conv);
            }
          }
        }
      } catch (err) {
        console.error("Falha ao carregar a proposta", err);
      }
    }
    loadProposal();
  }, [proposalId, isAuthenticated, clientId]);

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
            // Não sobrescrever o segmento quando a tela foi aberta a partir de uma
            // proposta (proposalId) — nesse caso o loadProposal já setou o correto.
            if (!proposalId) {
              setSelectedSegmentId(segmentsData.data[0].id);
            }
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

  // CTA "Ir para a proposta" no fim da apresentação.
  // - Já veio de uma proposta (proposalId): abre a proposta pública.
  // - Apresentação avulsa: cria um RASCUNHO de proposta para esta empresa
  //   (nome/logo/segmento/pacotes da apresentação) e leva para o editor, para
  //   o vendedor só finalizar. Assim dá pra apresentar antes e fechar depois.
  const handleGoToProposal = async () => {
    if (proposalId) {
      window.open(`/proposta/${proposalId}`, "_blank");
      return;
    }
    if (!prospectName.trim()) {
      toast({ title: "Nome obrigatório", description: "Informe o nome da empresa antes de gerar a proposta.", variant: "destructive" });
      return;
    }
    try {
      const token = await getIdToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      // Separa pacotes ofertados por tipo (gd / vexo) para semear os itens.
      const selIds = Object.entries(selectedPackages).filter(([_, v]) => v).map(([id]) => id);
      const gdPkgId = selIds.find((id) => { const p = packages.find((x) => x.id === id); return p && p.tipo !== "vexo"; }) || null;
      const vexoPkgId = selIds.find((id) => { const p = packages.find((x) => x.id === id); return p && p.tipo === "vexo"; }) || null;

      const body = {
        client_id: clientId || "00000000-0000-0000-0000-000000000000",
        presentation_id: presentationId,
        prospect_name: prospectName,
        package_id: gdPkgId,
        package_vexo_id: vexoPkgId,
        status: "rascunho"
      };

      const res = await fetchApi("/api/gd/proposals", { method: "POST", headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erro ao criar o rascunho da proposta.");
      }
      toast({ title: "Rascunho criado", description: `Proposta rascunho de ${prospectName} pronta para finalizar.` });
      setIsPresenting(false);
      navigate("/crm/propostas-gd");
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro ao gerar proposta", description: err.message, variant: "destructive" });
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
          valor_tabela: Number(pk?.valor_tabela || 0) || null,
          periodo: pk?.periodo || "mensal",
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
      <div className="w-full bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 rounded-3xl p-6 border border-slate-200 dark:border-white/10 shadow-sm relative overflow-hidden">

        {/* Decorative background blur */}
        <div className="absolute top-0 right-0 h-96 w-96 bg-purple-50 dark:bg-purple-950/20 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 h-96 w-96 bg-pink-50 dark:bg-pink-950/20 rounded-full blur-[100px] pointer-events-none" />

        {/* 1. Selector of Flow (A vs B) */}
        <div className="flex justify-center mb-8 relative z-10">
          <div className="bg-slate-100 dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-white/10 flex gap-2">
            <button
              onClick={() => setActiveFlow("A")}
              className={cn(
                "px-6 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-widest transition-all",
                activeFlow === "A"
                  ? "bg-gradient-to-r from-purple-700 to-indigo-600 text-white shadow-md shadow-indigo-600/20"
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
                  ? "bg-gradient-to-r from-purple-700 to-indigo-600 text-white shadow-md shadow-indigo-600/20"
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              Fluxo B · Briefing
            </button>
          </div>
        </div>

        {/* 2. Flow B View */}
        {activeFlow === "B" ? (
          <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 max-w-lg mx-auto py-8 text-center relative z-10 shadow-sm">
            <CardContent className="space-y-6">
              <Briefcase className="h-12 w-12 text-slate-500 mx-auto dark:text-slate-400" />
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-slate-800 dark:text-white">Fluxo de Briefing GD</h3>
                <p className="text-xs text-slate-500 max-w-xs mx-auto dark:text-slate-400">
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
                <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-800 dark:text-white">
                      <Building2 className="h-4 w-4 text-purple-600" />
                      Dados do Prospect
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500 dark:text-slate-400">Identificação e segmento para o pitch comercial.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">

                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-500 font-medium dark:text-slate-400">Nome da Empresa Prospect</Label>
                      <Input
                        value={prospectName}
                        onChange={(e) => setProspectName(e.target.value)}
                        placeholder="Ex: Nome da Empresa"
                        className="bg-white dark:bg-slate-800 border-slate-200 dark:border-white/10 focus:border-indigo-500/50 text-slate-800 dark:text-slate-100 text-xs h-10"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs text-slate-500 font-medium dark:text-slate-400">Segmento de Atuação</Label>
                      <select
                        value={selectedSegmentId}
                        onChange={(e) => setSelectedSegmentId(e.target.value)}
                        className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500/50 h-10"
                      >
                        {segments.map((seg) => (
                          <option key={seg.id} value={seg.id}>
                            {seg.nome} (Fat. Min: R$ {Number(seg.faturamento_min).toLocaleString()})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs text-slate-500 font-medium block dark:text-slate-400">Logotipo do Prospect</Label>
                      <div className="flex items-center gap-4">
                        {prospectLogo ? (
                          <div className="relative h-16 w-16 rounded-xl bg-white dark:bg-slate-800 p-1 flex items-center justify-center border border-slate-200 dark:border-white/10">
                            <img src={prospectLogo} alt="Logo" className="h-full w-full object-contain" />
                            <button
                              onClick={() => setProspectLogo(null)}
                              className="absolute -top-1.5 -right-1.5 bg-red-600 rounded-full p-1 text-white hover:bg-red-500"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <Label className="h-16 w-16 rounded-xl border border-dashed border-slate-200 dark:border-white/10 hover:border-slate-300 cursor-pointer flex flex-col items-center justify-center text-slate-400 hover:text-slate-300 bg-slate-50 dark:bg-slate-800">
                            <Upload className="h-4 w-4 mb-1" />
                            <span className="text-[9px] uppercase font-mono">logo</span>
                            <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                          </Label>
                        )}
                        <span className="text-[10px] text-slate-500 leading-snug dark:text-slate-400">Selecione uma imagem PNG ou JPG para personalizar a capa e os slides do pitch comercial.</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Right Column: Preview da Apresentação */}
              <div className="space-y-6">
                <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-sm font-bold flex items-center gap-2 text-slate-800 dark:text-white">
                      <Play className="h-4 w-4 text-purple-600" />
                      Apresentação Comercial
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                      Roteiro dinâmico por segmento, com estimativas por benchmark de mercado — sem depender de números que o cliente não tem em mãos.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-150 dark:border-white/5 space-y-2 text-xs text-slate-600 dark:text-slate-300">
                      <p><span className="font-bold text-slate-800 dark:text-slate-100">Empresa:</span> {prospectName || "—"}</p>
                      <p><span className="font-bold text-slate-800 dark:text-slate-100">Segmento:</span> {activeSegmentObj?.nome || "—"}</p>
                      <p className="text-[11px] text-slate-450 dark:text-slate-500">A apresentação usa o nome e a logomarca acima na abertura personalizada.</p>
                    </div>
                  </CardContent>
                </Card>

                {/* Iniciar Apresentação Button */}
                <Button
                  onClick={handleStartPresentation}
                  className="w-full bg-gradient-to-r from-purple-700 to-indigo-600 hover:opacity-90 font-extrabold text-sm py-6 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/15"
                >
                  <Play className="h-4.5 w-4.5" />
                  Iniciar Apresentação (Tela Cheia)
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Fullscreen Deck Overlay */}
      {isPresenting && (
        <ErrorBoundary
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 p-8">
              <div className="max-w-lg rounded-xl border border-red-400/30 bg-white dark:bg-slate-900 p-6 text-center space-y-4">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">Erro ao exibir a apresentação</h2>
                <p className="text-sm text-slate-600 dark:text-slate-300">
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
        <PresentationViewer
          companyName={prospectName || "Sua Empresa"}
          logoUrl={prospectLogo}
          segmentId={activeSegmentObj?.nome || null}
          proposalHref={proposalId ? `/proposta/${proposalId}` : null}
          onGoToProposal={proposalId ? undefined : handleGoToProposal}
          onClose={() => setIsPresenting(false)}
        />
        </ErrorBoundary>
      )}
    </PageShell>
  );
}
