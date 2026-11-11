// Peças da coluna da esquerda da aba Conversas (prancha "A fila — antes e depois"):
// busca + botão de filtros numa linha, três estados de trabalho, item em duas linhas
// com a urgência na borda, e rodapé com Grupos / Automações / Arquivadas.
// São componentes de apresentação: não buscam dado nem guardam estado de servidor.
import type { ReactNode } from "react";
import {
  Archive,
  ArrowRightLeft,
  Bell,
  Bot,
  Check,
  Clock3,
  Hourglass,
  Phone,
  Search,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatWaitLabel, formatWaitTime, waitUrgency, type WaitUrgency } from "@/lib/inbox/waitTime";
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

/** Os três estados de trabalho, com o número grande em cima. */
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
    <div role="tablist" aria-label="Estado das conversas" className="flex gap-1.5">
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
              "min-w-0 flex-1 basis-0 cursor-pointer rounded-[10px] border px-1 pb-2 pt-[9px] text-center transition-colors",
              isActive
                ? "border-indigo-300 bg-indigo-50 dark:border-indigo-500/50 dark:bg-indigo-500/15"
                : "border-border bg-card hover:bg-muted/50"
            )}
          >
            <div
              data-testid={`inbox-tab-count-${tab.key}`}
              className={cn(
                "text-[19px] font-bold leading-[1.1] tabular-nums",
                isActive ? "text-indigo-600 dark:text-indigo-300" : "text-foreground/80"
              )}
            >
              {count ?? "–"}
            </div>
            <div
              className={cn(
                "mt-[3px] truncate text-[10.5px] font-semibold uppercase tracking-[.02em]",
                isActive ? "text-indigo-700/90 dark:text-indigo-200" : "text-muted-foreground"
              )}
            >
              {tab.label}
            </div>
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

export interface FooterFilter {
  key: InboxTab;
  label: string;
  title: string;
  count?: number;
}

/**
 * Linha do topo: busca + botão de filtros. O botão guarda o que saiu da tela e não
 * deixou de existir: escopo de chip, as outras listas e a seleção em massa.
 */
