// Harness da coluna da esquerda da aba Conversas, para abrir em navegador de verdade.
// Monta os MESMOS componentes que a tela usa, dentro da mesma moldura de 300px,
// com dados fixos e relógio fixo. Não fala com servidor.
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import {
  ChipScopeSelect,
  ConversationListItem,
  InboxFooterFilters,
  InboxStateTabs,
  type FooterFilter,
  type InboxTab,
} from "@/components/inbox/InboxColumn";
import type { ChipAgentInfo } from "@/hooks/useWhatsAppInbox";

const NOW = Date.parse("2026-11-10T18:00:00Z"); // 15:00 em São Paulo

interface Row {
  id: string;
  name: string;
  preview: string;
  tab: InboxTab;
  chip: string;
  waitingSince: string | null;
  fallbackTime: string;
  campaign?: boolean;
  attention?: string;
  neverSpoke?: boolean;
  unread?: number;
}

// Já na ordem em que o servidor devolve: em "esperam", mais parado primeiro.
const ROWS: Row[] = [
  { id: "e1", name: "Marcos Vinícius Albuquerque de Souza", preview: "Consegue me passar o valor ainda hoje, por favor?", tab: "esperam", chip: "comercial-hostery", waitingSince: "2026-11-07T15:00:00Z", fallbackTime: "07/11", campaign: true },
  { id: "e2", name: "Dona Lúcia", preview: "Oi, tudo bem?", tab: "esperam", chip: "pessoal-caio", waitingSince: "2026-11-09T14:00:00Z", fallbackTime: "Ontem", unread: 2 },
  { id: "e3", name: "+55 34 99999-0003", preview: "Pode me ligar?", tab: "esperam", chip: "comercial-hostery", waitingSince: "2026-11-10T14:00:00Z", fallbackTime: "11:00", attention: "pediu para falar com uma pessoa" },
  { id: "e4", name: "Rafael", preview: "Fechado então", tab: "esperam", chip: "comercial-gabriel", waitingSince: "2026-11-10T16:48:00Z", fallbackTime: "13:48" },
  { id: "e5", name: "Bia", preview: "Mandei o comprovante", tab: "esperam", chip: "comercial-hostery", waitingSince: "2026-11-10T17:22:00Z", fallbackTime: "14:22" },
  { id: "c1", name: "Paulo", preview: "Segue a proposta em anexo.", tab: "com_lead", chip: "comercial-hostery", waitingSince: "2026-11-10T12:00:00Z", fallbackTime: "14:10" },
  { id: "c2", name: "Lead de campanha", preview: "Olá! Temos uma condição especial", tab: "com_lead", chip: "comercial-gabriel", waitingSince: null, fallbackTime: "Seg", campaign: true, neverSpoke: true },
  { id: "f1", name: "Antigo sem resposta", preview: "Ainda tem interesse?", tab: "esfriaram", chip: "comercial-hostery", waitingSince: "2026-10-01T12:00:00Z", fallbackTime: "01/10" },
  { id: "g1", name: "Grupo Diretoria", preview: "Reunião às 16h", tab: "grupos", chip: "comercial-hostery", waitingSince: null, fallbackTime: "12:00" },
  { id: "a1", name: "Banco (autoatendimento)", preview: "Digite 1 para saldo", tab: "automacao", chip: "comercial-hostery", waitingSince: null, fallbackTime: "09:00" },
  { id: "x1", name: "Conversa arquivada", preview: "Obrigado!", tab: "arquivadas", chip: "comercial-gabriel", waitingSince: null, fallbackTime: "02/11" },
];

const CHIPS = [
  { value: "comercial-hostery", name: "Comercial - Hostery", connected: true },
  { value: "comercial-gabriel", name: "Comercial - Gabriel", connected: false },
  { value: "pessoal-caio", name: "Pessoal - Caio", connected: false },
];

const CHIP_AGENTS: Record<string, ChipAgentInfo> = {
  "comercial-hostery": { kind: "nenhum", agentName: null, reason: "robo_da_empresa_desligado" },
  "comercial-gabriel": { kind: "nenhum", agentName: "Agente de Atendimento", reason: "agente_do_chip_desligado" },
  "pessoal-caio": { kind: "nenhum", agentName: null, reason: "chip_pessoal" },
};

function Harness() {
  const [tab, setTab] = useState<InboxTab>("esperam");
  const [chip, setChip] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const scoped = useMemo(() => ROWS.filter((r) => !chip || r.chip === chip), [chip]);
  const count = (key: InboxTab) => scoped.filter((r) => r.tab === key).length;
  const items = tab === "todas" ? scoped : scoped.filter((r) => r.tab === tab);

  const footer: FooterFilter[] = [
    { key: "esfriaram", label: "Esfriaram", title: "", count: count("esfriaram") },
    { key: "minhas", label: "Minhas", title: "" },
    { key: "hoje", label: "Hoje", title: "" },
    { key: "pausadas", label: "Pausadas", title: "" },
    { key: "grupos", label: "Grupos", title: "", count: count("grupos") },
    { key: "automacao", label: "Automações", title: "", count: count("automacao") },
    { key: "arquivadas", label: "Arquivadas", title: "", count: count("arquivadas") },
    { key: "todas", label: "Todas", title: "" },
  ];

  return (
    <div className="p-4">
      {/* Mesma moldura da tela: altura da janela menos o cabeçalho da página */}
      <div className="flex h-[calc(100vh-220px)] min-h-[650px] gap-3">
        <div
          data-testid="inbox-column"
          className="w-[300px] shrink-0 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card/60 shadow-xs"
        >
          <div className="flex flex-col gap-2.5 border-b border-border/60 p-3 bg-muted/20">
            <InboxStateTabs
              active={tab}
              counts={{ esperam: count("esperam"), com_lead: count("com_lead"), robo: count("robo"), esfriaram: count("esfriaram") }}
              onChange={setTab}
            />
            <ChipScopeSelect value={chip} options={CHIPS} chipAgents={CHIP_AGENTS} onChange={setChip} />
          </div>
          <div className="flex-1 overflow-y-auto" data-testid="inbox-list">
            {items.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">Nenhuma conversa encontrada.</div>
            ) : (
              items.map((row) => (
                <ConversationListItem
                  key={row.id}
                  id={row.id}
                  label={row.name}
                  preview={row.neverSpoke ? `Sem resposta · ${row.preview}` : row.preview}
                  avatar={<div className="h-9 w-9 shrink-0 rounded-full bg-muted" />}
                  selected={selected === row.id}
                  checked={checked.has(row.id)}
                  onSelect={() => setSelected(row.id)}
                  onToggleCheck={() =>
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    })
                  }
                  waitingSince={row.waitingSince}
                  showWait={tab === "esperam" || tab === "esfriaram"}
                  fallbackTime={row.fallbackTime}
                  now={NOW}
                  flags={{
                    unreadCount: row.unread,
                    attentionReason: row.attention || null,
                    fromCampaign: row.campaign,
                    campaignName: row.campaign ? "Black Friday" : null,
                    isGroup: row.tab === "grupos",
                    isAutomation: row.tab === "automacao",
                    isArchived: row.tab === "arquivadas",
                    noLead: row.id === "e3",
                  }}
                />
              ))
            )}
          </div>
          <InboxFooterFilters active={tab} filters={footer} onChange={setTab} />
        </div>
        <div className="flex-1 rounded-2xl border border-dashed border-border/60 p-6 text-xs text-muted-foreground">
          Painel da conversa (fora desta frente)
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
