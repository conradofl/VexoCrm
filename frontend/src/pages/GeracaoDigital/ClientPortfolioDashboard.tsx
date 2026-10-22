import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Filter, Plus, FileText, Sparkles, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { PortfolioStatsCards } from "./components/PortfolioStatsCards";
import { PortfolioTable, PortfolioClient } from "./components/PortfolioTable";
import { ClientDrawer } from "./components/ClientDrawer";

// Dados base dos clientes ativos da agência Geração Digital
const INITIAL_CLIENTS: PortfolioClient[] = [
  {
    id: "sonhare-colchoes",
    name: "Sonhare Colchões",
    slug: "sonhare-colchoes",
    avatarColor: "bg-gradient-to-br from-indigo-600 to-purple-600",
    contactName: "Lucas Mendes",
    contactWhatsapp: "(11) 98765-4321",
    contactEmail: "lucas@sonharecolchoes.com.br",
    products: ["Vídeos", "Tráfego Meta/Google", "Social Media"],
    stage: "producao_ativa",
    weeklyPostsDelivered: 4,
    weeklyPostsTarget: 5,
    trafficStatus: "ativo",
    monthlyBudget: "R$ 4.500/mês",
    trelloActiveCards: 6,
    trelloOverdueCards: 0,
    driveFolderUrl: "https://drive.google.com/drive/folders/sonhare",
    slackChannel: "gd-sonhare-colchoes",
  },
  {
    id: "clinica-dr-silva",
    name: "Clínica Dr. Silva",
    slug: "clinica-dr-silva",
    avatarColor: "bg-gradient-to-br from-blue-600 to-cyan-500",
    contactName: "Dra. Patrícia Silva",
    contactWhatsapp: "(11) 99123-4567",
    contactEmail: "contato@clinicadrsilva.com.br",
    products: ["Vídeos", "Social Media", "Branding"],
    stage: "identidade_visual",
    weeklyPostsDelivered: 2,
    weeklyPostsTarget: 3,
    trafficStatus: "setup",
    monthlyBudget: "R$ 3.000/mês",
    trelloActiveCards: 8,
    trelloOverdueCards: 1,
    driveFolderUrl: "https://drive.google.com/drive/folders/drsilva",
    slackChannel: "gd-clinica-dr-silva",
  },
  {
    id: "vexo-tecnologia",
    name: "Vexo Tecnologia",
    slug: "vexo-tecnologia",
    avatarColor: "bg-gradient-to-br from-purple-600 to-pink-600",
    contactName: "Conrado Finzi",
    contactWhatsapp: "(11) 98888-7777",
    contactEmail: "conrado@vexo.com.br",
    products: ["Tráfego Meta/Google", "Consultoria", "Branding"],
    stage: "producao_ativa",
    weeklyPostsDelivered: 5,
    weeklyPostsTarget: 5,
    trafficStatus: "ativo",
    monthlyBudget: "R$ 8.000/mês",
    trelloActiveCards: 12,
    trelloOverdueCards: 0,
    driveFolderUrl: "https://drive.google.com/drive/folders/vexo",
    slackChannel: "01-ops-geral",
  },
  {
    id: "emporio-bella-vista",
    name: "Empório Bella Vista",
    slug: "emporio-bella-vista",
    avatarColor: "bg-gradient-to-br from-amber-600 to-orange-500",
    contactName: "Roberto Caldeira",
    contactWhatsapp: "(11) 97654-3210",
    contactEmail: "roberto@bellavistaemporio.com.br",
    products: ["Social Media", "Vídeos"],
    stage: "aguardando_aprovacao",
    weeklyPostsDelivered: 1,
    weeklyPostsTarget: 4,
    trafficStatus: "setup",
    monthlyBudget: "R$ 2.000/mês",
    trelloActiveCards: 5,
    trelloOverdueCards: 2,
    driveFolderUrl: "https://drive.google.com/drive/folders/bellavista",
    slackChannel: "gd-emporio-bella-vista",
  },
  {
    id: "advocacia-martins",
    name: "Martins & Associados",
    slug: "martins-associados",
    avatarColor: "bg-gradient-to-br from-slate-700 to-slate-900",
    contactName: "Dr. André Martins",
    contactWhatsapp: "(11) 98111-2233",
    contactEmail: "andre@martinsadv.com.br",
    products: ["Tráfego Meta/Google", "Branding"],
    stage: "onboarding",
    weeklyPostsDelivered: 0,
    weeklyPostsTarget: 2,
    trafficStatus: "setup",
    monthlyBudget: "R$ 2.500/mês",
    trelloActiveCards: 4,
    trelloOverdueCards: 0,
    driveFolderUrl: "https://drive.google.com/drive/folders/martins",
    slackChannel: "gd-martins-associados",
  },
];

interface ClientPortfolioDashboardProps {
  onOpenIdentityWizard?: (client?: PortfolioClient) => void;
  onOpenBriefingHub?: () => void;
}

