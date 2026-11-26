import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2,
  Crown,
  Wifi,
  WifiOff,
  Zap,
  Search,
  Eye,
  RefreshCw,
  AlertTriangle,
  CalendarClock,
  Clock,
  Plus,
  Send,
  Trash2,
  UserCheck,
  Filter,
  Lock,
  Unlock,
  Megaphone,
  History,
  ChevronDown,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  Scale,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { fetchApi } from "@/lib/api";

interface TorreChipItem {
  id: string;
  name: string;
  phone: string | null;
  connected: boolean;
  connectionState: string;
  chipState: string;
  usedToday: number;
  totalSent: number;
  dailyLimit: number;
  isDefault: boolean;
  balancePercentToday: number;
  balancePercentTotal: number;
}

interface TorreCampaignItem {
  id: string;
  name: string;
  status: string;
  startsAt: string | null;
  completedAt: string | null;
  estimatedEndAt: string | null;
  totalLeads: number;
  sentCount: number;
  remainingInQueue: number;
  failedCount: number;
  pauseReason: string | null;
  lastTriggeredAt: string | null;
}

interface TorreContatoLog {
  id: string;
  horarioContato: string;
  futuroContato: string | null;
  responsavel: string;
  resumo: string;
  proximoAssunto?: string;
  criadoEm: string;
  criadoPor: string;
}

interface TorreClienteItem {
  id: string;
  name: string;
  createdAt: string;
  semaforo: "critico" | "atencao" | "saudavel";
  alertas: string[];
  chips: {
    total: number;
    connected: number;
    disconnected: number;
    usedQuotaToday: number;
    totalSentAllChips: number;
    totalDailyLimit: number;
    items: TorreChipItem[];
  };
  campanhas: {
    total: number;
    ativas: number;
    pausadas: number;
    totalLeads: number;
    enviadosTotal: number;
    filaRestante: number;
    falhasTotal: number;
    items: TorreCampaignItem[];
  };
  disparos: {
    enviadosHoje: number;
    respostasHoje: number;
    ultimoDisparoAt: string | null;
    ultimaRespostaAt: string | null;
  };
  relacionamento: {
    responsavel: string;
    horarioContato: string | null;
    futuroContato: string | null;
    futuroContatoStatus: "atrasado" | "hoje" | "agendado" | "sem_agendamento";
    demandaAtual: string;
    proximoAssunto: string;
    historicoContatos: TorreContatoLog[];
  };
}

interface ColaboradorOption {
  nome: string;
  cargo?: string;
  telefone?: string;
}

