import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  RefreshCw,
  Phone,
  Clock,
  CheckCircle2,
  MessageCircle,
  AlertCircle,
  HourglassIcon,
  Zap,
  ExternalLink,
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/contexts/AuthContext";
import { useCrmClient } from "@/hooks/useCrmClient";
import { fetchApi, readApiJson, readApiErrorMessage } from "@/lib/api";
import { toast } from "sonner";

const SPIN_STEP_LABELS: Record<string, string> = {
  situation_interest: "Interesse",
  situation_objective: "Objetivo",
  situation_state: "Estado",
  situation_city: "Cidade",
  problem_credit: "Crédito",
  implication_parcels: "Parcelas",
  implication_timeline: "Prazo",
  implication_fgts: "FGTS",
  necessity_best_time: "Horário",
};

const SPIN_STEP_ORDER = Object.keys(SPIN_STEP_LABELS);

interface ChatbotLead {
  id: string;
  telefone: string;
  nome: string | null;
  statusConversa: string;
  finalizado: boolean;
  currentStepId: string | null;
  collectedData: Record<string, string | null>;
  mensagem: string | null;
  leadTemperature: string | null;
  leadScore: number | null;
  leadOrigin: string | null;
  sourceCampaignId: string | null;
  sourceCampaignName: string | null;
  leadSource: string | null;
  createdAt: string;
  updatedAt: string;
}

// Campos exibidos no briefing do SDR (na ordem de prioridade)
const BRIEFING_FIELDS: Array<{ key: string; label: string }> = [
  { key: "interesse",          label: "Interesse" },
  { key: "objetivo",           label: "Objetivo" },
  { key: "cidade",             label: "Cidade" },
  { key: "estado",             label: "Estado" },
  { key: "credito_faixa",      label: "Crédito" },
  { key: "credito",            label: "Crédito" },
  { key: "parcela",            label: "Parcela" },
  { key: "prazo",              label: "Prazo" },
  { key: "lance_entrada_fgts", label: "FGTS/Lance" },
  { key: "melhor_horario",     label: "Horário" },
  { key: "tipo",               label: "Tipo" },
  { key: "conta_luz_faixa",    label: "Conta de luz" },
  { key: "tipo_instalacao",    label: "Instalação" },
];

function BriefingPanel({ data }: { data: Record<string, string | null> }) {
  const seen = new Set<string>();
  const rows: Array<{ label: string; value: string }> = [];

  for (const { key, label } of BRIEFING_FIELDS) {
    if (seen.has(label)) continue;
    const value = data[key];
    if (!value) continue;
    seen.add(label);
    rows.push({ label, value });
  }

  if (rows.length === 0) return null;

  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 dark:border-emerald-800/40 dark:bg-emerald-900/10 px-2.5 py-2 space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400 mb-1">
        Briefing SDR
      </p>
      {rows.map(({ label, value }) => (
        <div key={label} className="flex items-baseline gap-1 text-xs">
          <span className="text-slate-500 dark:text-slate-400 shrink-0">{label}:</span>
          <span className="font-medium text-slate-700 dark:text-slate-200 truncate">{value}</span>
        </div>
      ))}
    </div>
  );
}