export function InboxSearchRow({
  search,
  onSearchChange,
  filtersOpen,
  onFiltersOpenChange,
  chipValue,
  chipOptions,
  chipAgents,
  onChipChange,
  otherLists,
  activeTab,
  onTabChange,
  selectMode,
  onToggleSelectMode,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  filtersOpen: boolean;
  onFiltersOpenChange: (open: boolean) => void;
  chipValue: string | null;
  chipOptions: ChipOption[];
  chipAgents: Record<string, ChipAgentInfo>;
  onChipChange: (value: string | null) => void;
  otherLists: FooterFilter[];
  activeTab: InboxTab;
  onTabChange: (tab: InboxTab) => void;
  selectMode: boolean;
  onToggleSelectMode: () => void;
}) {
  const agentText = chipValue ? describeChipAgent(chipAgents[chipValue.toLowerCase()] ?? chipAgents[chipValue]) : "";
  const hasFilter = Boolean(chipValue) || otherLists.some((f) => f.key === activeTab) || selectMode;

  return (
    <div className="flex items-center gap-2 border-b border-border/60 px-4 pb-3 pt-4">
      <label className="flex h-[38px] min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-border bg-muted/40 px-3 focus-within:border-indigo-400">
        <Search className="h-[15px] w-[15px] shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Buscar conversa</span>
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar nome, número ou mensagem"
          data-testid="inbox-search"
          className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>

      <Popover open={filtersOpen} onOpenChange={onFiltersOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Filtros e escopo"
            title="Filtros e escopo"
            data-testid="inbox-filters-button"
            className={cn(
              "relative grid h-[38px] w-[38px] shrink-0 cursor-pointer place-items-center rounded-[10px] border transition-colors",
              hasFilter
                ? "border-indigo-300 bg-indigo-50 text-indigo-600 dark:border-indigo-500/50 dark:bg-indigo-500/15 dark:text-indigo-300"
                : "border-border bg-muted/40 text-foreground/70 hover:bg-muted"
            )}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[290px] space-y-3 p-3" data-testid="inbox-filters-panel">
          <div className="space-y-1.5" data-testid="inbox-chip-scope">
            <label htmlFor="inbox-chip-scope-trigger" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Ver conversas de
            </label>
            <Select value={chipValue || "all"} onValueChange={(val) => onChipChange(val === "all" ? null : val)}>
              <SelectTrigger id="inbox-chip-scope-trigger" className="h-9 w-full rounded-lg text-xs">
                <SelectValue placeholder="Todos os chips" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os chips</SelectItem>
                {chipOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.name}
                    {opt.connected ? "" : " (desconectado)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {agentText && (
              <p className="text-[11px] leading-snug text-muted-foreground" data-testid="inbox-chip-agent-text">
                {agentText}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Outras listas</p>
            <div className="flex flex-wrap gap-1.5">
              {otherLists.map((filter) => {
                const isActive = activeTab === filter.key;
                return (
                  <button
                    key={filter.key}
                    type="button"
                    aria-pressed={isActive}
                    data-testid={`inbox-footer-${filter.key}`}
                    title={filter.title}
                    onClick={() => {
                      onTabChange(filter.key);
                      onFiltersOpenChange(false);
                    }}
                    className={cn(
                      "inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors",
                      isActive
                        ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/15 dark:text-indigo-200"
                        : "border-border bg-card text-foreground/80 hover:bg-muted"
                    )}
                  >
                    {filter.label}
                    {typeof filter.count === "number" && filter.count > 0 && (
                      <span className="tabular-nums text-muted-foreground" data-testid={`inbox-footer-count-${filter.key}`}>
                        {filter.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            data-testid="inbox-select-mode"
            aria-pressed={selectMode}
            onClick={() => {
              onToggleSelectMode();
              onFiltersOpenChange(false);
            }}
            className="w-full cursor-pointer rounded-lg border border-border bg-card px-3 py-2 text-left text-xs font-semibold text-foreground/80 hover:bg-muted"
          >
            {selectMode ? "Sair da seleção em massa" : "Selecionar várias conversas"}
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** "MAIS PARADO PRIMEIRO" à esquerda e o escopo de chip à direita. */
export function InboxOrderRow({
  label,
  chipLabel,
  onChipClick,
}: {
  label: string;
  chipLabel: string;
  onChipClick: () => void;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-[18px] pb-2 pt-3.5">
      <span className="truncate text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground" data-testid="inbox-order-label">
        {label}
      </span>
      <button
        type="button"
        onClick={onChipClick}
        data-testid="inbox-chip-link"
        className="shrink-0 cursor-pointer text-[11.5px] font-semibold text-indigo-600 hover:underline dark:text-indigo-300"
      >
        {chipLabel}
      </button>
    </div>
  );
}

type ItemTone = "attention" | "late" | "warm" | "selected" | "none";

const TONE_ROW: Record<ItemTone, string> = {
  attention: "border-l-red-600 bg-red-50 dark:bg-red-500/10",
  late: "border-l-red-600 bg-red-50 dark:bg-red-500/10",
  warm: "border-l-amber-500",
  selected: "border-l-indigo-500 bg-indigo-50 dark:bg-indigo-500/15",
  none: "border-l-border",
};

const URGENCY_TIME: Record<WaitUrgency, string> = {
  fresh: "font-semibold text-muted-foreground",
  warm: "font-bold text-amber-800 dark:text-amber-300",
  late: "font-bold text-red-700 dark:text-red-300",
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
  /** A última mensagem é do robô. */
  lastFromRobot?: boolean;
}

function FlagIcon({ title, className, children }: { title: string; className: string; children: ReactNode }) {
  return (
    <span title={title} aria-label={title} role="img" className={cn("inline-flex shrink-0", className)}>
      {children}
    </span>
  );
}

function Tag({ children, tone, title }: { children: ReactNode; tone: "amber" | "gray"; title: string }) {
  return (
    <span
      title={title}
      className={cn(
        "shrink-0 rounded-[5px] px-1.5 py-0.5 text-[10px] font-bold uppercase",
        tone === "amber"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"
          : "bg-muted text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}

/**
 * Item da lista: nome + tempo de espera na primeira linha; ícone do sinal principal,
 * prévia e etiqueta na segunda. A urgência é a cor da borda esquerda.
 */
export function ConversationListItem({
  id,
  label,
  preview,
  selected,
  selectMode,
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
  selected: boolean;
  /** Seleção em massa ligada: mostra a caixa de marcar. */
  selectMode: boolean;
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
  // "4h parada" só para quem está parado há muito; abaixo disso o tempo sozinho ("38min", "1h12").
  const waitText = !showWait ? "" : urgency === "late" ? formatWaitLabel(waitingSince, now) : formatWaitTime(waitingSince, now);
  const timeText = waitText || fallbackTime;
  const needsAttention = Boolean(flags.attentionReason);
  const tone: ItemTone = needsAttention
    ? "attention"
    : urgency === "late"
    ? "late"
    : selected
    ? "selected"
    : urgency === "warm"
    ? "warm"
    : "none";
  const icon = "h-3 w-3";

  // Um sinal principal à esquerda da prévia, por prioridade.
  const lead = flags.fromCampaign ? (
    <FlagIcon
      title={flags.campaignName ? `Veio da campanha: ${flags.campaignName}` : "Veio de campanha"}
      className="text-indigo-500 dark:text-indigo-300"
    >
      <Send className={icon} />
    </FlagIcon>
  ) : flags.lastFromRobot ? (
    <FlagIcon title="Última mensagem foi do robô" className="text-green-600 dark:text-green-400">
      <Bot className={icon} />
    </FlagIcon>
  ) : flags.isAttended ? (
    <FlagIcon
      title={flags.attendedBy ? `Atendido por ${flags.attendedBy}` : "Atendimento registrado"}
      className="text-green-600 dark:text-green-400"
    >
      <Check className={icon} />
    </FlagIcon>
  ) : null;

  return (
    <div
      data-testid={`inbox-item-${id}`}
      data-urgency={needsAttention ? "attention" : urgency ?? "none"}
      data-selected={selected ? "true" : "false"}
      className={cn(
        // A linha entre itens é do próprio item. Um `divide-*` no contêiner sobrescreve a
        // cor da borda esquerda e apaga a urgência.
        "flex items-stretch border-b border-b-border/40 border-l-[3px] transition-colors",
        TONE_ROW[tone],
        tone === "none" || tone === "warm" ? "hover:bg-muted/50" : ""
      )}
    >
      {selectMode && (
        <div className="flex shrink-0 items-center pl-3">
          <Checkbox
            checked={checked}
            onCheckedChange={onToggleCheck}
            className="h-4 w-4 rounded-sm border-border/80 data-[state=checked]:bg-primary"
            aria-label={`Selecionar ${label}`}
          />
        </div>
      )}
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className="min-w-0 flex-1 cursor-pointer py-[11px] pl-4 pr-4 text-left"
      >
        {/* Linha 1: nome e tempo de espera */}
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{label}</span>
          <span
            data-testid={`inbox-item-time-${id}`}
            className={cn(
              "shrink-0 text-[11.5px] tabular-nums",
              urgency
                ? selected && urgency === "fresh"
                  ? "font-bold text-indigo-600 dark:text-indigo-300"
                  : URGENCY_TIME[urgency]
                : "font-semibold text-muted-foreground"
            )}
          >
            {timeText}
          </span>
        </div>

        {/* Linha 2: sinal principal, prévia, etiqueta e sinais em ícone */}
        <div className="mt-[3px] flex items-center gap-1.5">
          {lead}
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">{preview}</span>
          <span className="flex shrink-0 items-center gap-1" data-testid={`inbox-item-flags-${id}`}>
            {needsAttention && (
              <FlagIcon title={`Atenção humana: ${flags.attentionReason}`} className="text-red-600 dark:text-red-400">
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
                className={flags.reminder.overdue ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}
              >
                <Bell className={icon} />
              </FlagIcon>
            )}
            {flags.scheduleText && (
              <FlagIcon title={`Mensagem agendada para ${flags.scheduleText}`} className="text-indigo-600 dark:text-indigo-400">
                <Clock3 className={icon} />
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
            {typeof flags.stalledDays === "number" && (
              <FlagIcon title={`Lead parado há ${flags.stalledDays} dias sem resposta`} className="text-amber-600 dark:text-amber-400">
                <Hourglass className={icon} />
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
            {flags.isAgentMuted && (
              <Tag tone="amber" title={`Robô pausado nesta conversa: ${flags.agentMutedReason || "atendimento humano"}`}>
                Você atende
              </Tag>
            )}
            {flags.noLead && (
              <Tag tone="gray" title="Contato ainda não cadastrado como lead">
                Sem lead
              </Tag>
            )}
            {Boolean(flags.unreadCount && flags.unreadCount > 0) && (
              <span
                title={`${flags.unreadCount} não lidas`}
                className="rounded-full bg-indigo-500 px-1.5 text-[9px] font-extrabold leading-4 text-white"
              >
                {flags.unreadCount}
              </span>
            )}
          </span>
        </div>
        {children}
      </button>
    </div>
  );
}

/** Rodapé da coluna: Grupos, Automações e Arquivadas. */
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
      className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-border/60 px-4 py-[11px]"
      data-testid="inbox-footer-filters"
      aria-label="Outras listas"
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
              "cursor-pointer text-[11.5px] transition-colors hover:text-foreground",
              isActive ? "font-bold text-indigo-600 dark:text-indigo-300" : "text-muted-foreground"
            )}
          >
            {filter.label}
            {typeof filter.count === "number" && filter.count > 0 && (
              <strong
                className={cn("ml-1 tabular-nums", isActive ? "" : "text-foreground/75")}
                data-testid={`inbox-footer-count-${filter.key}`}
              >
                {filter.count}
              </strong>
            )}
          </button>
        );
      })}
    </div>
  );
}
