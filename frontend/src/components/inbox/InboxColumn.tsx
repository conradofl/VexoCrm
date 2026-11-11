// Peças da coluna da esquerda da aba Conversas: abas de estado, seletor de escopo
// de chip, item da lista em duas linhas e rodapé com os filtros secundários.
// São componentes de apresentação: não buscam dado nem guardam estado de servidor.
import type { ReactNode } from "react";
import {
  Archive,
  Bell,
  Bot,
  BotOff,
  CheckCheck,
  Clock3,
  Megaphone,
  Phone,
  ShieldAlert,
  Smartphone,
  UserPlus,
  Users,
  Hourglass,
  ArrowRightLeft,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatWaitLabel, waitUrgency, type WaitUrgency } from "@/lib/inbox/waitTime";
import type { ChipAgentInfo, WorkStateCounts } from "@/hooks/useWhatsAppInbox";

export type InboxTab =
  | "esperam"
  | "com_lead"
  | "robo"
  | "esfriaram"
  | "minhas"
  | "hoje"
  | "automacao"
  | "arquivadas"
  | "pausadas"
  | "grupos"
  | "todas";

export const STATE_TABS: { key: "esperam" | "com_lead" | "robo"; label: string; title: string }[] = [
  {
    key: "esperam",
    label: "Esperam você",
    title: "O lead falou por último nos últimos 7 dias e ninguém respondeu. Mais parado primeiro.",
  },
  {
    key: "com_lead",
    label: "Com o lead",
    title: "A última mensagem é nossa: a bola está com o lead.",
  },
  {
    key: "robo",
    label: "Robô cuida",
    title: "Conversas em chip onde o agente de IA responde sozinho e não está pausado.",
  },
];

const STATE_TAB_ACTIVE: Record<string, string> = {
  esperam: "bg-amber-600 text-white shadow-xs",
  com_lead: "bg-primary text-primary-foreground shadow-xs",
  robo: "bg-purple-600 text-white shadow-xs",
};