export default function ClientPortfolioDashboard({
  onOpenIdentityWizard,
  onOpenBriefingHub,
}: ClientPortfolioDashboardProps) {
  const { getIdToken } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStage, setSelectedStage] = useState<string>("todos");
  const [selectedClient, setSelectedClient] = useState<PortfolioClient | null>(null);

  // Busca briefings reais para mesclar com a carteira
  const { data: remoteBriefings = [] } = useQuery({
    queryKey: ["geracao-digital-briefings"],
    queryFn: async () => {
      try {
        const token = await getIdToken();
        const res = await fetch("/api/geracao-digital/briefings", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return [];
        const json = await res.json();
        return (json?.data as any[]) || [];
      } catch {
        return [];
      }
    },
  });

  // Constrói lista consolidada de clientes
  const allClients = useMemo(() => {
    const list = [...INITIAL_CLIENTS];

    // Adiciona briefings reais que não estejam nos mockados
    remoteBriefings.forEach((b) => {
      const slug = (b.prospect_name || "cliente")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "-")
        .slice(0, 20);

      const alreadyExists = list.some((c) => c.slug === slug || c.name === b.prospect_name);
      if (!alreadyExists && b.prospect_name) {
        list.push({
          id: b.id || slug,
          name: b.prospect_name,
          slug,
          avatarColor: "bg-gradient-to-br from-indigo-500 to-purple-600",
          contactName: b.briefing_data?._responsavel || b.prospect_name,
          contactWhatsapp: b.whatsapp_number || "(11) 99999-9999",
          contactEmail: b.briefing_data?.prospectEmail || "",
          products: b.briefing_data?.produtos
            ? b.briefing_data.produtos.split("; ").slice(0, 3)
            : ["Social Media", "Tráfego Meta/Google"],
          stage: b.status === "completed" ? "producao_ativa" : "onboarding",
          weeklyPostsDelivered: 2,
          weeklyPostsTarget: 4,
          trafficStatus: b.briefing_data?.verba ? "ativo" : "setup",
          monthlyBudget: b.briefing_data?.verba || "R$ 3.000/mês",
          trelloActiveCards: 3,
          trelloOverdueCards: 0,
          slackChannel: `gd-${slug}`,
        });
      }
    });

    return list;
  }, [remoteBriefings]);

  // Filtros
  const filteredClients = useMemo(() => {
    return allClients.filter((c) => {
      const matchSearch =
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.contactName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.products.some((p) => p.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchStage = selectedStage === "todos" || c.stage === selectedStage;

      return matchSearch && matchStage;
    });
  }, [allClients, searchTerm, selectedStage]);

  // Métricas do Topo
  const totalClients = allClients.length;
  const activeDemands = allClients.reduce((acc, c) => acc + c.trelloActiveCards, 0);
  const overdueDemands = allClients.reduce((acc, c) => acc + c.trelloOverdueCards, 0);
  const slaPercent = 94; // SLA consolidado da agência

  const stagesList = [
    { id: "todos", label: "Todos os Clientes" },
    { id: "onboarding", label: "Onboarding" },
    { id: "identidade_visual", label: "Identidade Visual" },
    { id: "producao_ativa", label: "Produção Ativa" },
    { id: "aguardando_aprovacao", label: "Aguardando Aprovação" },
    { id: "pausado", label: "Pausados" },
  ];

  return (
    <div className="w-full space-y-6 pb-12 animate-fade-in font-sans">
      {/* ─── 1. CARDS DE MÉTRICAS NO TOPO ──────────────────────────────────── */}
      <PortfolioStatsCards
        totalClients={totalClients}
        activeDemands={activeDemands}
        overdueDemands={overdueDemands}
        slaPercent={slaPercent}
      />

      {/* ─── 2. CONTROLES E BUSCA ───────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Barra de Busca */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por cliente, decisor ou produto..."
            className="pl-9 h-10 text-xs bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-xl"
          />
        </div>

        {/* Ações */}
        <div className="flex items-center gap-2">
          {onOpenBriefingHub && (
            <Button
              type="button"
              onClick={onOpenBriefingHub}
              className="bg-purple-650 hover:bg-purple-700 text-white font-bold text-xs h-10 px-4 rounded-xl gap-2 shadow-xs"
            >
              <Plus className="w-4 h-4" />
              Novo Briefing de Cliente
            </Button>
          )}
        </div>
      </div>

      {/* Pills de Filtro por Estágio */}
      <div className="flex flex-wrap gap-2 pt-1">
        {stagesList.map((st) => {
          const isSelected = selectedStage === st.id;
          return (
            <button
              key={st.id}
              type="button"
              onClick={() => setSelectedStage(st.id)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
                isSelected
                  ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white shadow-2xs"
                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              {st.label}
            </button>
          );
        })}
      </div>

      {/* ─── 3. TABELA / GRID DE CLIENTES ────────────────────────────────────── */}
      <PortfolioTable
        clients={filteredClients}
        onSelectClient={(c) => setSelectedClient(c)}
      />

      {/* ─── 4. GAVETA DE DETALHES DO CLIENTE ─────────────────────────────────── */}
      <ClientDrawer
        client={selectedClient}
        onClose={() => setSelectedClient(null)}
        onOpenIdentityWizard={(c) => {
          setSelectedClient(null);
          if (onOpenIdentityWizard) onOpenIdentityWizard(c);
        }}
      />
    </div>
  );
}
