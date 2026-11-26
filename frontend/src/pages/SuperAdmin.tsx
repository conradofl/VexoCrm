import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2,
  Crown,
  Wifi,
  WifiOff,
  Zap,
  CheckCircle2,
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
  ShieldCheck,
  Lock,
  Unlock,
  Megaphone,
  History,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  dailyLimit: number;
  isDefault: boolean;
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
    return { label: "Ativa", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
  }
  if (["scheduled", "agendada"].includes(s)) {
    return { label: "Agendada", cls: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30" };
  }
  if (["paused", "pausada", "interrupted", "interrompido"].includes(s)) {
    return { label: "Pausada", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" };
  }
  if (["done", "completed", "concluida", "enviada"].includes(s)) {
    return { label: "Concluída", cls: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30" };
  }
  if (["failed", "falhou"].includes(s)) {
    return { label: "Falhou", cls: "bg-rose-500/15 text-rose-300 border-rose-500/30" };
  }
  return { label: "Rascunho", cls: "bg-slate-500/15 text-slate-300 border-slate-500/30" };
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

  // Filtros da Torre
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [responsavelFilter, setResponsavelFilter] = useState<string>("all");

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
      const matchesSearch =
        !searchTerm.trim() ||
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.relacionamento.responsavel.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.relacionamento.demandaAtual.toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchesSearch) return false;

      if (responsavelFilter !== "all") {
        if (responsavelFilter === "sem_responsavel") {
          if (c.relacionamento.responsavel) return false;
        } else if (c.relacionamento.responsavel.toLowerCase() !== responsavelFilter.toLowerCase()) {
          return false;
        }
      }

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
  }, [clientes, searchTerm, statusFilter, responsavelFilter]);

  return (
    <div className="min-h-screen space-y-6 bg-background p-4 md:p-6 text-foreground">
      {/* Cabeçalho da Torre de Controle */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-border pb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-cyan-500 shadow-lg shadow-purple-500/25 text-white">
            <Crown className="h-6 w-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Torre de Controle de Clientes · Vexo OS
              </h1>
              <Badge
                variant="outline"
                className="bg-purple-500/10 text-purple-600 dark:text-purple-300 border-purple-500/30"
              >
                Visão Geral Multi-Empresas
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Controle de campanhas (início e conclusão), fila de disparos, chips e limites, horário do contato e futuro contato para cobrança da equipe.
            </p>
          </div>
        </div>

        {/* Controles Superiores: Liberar GD + Atualizar */}
        <div className="flex flex-wrap items-center gap-3">
          {isSuperAdmin && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={togglingGdAccess}
              onClick={handleToggleGdAccess}
              className={
                gdAccessEnabled
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/20"
                  : "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300 hover:bg-rose-500/20"
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
          className="cursor-pointer border-border bg-card hover:border-purple-500/40 transition-all shadow-sm"
        >
          <CardHeader className="flex flex-row items-center justify-between pb-1.5">
            <CardTitle className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Empresas na Torre
            </CardTitle>
            <Building2 className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{resumoGlobal.totalClientes}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              🟢 {resumoGlobal.clientesSaudaveis} ok · 🟡 {resumoGlobal.clientesAtencao} atenção · 🔴{" "}
              {resumoGlobal.clientesCriticos} críticos
            </p>
          </CardContent>
        </Card>

        <Card
          onClick={() => setStatusFilter(statusFilter === "contato_pendente" ? "all" : "contato_pendente")}
          className="cursor-pointer border-border bg-card hover:border-amber-500/40 transition-all shadow-sm"
        >
          <CardHeader className="flex flex-row items-center justify-between pb-1.5">
            <CardTitle className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Futuro Contato (Hoje / Atraso)
            </CardTitle>
            <CalendarClock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {resumoGlobal.contatosAtrasados + resumoGlobal.contatosHoje}
            </div>
            <p className="mt-1 text-xs text-rose-500 dark:text-rose-400 font-medium">
              {resumoGlobal.contatosAtrasados} atrasados · {resumoGlobal.contatosHoje} para hoje
            </p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1.5">
            <CardTitle className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Fila de Envios Pendente
            </CardTitle>
            <Megaphone className="h-4 w-4 text-indigo-500" />
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
            <Zap className="h-4 w-4 text-cyan-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{resumoGlobal.totalDisparosHoje}</div>
            <p className="mt-1 text-xs text-muted-foreground">Volume enviado hoje em todos os clientes</p>
          </CardContent>
        </Card>

        <Card
          onClick={() => setStatusFilter(statusFilter === "chip_caido" ? "all" : "chip_caido")}
          className="cursor-pointer border-border bg-card hover:border-emerald-500/40 transition-all shadow-sm"
        >
          <CardHeader className="flex flex-row items-center justify-between pb-1.5">
            <CardTitle className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Saúde dos Chips
            </CardTitle>
            <Wifi className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">
              {resumoGlobal.chipsConectados}{" "}
              <span className="text-sm font-normal text-muted-foreground">conectados</span>
            </div>
            <p className="mt-1 text-xs text-rose-500 dark:text-rose-400">
              {resumoGlobal.chipsDesconectados > 0
                ? `⚠️ ${resumoGlobal.chipsDesconectados} chip(s) desconectado(s)`
                : "✅ Todos os chips ativos online"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Barra de Filtros e Busca */}
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
                  ? "bg-purple-600 text-white border-purple-500 shadow-sm"
                  : "bg-background text-muted-foreground border-border hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-background border border-border px-2.5 py-1 rounded-xl">
            <Filter className="h-3.5 w-3.5 text-purple-500" />
            <Select value={responsavelFilter} onValueChange={setResponsavelFilter}>
              <SelectTrigger className="w-[165px] h-7 border-none bg-transparent text-xs font-medium focus:ring-0">
                <SelectValue placeholder="Colaborador" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">👤 Todos os colaboradores</SelectItem>
                <SelectItem value="sem_responsavel">⚠️ Sem responsável definido</SelectItem>
                {colaboradores.map((col) => (
                  <SelectItem key={col.nome} value={col.nome}>
                    {col.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente, campanha ou demanda..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8 pl-8 text-xs bg-background border-border rounded-xl"
            />
          </div>
        </div>
      </div>

      {/* Lista de Clientes na Torre de Controle */}
      <div className="space-y-4">
        {filteredClientes.length === 0 ? (
          <Card className="border-border bg-card p-8 text-center text-muted-foreground">
            Nenhum cliente encontrado para o filtro selecionado.
          </Card>
        ) : (
          filteredClientes.map((cliente) => {
            const isFormOpen = openContactFormClientId === cliente.id;
            const isHistoryOpen = Boolean(openHistoryClientIds[cliente.id]);
            const rel = cliente.relacionamento;

            const semaforoBadge =
              cliente.semaforo === "critico"
                ? { label: "🔴 Crítico", cls: "bg-rose-500/15 text-rose-400 border-rose-500/40" }
                : cliente.semaforo === "atencao"
                ? { label: "🟡 Atenção", cls: "bg-amber-500/15 text-amber-300 border-amber-500/40" }
                : { label: "🟢 Saudável", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40" };

            const futuroBadge =
              rel.futuroContatoStatus === "atrasado"
                ? { label: "ATRASADO", cls: "bg-rose-500/20 text-rose-300 border-rose-500/40" }
                : rel.futuroContatoStatus === "hoje"
                ? { label: "PARA HOJE", cls: "bg-amber-500/20 text-amber-300 border-amber-500/40" }
                : rel.futuroContatoStatus === "agendado"
                ? { label: "AGENDADO", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" }
                : { label: "SEM DATA FUTURA", cls: "bg-slate-500/20 text-slate-300 border-slate-500/40" };

            return (
              <Card
                key={cliente.id}
                className={`border transition-all shadow-sm overflow-hidden ${
                  cliente.semaforo === "critico"
                    ? "border-rose-500/40 bg-card"
                    : cliente.semaforo === "atencao"
                    ? "border-amber-500/30 bg-card"
                    : "border-border bg-card"
                }`}
              >
                {/* Cabeçalho do Cliente */}
                <CardHeader className="pb-3 border-b border-border/60 bg-muted/20">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-bold text-foreground">{cliente.name}</h2>
                        <span className="font-mono text-xs text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-md border border-purple-500/20">
                          {cliente.id}
                        </span>
                        <Badge variant="outline" className={semaforoBadge.cls}>
                          {semaforoBadge.label}
                        </Badge>
                        {rel.responsavel ? (
                          <Badge
                            variant="outline"
                            className="border-indigo-500/30 bg-indigo-500/10 text-indigo-300 flex items-center gap-1"
                          >
                            <UserCheck className="h-3 w-3" /> Resp: {rel.responsavel}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-slate-500/30 bg-slate-500/10 text-slate-400">
                            Sem responsável atribuído
                          </Badge>
                        )}
                      </div>

                      {cliente.alertas.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          {cliente.alertas.map((al, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 bg-amber-500/10 border border-amber-500/25 px-2 py-0.5 rounded-md"
                            >
                              <AlertTriangle className="h-3 w-3 text-amber-400" /> {al}
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
                        className="h-8 text-xs border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20"
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        {isFormOpen ? "Fechar Registro" : "Registrar Contato / Futuro Contato"}
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        disabled={cobrandoClientId === cliente.id}
                        onClick={() => handleCobrarWandinha(cliente)}
                        className="h-8 text-xs border-purple-500/40 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20"
                        title="Envia cobrança no WhatsApp do colaborador responsável via Wandinha"
                      >
                        <Send className="mr-1.5 h-3.5 w-3.5" />
                        {cobrandoClientId === cliente.id ? "Enviando..." : "Cobrar via Wandinha"}
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleImpersonate(cliente.id, cliente.name, "/crm/planilhas")}
                        className="h-8 text-xs border-border bg-background hover:bg-accent"
                      >
                        <Eye className="mr-1.5 h-3.5 w-3.5" /> Abrir Campanhas
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="pt-4 space-y-4">
                  {/* Formulário Inline de Novo Contato e Futuro Contato */}
                  {isFormOpen && (
                    <div className="rounded-2xl border border-cyan-500/40 bg-cyan-950/20 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                          <CalendarClock className="h-4 w-4" /> Novo Registro de Contato & Agendamento de Futuro Contato
                        </h3>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-slate-300">
                            Colaborador Responsável
                          </label>
                          <Select value={formResponsavel} onValueChange={setFormResponsavel}>
                            <SelectTrigger className="h-8 text-xs bg-background border-border">
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
                          <label className="text-[11px] font-semibold text-slate-300">
                            Horário do Contato (Realizado)
                          </label>
                          <Input
                            type="datetime-local"
                            value={formHorarioContato}
                            onChange={(e) => setFormHorarioContato(e.target.value)}
                            className="h-8 text-xs bg-background border-border"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-cyan-300">
                            Futuro Contato (Próximo Retorno)
                          </label>
                          <Input
                            type="datetime-local"
                            value={formFuturoContato}
                            onChange={(e) => setFormFuturoContato(e.target.value)}
                            className="h-8 text-xs bg-background border-cyan-500/40"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-slate-300">
                            Assunto do Futuro Contato
                          </label>
                          <Input
                            placeholder="Ex: Cobrar lote 2 / Validar resultados"
                            value={formProximoAssunto}
                            onChange={(e) => setFormProximoAssunto(e.target.value)}
                            className="h-8 text-xs bg-background border-border"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
                        <div className="flex-1 space-y-1">
                          <label className="text-[11px] font-semibold text-slate-300">
                            Demanda Passada ao Colaborador / Resumo do Contato
                          </label>
                          <Input
                            placeholder="Descreva o que foi alinhado com o cliente ou a tarefa passada para o colaborador..."
                            value={formResumo}
                            onChange={(e) => setFormResumo(e.target.value)}
                            className="h-8 text-xs bg-background border-border"
                          />
                        </div>
                        <Button
                          size="sm"
                          disabled={savingContactClientId === cliente.id}
                          onClick={() => handleSaveContato(cliente.id)}
                          className="h-8 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold"
                        >
                          {savingContactClientId === cliente.id ? "Salvando..." : "Salvar Contato & Futuro Contato"}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Grid de 3 Colunas por Cliente: 1) Contato & Futuro Contato, 2) Campanhas & Fila, 3) Chips & Limites */}
                  <div className="grid gap-4 lg:grid-cols-3">
                    {/* BLOCO 1: HORÁRIO DO CONTATO & FUTURO CONTATO */}
                    <div className="rounded-xl border border-border bg-muted/15 p-3.5 space-y-3 flex flex-col justify-between">
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5" /> Controle de Contato & Demandas
                          </span>
                          <Badge variant="outline" className={`text-[10px] ${futuroBadge.cls}`}>
                            {futuroBadge.label}
                          </Badge>
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <div className="rounded-lg bg-background/70 border border-border/70 p-2">
                            <p className="text-[10px] uppercase text-muted-foreground font-semibold">
                              Horário do Contato
                            </p>
                            <p className="text-xs font-bold text-foreground mt-0.5">
                              {formatDateTimeBr(rel.horarioContato)}
                            </p>
                          </div>

                          <div className="rounded-lg bg-background/70 border border-cyan-500/30 p-2">
                            <p className="text-[10px] uppercase text-cyan-300 font-semibold">
                              Futuro Contato
                            </p>
                            <p className="text-xs font-bold text-cyan-200 mt-0.5">
                              {formatDateTimeBr(rel.futuroContato)}
                            </p>
                          </div>
                        </div>

                        <div className="rounded-lg bg-background/60 border border-border/60 p-2.5 space-y-1 text-xs">
                          <p className="text-[10px] uppercase font-semibold text-muted-foreground">
                            Demanda Atual / Observação para Cobrança:
                          </p>
                          <p className="text-foreground font-medium">
                            {rel.demandaAtual || "Nenhuma demanda registrada ainda. Clique em Registrar Contato."}
                          </p>
                          {rel.proximoAssunto && (
                            <p className="text-[11px] text-cyan-300 pt-1">
                              <strong>Próximo passo:</strong> {rel.proximoAssunto}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Histórico de Contatos que vai sendo criado */}
                      <div className="pt-1 border-t border-border/50">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenHistoryClientIds((prev) => ({ ...prev, [cliente.id]: !prev[cliente.id] }))
                          }
                          className="w-full flex items-center justify-between text-[11px] font-semibold text-muted-foreground hover:text-foreground py-1"
                        >
                          <span className="flex items-center gap-1">
                            <History className="h-3.5 w-3.5 text-purple-400" />
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
                                  className="rounded-lg bg-background/80 border border-border/70 p-2 text-[11px] space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-semibold text-cyan-300">
                                      Contato: {formatDateTimeBr(h.horarioContato)}
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[10px] text-muted-foreground">{h.responsavel}</span>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteContato(cliente.id, h.id)}
                                        className="text-slate-400 hover:text-rose-400"
                                        title="Excluir registro"
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </button>
                                    </div>
                                  </div>
                                  <p className="text-foreground">{h.resumo}</p>
                                  {h.futuroContato && (
                                    <p className="text-[10px] text-amber-300">
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
                    <div className="rounded-xl border border-border bg-muted/15 p-3.5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
                          <Megaphone className="h-3.5 w-3.5" /> Campanhas & Fila de Disparos
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          Último disparo: <strong>{formatDateTimeBr(cliente.disparos.ultimoDisparoAt)}</strong>
                        </span>
                      </div>

                      {/* Mini-KPIs da Fila */}
                      <div className="grid grid-cols-4 gap-1.5 text-center">
                        <div className="rounded-lg bg-background/70 border border-border/70 p-1.5">
                          <p className="text-[10px] text-muted-foreground">Total Leads</p>
                          <p className="text-xs font-bold text-foreground">{cliente.campanhas.totalLeads}</p>
                        </div>
                        <div className="rounded-lg bg-background/70 border border-border/70 p-1.5">
                          <p className="text-[10px] text-muted-foreground">Enviados</p>
                          <p className="text-xs font-bold text-emerald-400">{cliente.campanhas.enviadosTotal}</p>
                        </div>
                        <div className="rounded-lg bg-background/70 border border-indigo-500/30 p-1.5">
                          <p className="text-[10px] text-indigo-300 font-semibold">Na Fila</p>
                          <p className="text-xs font-bold text-indigo-300">{cliente.campanhas.filaRestante}</p>
                        </div>
                        <div className="rounded-lg bg-background/70 border border-border/70 p-1.5">
                          <p className="text-[10px] text-muted-foreground">Hoje (24h)</p>
                          <p className="text-xs font-bold text-cyan-300">{cliente.disparos.enviadosHoje}</p>
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
                                className="rounded-lg bg-background/80 border border-border/70 p-2.5 text-xs space-y-1.5"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-foreground truncate">{camp.name}</span>
                                  <Badge variant="outline" className={`text-[10px] shrink-0 ${st.cls}`}>
                                    {st.label}
                                  </Badge>
                                </div>

                                <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                                  <span>
                                    🚀 <strong>Início:</strong> {formatDateBr(camp.startsAt)}
                                  </span>
                                  <span>
                                    🏁 <strong>Conclusão:</strong>{" "}
                                    {camp.completedAt
                                      ? formatDateBr(camp.completedAt)
                                      : camp.estimatedEndAt
                                      ? `Prev. ${formatDateBr(camp.estimatedEndAt)}`
                                      : "—"}
                                  </span>
                                </div>

                                <div className="flex items-center justify-between text-[11px] pt-0.5 border-t border-border/40">
                                  <span>
                                    Enviados: <strong>{camp.sentCount}</strong>/{camp.totalLeads}
                                  </span>
                                  <span className="text-indigo-300 font-semibold">
                                    Fila: {camp.remainingInQueue}
                                  </span>
                                  {camp.failedCount > 0 && (
                                    <span className="text-rose-400">Falhas: {camp.failedCount}</span>
                                  )}
                                </div>

                                {camp.pauseReason && (
                                  <p className="text-[10px] text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded truncate">
                                    ⚠️ {camp.pauseReason}
                                  </p>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* BLOCO 3: CHIPS WHATSAPP & LIMITE DO CHIP */}
                    <div className="rounded-xl border border-border bg-muted/15 p-3.5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                          <Wifi className="h-3.5 w-3.5" /> Chips & Limite Diário
                        </span>
                        <span className="text-[11px] font-semibold text-foreground">
                          Cota Hoje: {cliente.chips.usedQuotaToday} / {cliente.chips.totalDailyLimit} msgs
                        </span>
                      </div>

                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {cliente.chips.items.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic py-2">
                            Nenhum chip vinculado a esta empresa.
                          </p>
                        ) : (
                          cliente.chips.items.map((chip) => {
                            const pct =
                              chip.dailyLimit > 0
                                ? Math.min(100, Math.round((chip.usedToday / chip.dailyLimit) * 100))
                                : 0;
                            return (
                              <div
                                key={chip.id}
                                className="rounded-lg bg-background/80 border border-border/70 p-2.5 text-xs space-y-1.5"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5 truncate">
                                    {chip.connected ? (
                                      <Wifi className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                    ) : (
                                      <WifiOff className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                                    )}
                                    <span className="font-semibold text-foreground truncate">{chip.name}</span>
                                  </div>
                                  <Badge
                                    variant="outline"
                                    className={`text-[10px] shrink-0 ${
                                      chip.connected
                                        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                        : "bg-rose-500/15 text-rose-400 border-rose-500/30"
                                    }`}
                                  >
                                    {chip.connected ? "Conectado" : "Desconectado"}
                                  </Badge>
                                </div>

                                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                  <span className="font-mono">{chip.phone || "Sem número"}</span>
                                  <span>
                                    Limite:{" "}
                                    <strong className="text-foreground">
                                      {chip.usedToday} / {chip.dailyLimit}
                                    </strong>{" "}
                                    msgs/dia
                                  </span>
                                </div>

                                {/* Barra de Progresso do Limite do Chip */}
                                <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      pct >= 90
                                        ? "bg-amber-400"
                                        : chip.connected
                                        ? "bg-emerald-500"
                                        : "bg-rose-500"
                                    }`}
                                    style={{ width: `${pct}%` }}
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
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