function toLocalDatetimeInputValue(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function formatDateTimeBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function formatCampaignStatusBadge(status: string) {
  const s = String(status || "").toLowerCase();
  if (["running", "ativa", "executando", "queued"].includes(s)) {
    return {
      label: "Ativa",
      cls: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40 font-semibold",
    };
  }
  if (["scheduled", "agendada"].includes(s)) {
    return {
      label: "Agendada",
      cls: "bg-cyan-100 text-cyan-900 border-cyan-300 dark:bg-cyan-500/20 dark:text-cyan-200 dark:border-cyan-500/40 font-semibold",
    };
  }
  if (["paused", "pausada", "interrupted", "interrompido"].includes(s)) {
    return {
      label: "Pausada",
      cls: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-500/40 font-semibold",
    };
  }
  if (["done", "completed", "concluida", "enviada"].includes(s)) {
    return {
      label: "Concluída",
      cls: "bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-500/20 dark:text-indigo-200 dark:border-indigo-500/40 font-semibold",
    };
  }
  if (["failed", "falhou"].includes(s)) {
    return {
      label: "Falhou",
      cls: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-500/20 dark:text-rose-200 dark:border-rose-500/40 font-semibold",
    };
  }
  return {
    label: "Rascunho",
    cls: "bg-slate-200 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 font-semibold",
  };
}

export default function SuperAdmin() {
  const navigate = useNavigate();
  const { getIdToken } = useAuth();
  const crmClient = useOptionalCrmClient();

  const [loading, setLoading] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(true);
  const [gdAccessEnabled, setGdAccessEnabled] = useState(true);
  const [togglingGdAccess, setTogglingGdAccess] = useState(false);
  const [colaboradores, setColaboradores] = useState<ColaboradorOption[]>([
    { nome: "Gabriel Oliveira" },
    { nome: "Caio Almeida" },
    { nome: "Conrado Finzi" },
    { nome: "Santana" },
    { nome: "Éflen" },
    { nome: "Duda" },
    { nome: "Humberto" },
    { nome: "Carlos" },
  ]);

  const [clientes, setClientes] = useState<TorreClienteItem[]>([]);
  const [resumoGlobal, setResumoGlobal] = useState({
    totalClientes: 0,
    clientesCriticos: 0,
    clientesAtencao: 0,
    clientesSaudaveis: 0,
    contatosAtrasados: 0,
    contatosHoje: 0,
    totalFilaPendente: 0,
    totalDisparosHoje: 0,
    chipsConectados: 0,
    chipsDesconectados: 0,
  });

  // Filtros da Torre (Filtro por Empresa como solicitado pelo Conrado)
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [empresaFilter, setEmpresaFilter] = useState<string>("all");

  // Modo de visualização dos chips: "hoje" (cota do dia) | "total" (disparo total e balanceamento)
  const [chipViewMode, setChipViewMode] = useState<"hoje" | "total">("hoje");

  // Estado independente de expandir/minimizar cada empresa (true = minimizado, false/undefined = expandido)
  const [minimizedClients, setMinimizedClients] = useState<Record<string, boolean>>({});

  // Controle de formulário de Novo Contato / Futuro Contato por cliente
  const [openContactFormClientId, setOpenContactFormClientId] = useState<string | null>(null);
  const [openHistoryClientIds, setOpenHistoryClientIds] = useState<Record<string, boolean>>({});
  const [savingContactClientId, setSavingContactClientId] = useState<string | null>(null);
  const [cobrandoClientId, setCobrandoClientId] = useState<string | null>(null);

  const [formResponsavel, setFormResponsavel] = useState("");
  const [formHorarioContato, setFormHorarioContato] = useState(() => toLocalDatetimeInputValue(new Date()));
  const [formFuturoContato, setFormFuturoContato] = useState(() =>
    toLocalDatetimeInputValue(new Date(Date.now() + 24 * 3600 * 1000))
  );
  const [formResumo, setFormResumo] = useState("");
  const [formProximoAssunto, setFormProximoAssunto] = useState("");

  const getAuthHeaders = async () => {
    try {
      const token = await getIdToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      return headers;
    } catch {
      return { "Content-Type": "application/json" };
    }
  };

  const fetchTorreData = async () => {
    try {
      setLoading(true);
      const headers = await getAuthHeaders();
      const res = await fetchApi("/api/superadmin/torre-clientes", { headers });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.message || "Não foi possível carregar a Torre de Controle.");
      }
      const data = await res.json();
      setIsSuperAdmin(data.isSuperAdmin !== false);
      setGdAccessEnabled(data.gdAccessEnabled !== false);
      if (Array.isArray(data.colaboradoresDisponiveis) && data.colaboradoresDisponiveis.length > 0) {
        setColaboradores(data.colaboradoresDisponiveis);
      }
      if (data.resumoGlobal) {
        setResumoGlobal(data.resumoGlobal);
      }
      if (Array.isArray(data.clientes)) {
        setClientes(data.clientes);
      }
    } catch (err: any) {
      toast.error(err?.message || "Erro ao carregar Torre de Controle de Clientes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTorreData();
  }, []);

  const toggleMinimizeClient = (clientId: string) => {
    setMinimizedClients((prev) => ({
      ...prev,
      [clientId]: !prev[clientId],
    }));
  };

  const handleExpandAll = () => {
    setMinimizedClients({});
  };

  const handleMinimizeAll = () => {
    const next: Record<string, boolean> = {};
    for (const c of clientes) {
      next[c.id] = true;
    }
    setMinimizedClients(next);
  };

  const handleToggleGdAccess = async () => {
    try {
      setTogglingGdAccess(true);
      const next = !gdAccessEnabled;
      const headers = await getAuthHeaders();
      const res = await fetchApi("/api/superadmin/torre-clientes/gd-access", {
        method: "POST",
        headers,
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error("Falha ao alterar permissão da GD.");
      setGdAccessEnabled(next);
      toast.success(
        next
          ? "Acesso à Torre de Controle LIBERADO para a equipe GD!"
          : "Acesso da equipe GD à Torre de Controle BLOQUEADO."
      );
    } catch (err: any) {
      toast.error(err?.message || "Erro ao atualizar acesso da GD.");
    } finally {
      setTogglingGdAccess(false);
    }
  };

  const handleOpenContactForm = (cliente: TorreClienteItem) => {
    setMinimizedClients((prev) => ({ ...prev, [cliente.id]: false }));
    if (openContactFormClientId === cliente.id) {
      setOpenContactFormClientId(null);
      return;
    }
    setOpenContactFormClientId(cliente.id);
    setFormResponsavel(cliente.relacionamento.responsavel || "Gabriel Oliveira");
    setFormHorarioContato(toLocalDatetimeInputValue(new Date()));
    setFormFuturoContato(
      cliente.relacionamento.futuroContato
        ? toLocalDatetimeInputValue(new Date(cliente.relacionamento.futuroContato))
        : toLocalDatetimeInputValue(new Date(Date.now() + 24 * 3600 * 1000))
    );
    setFormResumo(cliente.relacionamento.demandaAtual || "");
    setFormProximoAssunto(cliente.relacionamento.proximoAssunto || "");
  };

  const handleSaveContato = async (clientId: string) => {
    try {
      setSavingContactClientId(clientId);
      const headers = await getAuthHeaders();
      const res = await fetchApi(`/api/superadmin/torre-clientes/${clientId}/contatos`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          responsavel: formResponsavel,
          horarioContato: formHorarioContato ? new Date(formHorarioContato).toISOString() : new Date().toISOString(),
          futuroContato: formFuturoContato ? new Date(formFuturoContato).toISOString() : null,
          resumo: formResumo,
          demandaAtual: formResumo,
          proximoAssunto: formProximoAssunto,
        }),
      });
      if (!res.ok) throw new Error("Falha ao salvar registro de contato.");
      toast.success("Horário do contato e futuro contato registrados com sucesso!");
      setOpenContactFormClientId(null);
      setOpenHistoryClientIds((prev) => ({ ...prev, [clientId]: true }));
      await fetchTorreData();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao salvar contato.");
    } finally {
      setSavingContactClientId(null);
    }
  };

  const handleDeleteContato = async (clientId: string, contatoId: string) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetchApi(`/api/superadmin/torre-clientes/${clientId}/contatos/${contatoId}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) throw new Error("Falha ao remover contato.");
      toast.success("Registro de contato removido.");
      await fetchTorreData();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao remover contato.");
    }
  };

  const handleCobrarWandinha = async (cliente: TorreClienteItem) => {
    try {
      setCobrandoClientId(cliente.id);
      const headers = await getAuthHeaders();
      const res = await fetchApi(`/api/superadmin/torre-clientes/${cliente.id}/cobrar`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          clientName: cliente.name,
          responsavel: cliente.relacionamento.responsavel || "Gabriel Oliveira",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.sucesso === false) {
        throw new Error(data?.message || "Falha ao disparar cobrança via Wandinha.");
      }
      toast.success(`Wandinha enviou a cobrança no WhatsApp de ${data.destinatario}!`);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao cobrar colaborador via Wandinha.");
    } finally {
      setCobrandoClientId(null);
    }
  };

  const handleImpersonate = (tenantId: string, tenantName: string, targetPath = "/crm/dashboard") => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("vexo.crm.selected-client", tenantId);
    }
    if (crmClient?.setSelectedClientId) {
      crmClient.setSelectedClientId(tenantId);
    }
    toast.success(`Abrindo ${tenantName}...`);
    setTimeout(() => {
      navigate(targetPath);
    }, 250);
  };

  const filteredClientes = useMemo(() => {
    return clientes.filter((c) => {
      if (empresaFilter !== "all" && c.id !== empresaFilter) {
        return false;
      }

      const matchesSearch =
        !searchTerm.trim() ||
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.relacionamento.responsavel.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.relacionamento.demandaAtual.toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchesSearch) return false;

      if (statusFilter === "critico") return c.semaforo === "critico";
      if (statusFilter === "atencao") return c.semaforo === "atencao";
      if (statusFilter === "saudavel") return c.semaforo === "saudavel";
      if (statusFilter === "contato_pendente") {
        return (
          c.relacionamento.futuroContatoStatus === "atrasado" ||
          c.relacionamento.futuroContatoStatus === "hoje"
        );
      }
      if (statusFilter === "chip_caido") return c.chips.disconnected > 0;
      return true;
    });
  }, [clientes, searchTerm, statusFilter, empresaFilter]);

  return (
    <div className="h-full overflow-y-auto space-y-6 bg-background p-4 md:p-6 pb-28 text-foreground">
      {/* Cabeçalho da Torre de Controle */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-border pb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-cyan-500 shadow-lg shadow-purple-500/25 text-white shrink-0">
            <Crown className="h-6 w-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Torre de Controle de Clientes · Vexo OS
              </h1>
              <Badge
                variant="outline"
                className="bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30 font-semibold"
              >
                Visão Geral Multi-Empresas
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Controle de campanhas (início e conclusão), fila de disparos, chips (dia, total e balanceamento), horário do contato e futuro contato.
            </p>
          </div>
        </div>

        {/* Controles Superiores: Liberar GD + Expandir/Minimizar Todas + Atualizar */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExpandAll}
            className="border-border bg-card text-foreground hover:bg-accent text-xs"
            title="Expandir o card de todas as empresas"
          >
            <ChevronsUpDown className="mr-1.5 h-3.5 w-3.5" /> Expandir Todas
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleMinimizeAll}
            className="border-border bg-card text-foreground hover:bg-accent text-xs"
            title="Minimizar o card de todas as empresas"
          >
            <ChevronsDownUp className="mr-1.5 h-3.5 w-3.5" /> Minimizar Todas
          </Button>

          {isSuperAdmin && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={togglingGdAccess}
              onClick={handleToggleGdAccess}
              className={
                gdAccessEnabled
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25 font-semibold"
                  : "border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-300 dark:hover:bg-rose-500/25 font-semibold"
              }
              title="Permite liberar ou bloquear o acesso da equipe GD a este painel em 1 clique"
            >
              {gdAccessEnabled ? (
                <>
                  <Unlock className="mr-2 h-4 w-4" /> Acesso GD: Liberado
                </>
              ) : (
                <>
                  <Lock className="mr-2 h-4 w-4" /> Acesso GD: Bloqueado
                </>
              )}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={fetchTorreData}
            disabled={loading}
            className="border-border bg-card text-foreground hover:bg-accent"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar Torre
          </Button>
        </div>
      </div>

      {/* Semáforo e Indicadores Globais */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card
          onClick={() => setStatusFilter("all")}
          className="cursor-pointer border-border bg-card hover:border-purple-500/50 transition-all shadow-sm"
        >
          <CardHeader className="flex flex-row items-center justify-between pb-1.5">
            <CardTitle className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Empresas na Torre
            </CardTitle>
            <Building2 className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{resumoGlobal.totalClientes}</div>
            <p className="mt-1 text-xs text-muted-foreground font-medium">
              🟢 {resumoGlobal.clientesSaudaveis} ok · 🟡 {resumoGlobal.clientesAtencao} atenção · 🔴{" "}
              {resumoGlobal.clientesCriticos} críticos
            </p>
          </CardContent>
        </Card>

        <Card
          onClick={() => setStatusFilter(statusFilter === "contato_pendente" ? "all" : "contato_pendente")}
          className="cursor-pointer border-border bg-card hover:border-amber-500/50 transition-all shadow-sm"
        >
          <CardHeader className="flex flex-row items-center justify-between pb-1.5">
            <CardTitle className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Futuro Contato (Hoje / Atraso)
            </CardTitle>
            <CalendarClock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {resumoGlobal.contatosAtrasados + resumoGlobal.contatosHoje}
            </div>
            <p className="mt-1 text-xs text-rose-600 dark:text-rose-400 font-semibold">
              {resumoGlobal.contatosAtrasados} atrasados · {resumoGlobal.contatosHoje} para hoje
            </p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1.5">
            <CardTitle className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Fila de Envios Pendente
            </CardTitle>
            <Megaphone className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{resumoGlobal.totalFilaPendente}</div>
            <p className="mt-1 text-xs text-muted-foreground">Leads aguardando disparo nas campanhas</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1.5">
            <CardTitle className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Disparos Hoje (24h)
            </CardTitle>
            <Zap className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{resumoGlobal.totalDisparosHoje}</div>
            <p className="mt-1 text-xs text-muted-foreground">Volume enviado hoje em todos os clientes</p>
          </CardContent>
        </Card>

        <Card
          onClick={() => setStatusFilter(statusFilter === "chip_caido" ? "all" : "chip_caido")}
          className="cursor-pointer border-border bg-card hover:border-emerald-500/50 transition-all shadow-sm"
        >
          <CardHeader className="flex flex-row items-center justify-between pb-1.5">
            <CardTitle className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Saúde dos Chips
            </CardTitle>
            <Wifi className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {resumoGlobal.chipsConectados}{" "}
              <span className="text-sm font-normal text-muted-foreground">conectados</span>
            </div>
            <p className="mt-1 text-xs text-rose-600 dark:text-rose-400 font-semibold">
              {resumoGlobal.chipsDesconectados > 0
                ? `⚠️ ${resumoGlobal.chipsDesconectados} chip(s) desconectado(s)`
                : "✅ Todos os chips ativos online"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Barra de Filtros e Filtro por Empresa */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between bg-card border border-border p-3.5 rounded-2xl shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { key: "all", label: `Todos (${clientes.length})` },
            { key: "critico", label: `🔴 Críticos (${resumoGlobal.clientesCriticos})` },
            {
              key: "contato_pendente",
              label: `⏰ Contato Hoje/Atrasado (${resumoGlobal.contatosAtrasados + resumoGlobal.contatosHoje})`,
            },
            { key: "chip_caido", label: `📵 Chip Desconectado (${resumoGlobal.chipsDesconectados})` },
            { key: "atencao", label: `🟡 Atenção (${resumoGlobal.clientesAtencao})` },
            { key: "saudavel", label: `🟢 Saudáveis (${resumoGlobal.clientesSaudaveis})` },
          ].map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
                statusFilter === f.key
                  ? "bg-purple-600 text-white border-purple-600 shadow-sm"
                  : "bg-background text-foreground/80 border-border hover:bg-muted hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Filtro por Empresa */}
          <div className="flex items-center gap-1.5 bg-background border border-border px-2.5 py-1 rounded-xl">
            <Filter className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
            <Select value={empresaFilter} onValueChange={setEmpresaFilter}>
              <SelectTrigger className="w-[195px] h-7 border-none bg-transparent text-xs font-semibold text-foreground focus:ring-0">
                <SelectValue placeholder="Filtrar por Empresa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">🏢 Todas as empresas ({clientes.length})</SelectItem>
                {clientes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    🏢 {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar empresa, campanha ou demanda..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8 pl-8 text-xs bg-background border-border text-foreground rounded-xl"
            />
          </div>
        </div>
      </div>

      {/* Lista de Clientes na Torre de Controle */}
      <div className="space-y-4">
        {filteredClientes.length === 0 ? (
          <Card className="border-border bg-card p-8 text-center text-muted-foreground">
            Nenhuma empresa encontrada para o filtro selecionado.
          </Card>
        ) : (
          filteredClientes.map((cliente) => {
            const isFormOpen = openContactFormClientId === cliente.id;
            const isHistoryOpen = Boolean(openHistoryClientIds[cliente.id]);
            const isMinimized = Boolean(minimizedClients[cliente.id]);
            const rel = cliente.relacionamento;

            const semaforoBadge =
              cliente.semaforo === "critico"
                ? {
                    label: "🔴 Crítico",
                    cls: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/40 font-semibold",
                  }
                : cliente.semaforo === "atencao"
                ? {
                    label: "🟡 Atenção",
                    cls: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-500/40 font-semibold",
                  }
                : {
                    label: "🟢 Saudável",
                    cls: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40 font-semibold",
                  };

            const futuroBadge =
              rel.futuroContatoStatus === "atrasado"
                ? {
                    label: "ATRASADO",
                    cls: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-500/25 dark:text-rose-200 dark:border-rose-500/40 font-semibold",
                  }
                : rel.futuroContatoStatus === "hoje"
                ? {
                    label: "PARA HOJE",
                    cls: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-500/25 dark:text-amber-200 dark:border-amber-500/40 font-semibold",
                  }
                : rel.futuroContatoStatus === "agendado"
                ? {
                    label: "AGENDADO",
                    cls: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/25 dark:text-emerald-200 dark:border-emerald-500/40 font-semibold",
                  }
                : {
                    label: "SEM DATA FUTURA",
                    cls: "bg-slate-200 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 font-semibold",
                  };

            return (
              <Card
                key={cliente.id}
                className={`border transition-all shadow-sm overflow-hidden ${
                  cliente.semaforo === "critico"
                    ? "border-rose-300 dark:border-rose-500/40 bg-card"
                    : cliente.semaforo === "atencao"
                    ? "border-amber-300 dark:border-amber-500/30 bg-card"
                    : "border-border bg-card"
                }`}
              >
                {/* Cabeçalho do Cliente (com botão de Minimizar / Expandir independente) */}
                <CardHeader className="py-3 px-4 border-b border-border/60 bg-slate-50/70 dark:bg-slate-900/40">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleMinimizeClient(cliente.id)}
                          className="flex items-center gap-1.5 text-left hover:opacity-80 transition-opacity"
                          title={isMinimized ? "Clique para expandir os detalhes desta empresa" : "Clique para minimizar esta empresa"}
                        >
                          {isMinimized ? (
                            <ChevronDown className="h-4 w-4 text-purple-600 dark:text-purple-400 shrink-0" />
                          ) : (
                            <ChevronUp className="h-4 w-4 text-purple-600 dark:text-purple-400 shrink-0" />
                          )}
                          <h2 className="text-lg font-bold text-foreground">{cliente.name}</h2>
                        </button>

                        <span className="font-mono text-xs text-purple-800 bg-purple-100 border-purple-200 dark:text-purple-300 dark:bg-purple-500/15 dark:border-purple-500/30 px-2 py-0.5 rounded-md border">
                          {cliente.id}
                        </span>
                        <Badge variant="outline" className={semaforoBadge.cls}>
                          {semaforoBadge.label}
                        </Badge>
                        {rel.responsavel ? (
                          <Badge
                            variant="outline"
                            className="border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-200 flex items-center gap-1 font-semibold"
                          >
                            <UserCheck className="h-3 w-3" /> Resp: {rel.responsavel}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          >
                            Sem responsável atribuído
                          </Badge>
                        )}

                        {/* Resumo compacto visível quando o card está minimizado */}
                        {isMinimized && (
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground pl-1">
                            <span className="px-2 py-0.5 rounded bg-background border border-border text-foreground font-medium">
                              Chips: {cliente.chips.connected}/{cliente.chips.total} · Hoje:{" "}
                              <strong>
                                {cliente.chips.usedQuotaToday}/{cliente.chips.totalDailyLimit}
                              </strong>{" "}
                              · Total: <strong>{cliente.chips.totalSentAllChips || 0}</strong>
                            </span>
                            <span className="px-2 py-0.5 rounded bg-background border border-border text-foreground font-medium">
                              Fila: <strong>{cliente.campanhas.filaRestante}</strong>
                            </span>
                            <span className="px-2 py-0.5 rounded bg-background border border-border text-foreground font-medium">
                              Futuro Contato: <strong>{formatDateTimeBr(rel.futuroContato)}</strong>
                            </span>
                          </div>
                        )}
                      </div>

                      {!isMinimized && cliente.alertas.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          {cliente.alertas.map((al, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-900 bg-amber-100 border-amber-300 dark:text-amber-200 dark:bg-amber-500/20 dark:border-amber-500/40 border px-2 py-0.5 rounded-md"
                            >
                              <AlertTriangle className="h-3 w-3 text-amber-700 dark:text-amber-400" /> {al}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Botões de Ação Direta do Cliente */}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenContactForm(cliente)}
                        className="h-8 text-xs font-semibold border-cyan-300 bg-cyan-50 text-cyan-900 hover:bg-cyan-100 dark:border-cyan-500/40 dark:bg-cyan-500/15 dark:text-cyan-200 dark:hover:bg-cyan-500/25"
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        {isFormOpen ? "Fechar Registro" : "Registrar Contato / Futuro Contato"}
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        disabled={cobrandoClientId === cliente.id}
                        onClick={() => handleCobrarWandinha(cliente)}
                        className="h-8 text-xs font-semibold border-purple-300 bg-purple-50 text-purple-900 hover:bg-purple-100 dark:border-purple-500/40 dark:bg-purple-500/15 dark:text-purple-200 dark:hover:bg-purple-500/25"
                        title="Envia cobrança no WhatsApp do colaborador responsável via Wandinha"
                      >
                        <Send className="mr-1.5 h-3.5 w-3.5" />
                        {cobrandoClientId === cliente.id ? "Enviando..." : "Cobrar via Wandinha"}
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleImpersonate(cliente.id, cliente.name, "/crm/planilhas")}
                        className="h-8 text-xs border-border bg-background text-foreground hover:bg-accent"
                      >
                        <Eye className="mr-1.5 h-3.5 w-3.5" /> Abrir Campanhas
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleMinimizeClient(cliente.id)}
                        className="h-8 px-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted"
                        title={isMinimized ? "Expandir card desta empresa" : "Minimizar card desta empresa"}
                      >
                        {isMinimized ? (
                          <>
                            <ChevronDown className="mr-1 h-4 w-4" /> Expandir
                          </>
                        ) : (
                          <>
                            <ChevronUp className="mr-1 h-4 w-4" /> Minimizar
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {/* Corpo Expansível da Empresa */}
                {!isMinimized && (
                  <CardContent className="pt-4 space-y-4">
                    {/* Formulário Inline de Novo Contato e Futuro Contato */}
                    {isFormOpen && (
                      <div className="rounded-2xl border border-cyan-300 bg-cyan-50/90 dark:border-cyan-500/40 dark:bg-cyan-950/30 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-900 dark:text-cyan-200 flex items-center gap-1.5">
                            <CalendarClock className="h-4 w-4 text-cyan-700 dark:text-cyan-300" /> Novo Registro de Contato & Agendamento de Futuro Contato
                          </h3>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                              Colaborador Responsável
                            </label>
                            <Select value={formResponsavel} onValueChange={setFormResponsavel}>
                              <SelectTrigger className="h-8 text-xs bg-background border-border text-foreground">
                                <SelectValue placeholder="Selecione o responsável" />
                              </SelectTrigger>
                              <SelectContent>
                                {colaboradores.map((col) => (
                                  <SelectItem key={col.nome} value={col.nome}>
                                    {col.nome}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                              Horário do Contato (Realizado)
                            </label>
                            <Input
                              type="datetime-local"
                              value={formHorarioContato}
                              onChange={(e) => setFormHorarioContato(e.target.value)}
                              className="h-8 text-xs bg-background border-border text-foreground"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-cyan-900 dark:text-cyan-200">
                              Futuro Contato (Próximo Retorno)
                            </label>
                            <Input
                              type="datetime-local"
                              value={formFuturoContato}
                              onChange={(e) => setFormFuturoContato(e.target.value)}
                              className="h-8 text-xs bg-background border-cyan-400 dark:border-cyan-500/50 text-foreground"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                              Assunto do Futuro Contato
                            </label>
                            <Input
                              placeholder="Ex: Cobrar lote 2 / Validar resultados"
                              value={formProximoAssunto}
                              onChange={(e) => setFormProximoAssunto(e.target.value)}
                              className="h-8 text-xs bg-background border-border text-foreground"
                            />
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
                          <div className="flex-1 space-y-1">
                            <label className="text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                              Demanda Passada ao Colaborador / Resumo do Contato
                            </label>
                            <Input
                              placeholder="Descreva o que foi alinhado com o cliente ou a tarefa passada para o colaborador..."
                              value={formResumo}
                              onChange={(e) => setFormResumo(e.target.value)}
                              className="h-8 text-xs bg-background border-border text-foreground"
                            />
                          </div>
                          <Button
                            size="sm"
                            disabled={savingContactClientId === cliente.id}
                            onClick={() => handleSaveContato(cliente.id)}
                            className="h-8 bg-cyan-700 hover:bg-cyan-800 dark:bg-cyan-600 dark:hover:bg-cyan-500 text-white text-xs font-semibold"
                          >
                            {savingContactClientId === cliente.id ? "Salvando..." : "Salvar Contato & Futuro Contato"}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Grid de 3 Colunas por Cliente: 1) Contato & Futuro Contato, 2) Campanhas & Fila, 3) Chips & Limites */}
                    <div className="grid gap-4 lg:grid-cols-3">
                      {/* BLOCO 1: HORÁRIO DO CONTATO & FUTURO CONTATO */}
                      <div className="rounded-xl border border-border bg-slate-50/70 dark:bg-slate-900/40 p-3.5 space-y-3 flex flex-col justify-between">
                        <div className="space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-cyan-800 dark:text-cyan-300 flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5" /> Controle de Contato & Demandas
                            </span>
                            <Badge variant="outline" className={`text-[10px] ${futuroBadge.cls}`}>
                              {futuroBadge.label}
                            </Badge>
                          </div>

                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <div className="rounded-lg bg-card border border-border p-2">
                              <p className="text-[10px] uppercase text-muted-foreground font-semibold">
                                Horário do Contato
                              </p>
                              <p className="text-xs font-bold text-foreground mt-0.5">
                                {formatDateTimeBr(rel.horarioContato)}
                              </p>
                            </div>

                            <div className="rounded-lg bg-cyan-50/70 dark:bg-cyan-950/30 border border-cyan-300 dark:border-cyan-500/40 p-2">
                              <p className="text-[10px] uppercase text-cyan-800 dark:text-cyan-300 font-semibold">
                                Futuro Contato
                              </p>
                              <p className="text-xs font-bold text-cyan-950 dark:text-cyan-100 mt-0.5">
                                {formatDateTimeBr(rel.futuroContato)}
                              </p>
                            </div>
                          </div>

                          <div className="rounded-lg bg-card border border-border p-2.5 space-y-1 text-xs">
                            <p className="text-[10px] uppercase font-semibold text-muted-foreground">
                              Demanda Atual / Observação para Cobrança:
                            </p>
                            <p className="text-foreground font-medium">
                              {rel.demandaAtual || "Nenhuma demanda registrada ainda. Clique em Registrar Contato."}
                            </p>
                            {rel.proximoAssunto && (
                              <p className="text-[11px] text-cyan-800 dark:text-cyan-300 pt-1 font-medium">
                                <strong>Próximo passo:</strong> {rel.proximoAssunto}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Histórico de Contatos que vai sendo criado */}
                        <div className="pt-1 border-t border-border/60">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenHistoryClientIds((prev) => ({ ...prev, [cliente.id]: !prev[cliente.id] }))
                            }
                            className="w-full flex items-center justify-between text-[11px] font-semibold text-foreground/80 hover:text-foreground py-1"
                          >
                            <span className="flex items-center gap-1">
                              <History className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                              Histórico de Contatos Criados ({rel.historicoContatos.length})
                            </span>
                            {isHistoryOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </button>

                          {isHistoryOpen && (
                            <div className="mt-2 space-y-2 max-h-44 overflow-y-auto pr-1">
                              {rel.historicoContatos.length === 0 ? (
                                <p className="text-[11px] text-muted-foreground italic">
                                  Nenhum histórico de contato salvo ainda.
                                </p>
                              ) : (
                                rel.historicoContatos.map((h) => (
                                  <div
                                    key={h.id}
                                    className="rounded-lg bg-card border border-border p-2 text-[11px] space-y-1 shadow-2xs"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-bold text-cyan-800 dark:text-cyan-300">
                                        Contato: {formatDateTimeBr(h.horarioContato)}
                                      </span>
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] font-medium text-muted-foreground">
                                          {h.responsavel}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteContato(cliente.id, h.id)}
                                          className="text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"
                                          title="Excluir registro"
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </button>
                                      </div>
                                    </div>
                                    <p className="text-foreground font-medium">{h.resumo}</p>
                                    {h.futuroContato && (
                                      <p className="text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                                        ➔ Futuro Contato: {formatDateTimeBr(h.futuroContato)}
                                        {h.proximoAssunto ? ` · ${h.proximoAssunto}` : ""}
                                      </p>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* BLOCO 2: CAMPANHAS (DATAS DE INÍCIO E CONCLUSÃO) & FILA DE ENVIOS */}
                      <div className="rounded-xl border border-border bg-slate-50/70 dark:bg-slate-900/40 p-3.5 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wider text-purple-800 dark:text-purple-300 flex items-center gap-1.5">
                            <Megaphone className="h-3.5 w-3.5" /> Campanhas & Fila de Disparos
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            Último disparo:{" "}
                            <strong className="text-foreground">{formatDateTimeBr(cliente.disparos.ultimoDisparoAt)}</strong>
                          </span>
                        </div>

                        {/* Mini-KPIs da Fila */}
                        <div className="grid grid-cols-4 gap-1.5 text-center">
                          <div className="rounded-lg bg-card border border-border p-1.5">
                            <p className="text-[10px] text-muted-foreground font-medium">Total Leads</p>
                            <p className="text-xs font-bold text-foreground">{cliente.campanhas.totalLeads}</p>
                          </div>
                          <div className="rounded-lg bg-card border border-border p-1.5">
                            <p className="text-[10px] text-muted-foreground font-medium">Enviados</p>
                            <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                              {cliente.campanhas.enviadosTotal}
                            </p>
                          </div>
                          <div className="rounded-lg bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-300 dark:border-indigo-500/40 p-1.5">
                            <p className="text-[10px] text-indigo-800 dark:text-indigo-300 font-semibold">Na Fila</p>
                            <p className="text-xs font-bold text-indigo-900 dark:text-indigo-200">
                              {cliente.campanhas.filaRestante}
                            </p>
                          </div>
                          <div className="rounded-lg bg-card border border-border p-1.5">
                            <p className="text-[10px] text-muted-foreground font-medium">Hoje (24h)</p>
                            <p className="text-xs font-bold text-cyan-700 dark:text-cyan-300">
                              {cliente.disparos.enviadosHoje}
                            </p>
                          </div>
                        </div>

                        {/* Lista de Campanhas com Início e Conclusão */}
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                          {cliente.campanhas.items.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic py-2">
                              Nenhuma campanha cadastrada para este cliente.
                            </p>
                          ) : (
                            cliente.campanhas.items.map((camp) => {
                              const st = formatCampaignStatusBadge(camp.status);
                              return (
                                <div
                                  key={camp.id}
                                  className="rounded-lg bg-card border border-border p-2.5 text-xs space-y-1.5 shadow-2xs"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-semibold text-foreground truncate">{camp.name}</span>
                                    <Badge variant="outline" className={`text-[10px] shrink-0 ${st.cls}`}>
                                      {st.label}
                                    </Badge>
                                  </div>

                                  <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                                    <span>
                                      🚀 <strong className="text-foreground">Início:</strong>{" "}
                                      {formatDateBr(camp.startsAt)}
                                    </span>
                                    <span>
                                      🏁 <strong className="text-foreground">Conclusão:</strong>{" "}
                                      {camp.completedAt
                                        ? formatDateBr(camp.completedAt)
                                        : camp.estimatedEndAt
                                        ? `Prev. ${formatDateBr(camp.estimatedEndAt)}`
                                        : "—"}
                                    </span>
                                  </div>

                                  <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border/60">
                                    <span className="text-foreground">
                                      Enviados: <strong>{camp.sentCount}</strong>/{camp.totalLeads}
                                    </span>
                                    <span className="text-indigo-700 dark:text-indigo-300 font-semibold">
                                      Fila: {camp.remainingInQueue}
                                    </span>
                                    {camp.failedCount > 0 && (
                                      <span className="text-rose-700 dark:text-rose-400 font-semibold">
                                        Falhas: {camp.failedCount}
                                      </span>
                                    )}
                                  </div>

                                  {camp.pauseReason && (
                                    <p className="text-[10px] font-medium text-amber-900 bg-amber-100 dark:text-amber-200 dark:bg-amber-500/20 px-2 py-0.5 rounded truncate">
                                      ⚠️ {camp.pauseReason}
                                    </p>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>

                      {/* BLOCO 3: CHIPS WHATSAPP, DISPARO DO DIA, DISPARO TOTAL & BALANCEAMENTO */}
                      <div className="rounded-xl border border-border bg-slate-50/70 dark:bg-slate-900/40 p-3.5 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                            <Wifi className="h-3.5 w-3.5" /> Chips & Balanceamento
                          </span>

                          {/* Seletor: Disparo do Dia vs Disparo Total & Balanceamento */}
                          <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-[10px] font-semibold">
                            <button
                              type="button"
                              onClick={() => setChipViewMode("hoje")}
                              className={`px-2 py-0.5 rounded-md transition-colors ${
                                chipViewMode === "hoje"
                                  ? "bg-emerald-600 text-white"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              Hoje ({cliente.chips.usedQuotaToday}/{cliente.chips.totalDailyLimit})
                            </button>
                            <button
                              type="button"
                              onClick={() => setChipViewMode("total")}
                              className={`px-2 py-0.5 rounded-md transition-colors ${
                                chipViewMode === "total"
                                  ? "bg-purple-600 text-white"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              Total ({cliente.chips.totalSentAllChips || 0}) & Balanceamento
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                          {cliente.chips.items.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic py-2">
                              Nenhum chip vinculado a esta empresa.
                            </p>
                          ) : (
                            cliente.chips.items.map((chip) => {
                              const pctQuotaDia =
                                chip.dailyLimit > 0
                                  ? Math.min(100, Math.round((chip.usedToday / chip.dailyLimit) * 100))
                                  : 0;
                              const balancePct =
                                chipViewMode === "hoje"
                                  ? chip.balancePercentToday || 0
                                  : chip.balancePercentTotal || 0;
                              const barPct = chipViewMode === "hoje" ? pctQuotaDia : balancePct;

                              return (
                                <div
                                  key={chip.id}
                                  className="rounded-lg bg-card border border-border p-2.5 text-xs space-y-1.5 shadow-2xs"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 truncate">
                                      {chip.connected ? (
                                        <Wifi className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                      ) : (
                                        <WifiOff className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
                                      )}
                                      <span className="font-semibold text-foreground truncate">{chip.name}</span>
                                    </div>
                                    <Badge
                                      variant="outline"
                                      className={`text-[10px] shrink-0 font-semibold ${
                                        chip.connected
                                          ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/40"
                                          : "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/40"
                                      }`}
                                    >
                                      {chip.connected ? "Conectado" : "Desconectado"}
                                    </Badge>
                                  </div>

                                  <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-muted-foreground">
                                    <span>
                                      Hoje:{" "}
                                      <strong className="text-foreground">
                                        {chip.usedToday} / {chip.dailyLimit}
                                      </strong>{" "}
                                      msgs
                                    </span>
                                    <span>
                                      Total:{" "}
                                      <strong className="text-purple-700 dark:text-purple-300">
                                        {chip.totalSent || 0}
                                      </strong>{" "}
                                      msgs
                                    </span>
                                    <span className="inline-flex items-center gap-0.5 text-indigo-700 dark:text-indigo-300 font-semibold">
                                      <Scale className="h-3 w-3" /> {balancePct}% carga
                                    </span>
                                  </div>

                                  {/* Barra Visual (Modo Claro com fundo suave slate-200, Modo Escuro slate-800) */}
                                  <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${
                                        chipViewMode === "total"
                                          ? "bg-purple-600 dark:bg-purple-500"
                                          : pctQuotaDia >= 90
                                          ? "bg-amber-500"
                                          : chip.connected
                                          ? "bg-emerald-600 dark:bg-emerald-500"
                                          : "bg-rose-600 dark:bg-rose-500"
                                      }`}
                                      style={{ width: `${barPct}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