export function InboxStateTabs({
  active,
  counts,
  onChange,
}: {
  active: InboxTab;
  counts: WorkStateCounts | undefined;
  onChange: (tab: InboxTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Estado das conversas"
      className="grid grid-cols-3 gap-1 rounded-xl border border-border/70 bg-background p-1 text-[11px]"
    >
      {STATE_TABS.map((tab) => {
        const isActive = active === tab.key;
        const count = counts?.[tab.key];
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`inbox-tab-${tab.key}`}
            onClick={() => onChange(tab.key)}
            title={tab.title}
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 font-semibold leading-tight transition-all cursor-pointer",
              isActive ? STATE_TAB_ACTIVE[tab.key] : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            <span className="text-sm font-bold tabular-nums" data-testid={`inbox-tab-count-${tab.key}`}>
              {count ?? "–"}
            </span>
            <span className="whitespace-nowrap">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const CHIP_REASON_TEXT: Record<string, (name: string | null) => string> = {
  chip_pessoal: () => "Chip pessoal: o robô nunca responde aqui.",
  agente_do_chip_desligado: (name) =>
    `Agente ${name ? `"${name}"` : "deste chip"} está desligado: ninguém responde sozinho aqui.`,
  agente_so_de_campanha: (name) =>
    `Agente ${name ? `"${name}"` : "deste chip"} é só de campanha: não responde lead.`,
  agente_do_chip: (name) => `Quem responde sozinho: ${name || "agente deste chip"}.`,
  robo_da_empresa_desligado: () => "Robô da empresa desligado: só pessoas respondem aqui.",
  chip_fora_do_robo_da_empresa: () => "Este chip está fora do robô da empresa: só pessoas respondem.",
  robo_da_empresa: () => "Quem responde sozinho: robô da empresa.",
};

export function describeChipAgent(info: ChipAgentInfo | null | undefined): string {
  if (!info) return "";
  const build = CHIP_REASON_TEXT[info.reason];
  return build ? build(info.agentName) : "";
}

export interface ChipOption {
  /** Apelido do chip usado no filtro (último trecho da URL de disparo, ou o nome). */
  value: string;
  name: string;
  connected: boolean;
}

export function ChipScopeSelect({
  value,
  options,
  chipAgents,
  onChange,
}: {
  value: string | null;
  options: ChipOption[];
  chipAgents: Record<string, ChipAgentInfo>;
  onChange: (value: string | null) => void;
}) {
  const agentText = value ? describeChipAgent(chipAgents[value.toLowerCase()] ?? chipAgents[value]) : "";
  return (
    <div className="flex flex-col gap-1" data-testid="inbox-chip-scope">
      <div className="flex items-center gap-2">
        <label
          htmlFor="inbox-chip-scope-trigger"
          className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-muted-foreground"
        >
          <Smartphone className="h-3.5 w-3.5" />
          Ver conversas de
        </label>
        <Select value={value || "all"} onValueChange={(val) => onChange(val === "all" ? null : val)}>
          <SelectTrigger
            id="inbox-chip-scope-trigger"
            className="h-7 w-full min-w-0 rounded-lg border-border/80 bg-background text-xs"
          >
            <SelectValue placeholder="Todos os chips" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os chips</SelectItem>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.name}
                {opt.connected ? "" : " (desconectado)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {agentText && (
        <p className="text-[10px] leading-snug text-muted-foreground" data-testid="inbox-chip-agent-text">
          {agentText}
        </p>
      )}
    </div>
  );
}

const URGENCY_BORDER: Record<WaitUrgency, string> = {
  fresh: "border-l-emerald-500",
  warm: "border-l-amber-500",
  late: "border-l-rose-500",
};

const URGENCY_TEXT: Record<WaitUrgency, string> = {
  fresh: "text-emerald-700 dark:text-emerald-400",
  warm: "text-amber-700 dark:text-amber-400",
  late: "text-rose-700 dark:text-rose-400",
};

export interface ConversationFlags {
  unreadCount?: number;
  /** Motivo do pedido de atenção humana; presente = borda vermelha. */
  attentionReason?: string | null;
  isNumberChange?: boolean;
  agentMutedReason?: string | null;
  isAgentMuted?: boolean;
  isAutomation?: boolean;
  automationReason?: string | null;
  isArchived?: boolean;
  isGroup?: boolean;
  transferredTo?: string | null;
  isTransferred?: boolean;
  attendedBy?: string | null;
  isAttended?: boolean;
  noLead?: boolean;
  scheduleText?: string | null;
  reminder?: { title: string; overdue: boolean; when: string } | null;
  stalledDays?: number | null;
  /** Lead veio de campanha; `campaignName` quando conhecido. */
  fromCampaign?: boolean;
  campaignName?: string | null;
  leadNeverSpoke?: boolean;
}

function FlagIcon({ title, className, children }: { title: string; className: string; children: ReactNode }) {
  return (
    <span title={title} aria-label={title} role="img" className={cn("inline-flex shrink-0", className)}>
      {children}
    </span>
  );
}

export function ConversationListItem({
  id,
  label,
  preview,
  avatar,
  selected,
  checked,
  onSelect,
  onToggleCheck,
  waitingSince,
  showWait,
  fallbackTime,
  now,
  flags,
  children,
}: {
  id: string;
  label: string;
  preview: string;
  avatar: ReactNode;
  selected: boolean;
  checked: boolean;
  onSelect: () => void;
  onToggleCheck: () => void;
  /** Última mensagem do lead (ISO). */
  waitingSince: string | null | undefined;
  /** Aba em que o tempo de espera manda (Esperam você, Esfriaram). */
  showWait: boolean;
  /** Texto de horário usado fora das abas de espera. */
  fallbackTime: string;
  now: number;
  flags: ConversationFlags;
  children?: ReactNode;
}) {
  const urgency = showWait ? waitUrgency(waitingSince, now) : null;
  const waitText = showWait ? formatWaitLabel(waitingSince, now) : "";
  const timeText = waitText || fallbackTime;
  const needsAttention = Boolean(flags.attentionReason);
  const borderClass = needsAttention
    ? "border-l-rose-500"
    : urgency
    ? URGENCY_BORDER[urgency]
    : "border-l-transparent";
  const icon = "h-3 w-3";

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`inbox-item-${id}`}
      data-urgency={needsAttention ? "attention" : urgency ?? "none"}
      aria-current={selected ? "true" : undefined}
      className={cn(
        // A linha entre itens é do próprio item (border-b). Um `divide-*` no contêiner
        // sobrescreve a cor da borda esquerda e apaga a urgência.
        "flex w-full items-center gap-2 border-b border-b-border/40 border-l-4 py-2 pl-1.5 pr-2.5 text-left transition-colors hover:bg-muted/50 cursor-pointer",
        borderClass,
        selected && "bg-emerald-500/10"
      )}
    >
      <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={checked}
          onCheckedChange={onToggleCheck}
          className="h-4 w-4 rounded-sm border-border/80 data-[state=checked]:bg-primary"
          aria-label={`Selecionar ${label}`}
        />
      </div>

      {avatar}

      <div className="min-w-0 flex-1">
        {/* Linha 1: nome e tempo de espera */}
        <div className="flex items-baseline justify-between gap-2">
          <p
            className={cn(
              "truncate text-xs font-bold",
              selected ? "text-emerald-700 dark:text-emerald-300" : "text-foreground"
            )}
          >
            {label}
          </p>
          <span
            data-testid={`inbox-item-time-${id}`}
            className={cn(
              "shrink-0 text-[10px] font-semibold tabular-nums",
              urgency ? URGENCY_TEXT[urgency] : "font-normal text-muted-foreground"
            )}
          >
            {timeText}
          </span>
        </div>

        {/* Linha 2: prévia e sinais em ícone */}
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-[11px] leading-snug text-muted-foreground">{preview}</p>
          <div className="flex shrink-0 items-center gap-1" data-testid={`inbox-item-flags-${id}`}>
            {needsAttention && (
              <FlagIcon title={`Atenção humana: ${flags.attentionReason}`} className="text-rose-600 dark:text-rose-400">
                <ShieldAlert className={icon} />
              </FlagIcon>
            )}
            {flags.reminder && (
              <FlagIcon
                title={
                  flags.reminder.overdue
                    ? `Lembrete vencido: "${flags.reminder.title}" (${flags.reminder.when})`
                    : `Lembrete só para você: "${flags.reminder.title}" (${flags.reminder.when})`
                }
                className={flags.reminder.overdue ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}
              >
                <Bell className={icon} />
              </FlagIcon>
            )}
            {flags.scheduleText && (
              <FlagIcon title={`Mensagem agendada para ${flags.scheduleText}`} className="text-indigo-600 dark:text-indigo-400">
                <Clock3 className={icon} />
              </FlagIcon>
            )}
            {flags.isAgentMuted && (
              <FlagIcon
                title={`Agente pausado: ${flags.agentMutedReason || "conversa pessoal"}`}
                className="text-slate-600 dark:text-slate-400"
              >
                <BotOff className={icon} />
              </FlagIcon>
            )}
            {flags.isNumberChange && (
              <FlagIcon title="Contato informou novo número" className="text-indigo-600 dark:text-indigo-400">
                <Phone className={icon} />
              </FlagIcon>
            )}
            {flags.isAutomation && !flags.isNumberChange && (
              <FlagIcon
                title={flags.automationReason || "Robô ou autoatendimento detectado do outro lado"}
                className="text-purple-600 dark:text-purple-400"
              >
                <Bot className={icon} />
              </FlagIcon>
            )}
            {flags.isTransferred && (
              <FlagIcon
                title={`Conversa transferida para ${flags.transferredTo || "outro chip"}`}
                className="text-indigo-600 dark:text-indigo-400"
              >
                <ArrowRightLeft className={icon} />
              </FlagIcon>
            )}
            {flags.isAttended && (
              <FlagIcon
                title={flags.attendedBy ? `Atendido por ${flags.attendedBy}` : "Atendimento registrado"}
                className="text-emerald-600 dark:text-emerald-400"
              >
                <CheckCheck className={icon} />
              </FlagIcon>
            )}
            {typeof flags.stalledDays === "number" && (
              <FlagIcon
                title={`Lead parado há ${flags.stalledDays} dias sem resposta`}
                className="text-amber-600 dark:text-amber-400"
              >
                <Hourglass className={icon} />
              </FlagIcon>
            )}
            {flags.fromCampaign && (
              <FlagIcon
                title={flags.campaignName ? `Veio da campanha: ${flags.campaignName}` : "Veio de campanha"}
                className="text-emerald-600 dark:text-emerald-400"
              >
                <Megaphone className={icon} />
              </FlagIcon>
            )}
            {flags.noLead && (
              <FlagIcon title="Contato ainda não cadastrado como lead" className="text-amber-600 dark:text-amber-400">
                <UserPlus className={icon} />
              </FlagIcon>
            )}
            {flags.isGroup && (
              <FlagIcon title="Grupo de WhatsApp" className="text-blue-600 dark:text-blue-400">
                <Users className={icon} />
              </FlagIcon>
            )}
            {flags.isArchived && (
              <FlagIcon title="Conversa arquivada" className="text-slate-600 dark:text-slate-400">
                <Archive className={icon} />
              </FlagIcon>
            )}
            {Boolean(flags.unreadCount && flags.unreadCount > 0) && (
              <span
                title={`${flags.unreadCount} não lidas`}
                className="rounded-full bg-emerald-500 px-1.5 text-[9px] font-extrabold leading-4 text-white"
              >
                {flags.unreadCount}
              </span>
            )}
          </div>
        </div>
        {children}
      </div>
    </button>
  );
}

export interface FooterFilter {
  key: InboxTab;
  label: string;
  title: string;
  count?: number;
}

export function InboxFooterFilters({
  active,
  filters,
  onChange,
}: {
  active: InboxTab;
  filters: FooterFilter[];
  onChange: (tab: InboxTab) => void;
}) {
  return (
    <div
      className="flex flex-wrap gap-1 border-t border-border/60 bg-muted/20 p-2 text-[10px]"
      data-testid="inbox-footer-filters"
      aria-label="Outros filtros"
    >
      {filters.map((filter) => {
        const isActive = active === filter.key;
        return (
          <button
            key={filter.key}
            type="button"
            data-testid={`inbox-footer-${filter.key}`}
            aria-pressed={isActive}
            onClick={() => onChange(filter.key)}
            title={filter.title}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold transition-colors cursor-pointer",
              isActive
                ? "border-foreground bg-foreground text-background"
                : "border-border/70 bg-background text-muted-foreground hover:text-foreground"
            )}
          >
            <span>{filter.label}</span>
            {typeof filter.count === "number" && filter.count > 0 && (
              <span className="tabular-nums" data-testid={`inbox-footer-count-${filter.key}`}>
                {filter.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