const LEAD_SOURCE_LABELS: Record<string, { label: string; className: string }> = {
  campanha:      { label: "Campanha",      className: "border-indigo-500/30 bg-indigo-500/15 text-indigo-400" },
  organico:      { label: "Orgânico",      className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-400" },
  trafego_pago:  { label: "Tráfego Pago",  className: "border-amber-500/30 bg-amber-500/15 text-amber-400" },
  whatsapp_ads:  { label: "WhatsApp Ads",  className: "border-green-500/30 bg-green-500/15 text-green-400" },
  indicacao:     { label: "Indicação",     className: "border-purple-500/30 bg-purple-500/15 text-purple-400" },
  outro:         { label: "Outro",         className: "border-slate-500/20 bg-slate-500/10 text-slate-400" },
};

function OriginBadge({ lead }: { lead: ChatbotLead }) {
  if (lead.sourceCampaignName) {
    return (
      <span className="inline-flex items-center rounded-full border border-indigo-500/30 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold text-indigo-400 truncate max-w-full">
        {lead.sourceCampaignName}
      </span>
    );
  }

  if (lead.leadSource && LEAD_SOURCE_LABELS[lead.leadSource]) {
    const { label, className } = LEAD_SOURCE_LABELS[lead.leadSource];
    return (
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${className}`}>
        {label}
      </span>
    );
  }

  if (lead.leadOrigin === "inbound") {
    return (
      <span className="inline-flex items-center rounded-full border border-slate-500/20 bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
        Inbound
      </span>
    );
  }

  return null;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `${"*".repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`;
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min atrás`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h atrás`;
  return `${Math.floor(hours / 24)}d atrás`;
}

function stepProgress(stepId: string | null): number {
  if (!stepId) return 0;
  const idx = SPIN_STEP_ORDER.indexOf(stepId);
  if (idx < 0) return 0;
  return Math.round(((idx + 1) / SPIN_STEP_ORDER.length) * 100);
}

function LeadCard({
  lead,
  onOpenConversation,
}: {
  lead: ChatbotLead;
  onOpenConversation: (phone: string) => void;
}) {
  const stepLabel = lead.currentStepId ? (SPIN_STEP_LABELS[lead.currentStepId] || lead.currentStepId) : null;
  const progress = stepProgress(lead.currentStepId);
  const fieldsCount = Object.keys(lead.collectedData).length;

  return (
    <div
      className="group rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-slate-900 space-y-2 cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors"
      onClick={() => onOpenConversation(lead.telefone)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="text-sm font-mono font-medium text-slate-700 dark:text-slate-200 truncate">
            {lead.nome || maskPhone(lead.telefone)}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {lead.leadTemperature && (
            <Badge variant="outline" className="text-xs">{lead.leadTemperature}</Badge>
          )}
          <ExternalLink className="h-3 w-3 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>

      {stepLabel && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Etapa: <span className="font-medium text-slate-700 dark:text-slate-300">{stepLabel}</span></span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-700">
            <div
              className="h-1.5 rounded-full bg-indigo-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <OriginBadge lead={lead} />

      {lead.finalizado ? (
        <BriefingPanel data={lead.collectedData} />
      ) : lead.mensagem ? (
        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 italic">
          "{lead.mensagem}"
        </p>
      ) : null}

      <div className="flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
        <span>{fieldsCount} campo{fieldsCount !== 1 ? "s" : ""} coletado{fieldsCount !== 1 ? "s" : ""}</span>
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          <span>{timeAgo(lead.updatedAt)}</span>
        </div>
      </div>
    </div>
  );
}

function KanbanColumn({
  title,
  icon,
  leads,
  accentClass,
  onOpenConversation,
}: {
  title: string;
  icon: React.ReactNode;
  leads: ChatbotLead[];
  accentClass: string;
  onOpenConversation: (phone: string) => void;
}) {
  return (
    <div className="flex min-w-[280px] max-w-sm flex-1 flex-col rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-slate-800/40">
      <div className={`flex items-center justify-between rounded-t-xl px-4 py-3 ${accentClass}`}>
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <Badge variant="secondary" className="text-xs">{leads.length}</Badge>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3 max-h-[calc(100vh-260px)]">
        {leads.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-400 dark:text-slate-500">Nenhum lead</p>
        ) : (
          leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onOpenConversation={onOpenConversation} />
          ))
        )}
      </div>
    </div>
  );
}

export default function ChatbotKanban() {
  const navigate = useNavigate();
  const { getIdToken, canAccessInternalPage } = useAuth();
  const { selectedClientId } = useCrmClient();
  const [leads, setLeads] = useState<ChatbotLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const canAccess = canAccessInternalPage("agente");

  const fetchLeads = useCallback(async () => {
    if (!canAccess || !selectedClientId) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetchApi(
        `/api/hardcoded-chat-leads?clientId=${encodeURIComponent(selectedClientId)}&limit=200`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao carregar leads"));
      const data = await readApiJson<{ leads?: ChatbotLead[] }>(res, "chatbot-leads");
      setLeads(data.leads || []);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar leads");
    } finally {
      setLoading(false);
    }
  }, [canAccess, getIdToken, selectedClientId]);

  const handleSync = useCallback(async () => {
    if (!selectedClientId) return;
    setSyncing(true);
    try {
      const token = await getIdToken();
      if (!token) return;
      const res = await fetchApi("/api/leads/hydrate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clientId: selectedClientId }),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Erro ao sincronizar"));
      const data = await readApiJson<{ created: number; updated: number; skipped: number }>(res, "hydrate");
      toast.success(`Sincronizado: ${data.created} criados, ${data.updated} atualizados`);
      fetchLeads();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao sincronizar leads");
    } finally {
      setSyncing(false);
    }
  }, [selectedClientId, getIdToken, fetchLeads]);

  const handleOpenConversation = useCallback((phone: string) => {
    const digits = phone.replace(/\D/g, "");
    navigate(`/crm/whatsapp?phone=${encodeURIComponent(digits)}`);
  }, [navigate]);

  useEffect(() => {
    fetchLeads();
    const interval = setInterval(fetchLeads, 30000);
    return () => clearInterval(interval);
  }, [fetchLeads]);

  const aguardando   = useMemo(() => leads.filter((l) => l.statusConversa === "aguardando_usuario"), [leads]);
  const emAtendimento = useMemo(() => leads.filter((l) => l.statusConversa === "em_atendimento"), [leads]);
  const finalizados  = useMemo(() => leads.filter((l) => l.statusConversa === "finalizado"), [leads]);

  const headerRight = (
    <div className="flex items-center gap-2">
      {lastUpdated && (
        <span className="text-xs text-slate-400 dark:text-slate-500">
          Atualizado {timeAgo(lastUpdated.toISOString())}
        </span>
      )}
      <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing || loading} className="gap-1.5">
        <Zap className={`h-3.5 w-3.5 ${syncing ? "animate-pulse text-amber-500" : ""}`} />
        {syncing ? "Sincronizando..." : "Sincronizar leads"}
      </Button>
      <Button variant="outline" size="sm" onClick={fetchLeads} disabled={loading} className="gap-1.5">
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        Atualizar
      </Button>
    </div>
  );

  if (!canAccess) {
    return (
      <PageShell title="Chatbot Kanban" subtitle="Acesso restrito">
        <EmptyState title="Sem permissão" description="Você não tem acesso a esta página." />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Chatbot Kanban"
      subtitle="Leads em atendimento via chatbot SPIN — clique no card para abrir a conversa"
      headerRight={headerRight}
      spacing="space-y-4"
    >
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4">
        <KanbanColumn
          title="Aguardando Resposta"
          icon={<HourglassIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
          leads={aguardando}
          accentClass="bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
          onOpenConversation={handleOpenConversation}
        />
        <KanbanColumn
          title="Em Atendimento"
          icon={<MessageCircle className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />}
          leads={emAtendimento}
          accentClass="bg-indigo-50 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300"
          onOpenConversation={handleOpenConversation}
        />
        <KanbanColumn
          title="Finalizados"
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
          leads={finalizados}
          accentClass="bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
          onOpenConversation={handleOpenConversation}
        />
      </div>
    </PageShell>
  );
}
