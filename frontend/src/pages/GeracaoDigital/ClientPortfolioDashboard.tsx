import React, { useState, useMemo } from "react";
import { Search, Plus, RefreshCw, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useGdClientes } from "@/hooks/useGdClientes";
import { PortfolioStatsCards } from "./components/PortfolioStatsCards";
import { PortfolioTable, PortfolioClient } from "./components/PortfolioTable";
import { ClientDrawer } from "./components/ClientDrawer";

const AVATAR_COLORS = [
  "bg-gradient-to-br from-indigo-600 to-purple-600",
  "bg-gradient-to-br from-blue-600 to-cyan-500",
  "bg-gradient-to-br from-purple-600 to-pink-600",
  "bg-gradient-to-br from-amber-600 to-orange-500",
  "bg-gradient-to-br from-emerald-600 to-teal-500",
  "bg-gradient-to-br from-rose-600 to-red-500",
  "bg-gradient-to-br from-slate-700 to-slate-900",
];

function slugify(nome: string): string {
  return (nome || "cliente")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mapearStage(fase?: string | null, estadoAtual?: string | null): PortfolioClient["stage"] {
  const estado = (estadoAtual || "").toUpperCase();
  const f = (fase || "").toLowerCase();

  if (estado === "PAUSADO" || estado === "ENCERRADO") return "pausado";
  if (estado === "IDENTIDADE_VISUAL") return "identidade_visual";
  if (
    estado.includes("APROVACAO") ||
    estado.includes("AGUARDANDO") ||
    estado === "ROTEIRO"
  ) {
    return "aguardando_aprovacao";
  }
  if (f === "regime" || estado === "ATIVO" || estado === "ESTRATEGIA_APROVADA") {
    return "producao_ativa";
  }
  if (f === "entrada" || f === "estrategia" || f === "comercial") {
    return "onboarding";
  }
  return "onboarding";
}

interface ClientPortfolioDashboardProps {
  onOpenIdentityWizard?: (client?: PortfolioClient) => void;
  onOpenBriefingHub?: () => void;
}

export default function ClientPortfolioDashboard({
  onOpenIdentityWizard,
  onOpenBriefingHub,
}: ClientPortfolioDashboardProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStage, setSelectedStage] = useState<string>("todos");
  const [selectedClient, setSelectedClient] = useState<PortfolioClient | null>(null);

  // Busca carteira oficial de clientes GD via hook canônico
  const { data: clientes = [], isLoading, isError, refetch } = useGdClientes();

  // Mapeia os clientes retornados por useGdClientes() para o formato exibido na tabela
  const allClients: PortfolioClient[] = useMemo(() => {
    return clientes.map((cliente, idx) => {
      const slug = cliente.portal_slug || slugify(cliente.nome);
      return {
        id: cliente.id,
        name: cliente.nome,
        slug,
        avatarColor: AVATAR_COLORS[idx % AVATAR_COLORS.length],
        contactName: cliente.aprovador_nome || "Aprovador não informado",
        contactWhatsapp: cliente.aprovador_telefone || "—",
        contactEmail: cliente.google_calendar_email || undefined,
        products: (cliente.escopo as string[]) || [],
        stage: mapearStage(cliente.fase, cliente.estado_atual),
        rotulo_interno: cliente.rotulo_interno || cliente.estado_atual || null,
        fase: cliente.fase || null,
        prazo: cliente.prazo || null,
        weeklyPostsDelivered: 0,
        weeklyPostsTarget: 0,
        trafficStatus:
          cliente.fase?.toLowerCase() === "regime" || cliente.estado_atual === "ATIVO"
            ? "ativo"
            : "setup",
        monthlyBudget:
          cliente.fase?.toLowerCase() === "regime" ? "Ativo" : "Setup",
        trelloActiveCards: 0,
        trelloOverdueCards: cliente.prazo?.atrasado ? 1 : 0,
        driveFolderUrl: cliente.drive_url || null,
      };
    });
  }, [clientes]);

  // Filtros de busca e estágio
  const filteredClients = useMemo(() => {
    return allClients.filter((c) => {
      const search = searchTerm.toLowerCase();
      const matchSearch =
        !searchTerm ||
        c.name.toLowerCase().includes(search) ||
        c.contactName.toLowerCase().includes(search) ||
        c.slug.toLowerCase().includes(search) ||
        (c.rotulo_interno && c.rotulo_interno.toLowerCase().includes(search)) ||
        c.products.some((p) => p.toLowerCase().includes(search));

      const matchStage =
        selectedStage === "todos" ||
        c.stage === selectedStage;

      return matchSearch && matchStage;
    });
  }, [allClients, searchTerm, selectedStage]);

  // 4 cards de métricas do topo baseados em dados reais:
  // 1. Total de Clientes: clientes.length
  // 2. Clientes Ativos (Regime): fase === 'regime' || estado_atual === 'ATIVO'
  // 3. Em Implantação / Setup: fase === 'entrada' || fase === 'estrategia'
  // 4. Prazos / Atenção: prazo?.atrasado === true
  const totalClients = clientes.length;

  const activeClients = useMemo(() => {
    return clientes.filter(
      (c) => c.fase?.toLowerCase() === "regime" || c.estado_atual === "ATIVO"
    ).length;
  }, [clientes]);

  const setupClients = useMemo(() => {
    return clientes.filter(
      (c) =>
        c.fase?.toLowerCase() === "entrada" ||
        c.fase?.toLowerCase() === "estrategia"
    ).length;
  }, [clientes]);

  const attentionClients = useMemo(() => {
    return clientes.filter((c) => c.prazo?.atrasado === true).length;
  }, [clientes]);

  const stagesList = [
    { id: "todos", label: "Todos os Clientes" },
    { id: "producao_ativa", label: "Regime / Ativos" },
    { id: "onboarding", label: "Implantação / Setup" },
    { id: "aguardando_aprovacao", label: "Aguardando Aprovação" },
    { id: "identidade_visual", label: "Identidade Visual" },
    { id: "pausado", label: "Pausados" },
  ];

  return (
    <div className="w-full space-y-6 pb-12 animate-fade-in font-sans">
      {/* ─── 1. CARDS DE MÉTRICAS NO TOPO ──────────────────────────────────── */}
      <PortfolioStatsCards
        totalClients={totalClients}
        activeClients={activeClients}
        setupClients={setupClients}
        attentionClients={attentionClients}
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="h-10 px-3 rounded-xl gap-1.5 text-xs border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
            title="Atualizar lista de clientes"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>Atualizar</span>
          </Button>

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

      {/* Erro ao carregar */}
      {isError && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 text-xs text-rose-700 dark:text-rose-400 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Não foi possível carregar a carteira de clientes da Geração Digital.</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="h-8 text-xs border-rose-300 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-900/40"
          >
            Tentar novamente
          </Button>
        </div>
      )}

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
