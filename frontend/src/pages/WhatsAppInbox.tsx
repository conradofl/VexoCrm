import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Clock3,
  LoaderCircle,
  MessageCircle,
  QrCode,
  RefreshCw,
  Send,
  Smartphone,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useCampanhas } from "@/hooks/useCampanhas";
import { useCrmClient } from "@/hooks/useCrmClient";
import { toast } from "sonner";
import { PageShell } from "@/components/PageShell";
import { SectionHeader } from "@/components/SectionHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { cn } from "@/lib/utils";
import { useLeadClients } from "@/hooks/useLeadClients";
import {
  useSendWhatsAppMessage,
  useWhatsAppChats,
  useWhatsAppMessages,
  type WhatsAppChat,
  type WhatsAppMessage,
} from "@/hooks/useWhatsAppInbox";
import { MediaMessage } from "@/components/MediaMessage";

const STATUS_LABELS: Record<string, string> = {
  idle: "Parado",
  initializing: "Inicializando",
  qr_ready: "QR pronto",
  authenticated: "Sincronizando",
  ready: "Conectado",
  disconnected: "Desconectado",
  auth_failure: "Falha de login",
  error: "Erro",
};

function formatTimestamp(timestamp: number | null, withDate = false) {
  if (!timestamp) return "";

  return new Date(timestamp * 1000).toLocaleString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    ...(withDate
      ? {
          day: "2-digit",
          month: "2-digit",
        }
      : {}),
  });
}

function getPreview(chat: WhatsAppChat) {
  const body = chat.lastMessage?.body?.trim();
  if (!body) return "Sem mensagens recentes.";
  return body.length > 72 ? `${body.slice(0, 72)}...` : body;
}

function MessageBubble({ message }: { message: WhatsAppMessage }) {
  return (
    <div
      className={cn(
        "max-w-[78%] rounded-2xl px-4 py-3 text-sm",
        message.fromMe
          ? "ml-auto bg-electric-indigo/15 text-foreground"
          : "bg-secondary text-foreground"
      )}
    >
      <MediaMessage
        messageId={message.id}
        hasMedia={message.hasMedia}
        fallbackBody={message.body}
        fromMe={message.fromMe}
      />
      <p className="mt-2 text-[11px] text-muted-foreground">
        {formatTimestamp(message.timestamp)} {message.fromMe ? "• voce" : ""}
      </p>
    </div>
  );
}

interface WhatsAppInboxProps {
  title?: string;
  subtitle?: string;
  headerRight?: ReactNode;
  allowSessionControls?: boolean;
  clientId?: string;
}

function OriginBadge({ origin, campaignId, campaignNames }: { origin: string | null; campaignId: string | null; campaignNames: Map<string, string> }) {
  if (!origin) return null;

  if (origin === "campaign") {
    const name = campaignId ? campaignNames.get(campaignId) : undefined;
    return (
      <span className="rounded-full border border-electric-indigo/30 bg-electric-indigo/10 px-2 py-0.5 text-[10px] font-semibold text-electric-indigo">
        {name ? `Campanha: ${name}` : "Campanha"}
      </span>
    );
  }

  if (origin === "inbound") {
    return (
      <span className="rounded-full border border-border/50 bg-muted/50 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
        Inbound
      </span>
    );
  }

  return null;
}

export default function WhatsAppInbox({
  title = "WhatsApp",
  subtitle = "Visualize e atenda conversas em tempo real direto do CRM.",
  headerRight,
  allowSessionControls = true,
  clientId: propClientId,
}: WhatsAppInboxProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialPhone = searchParams.get("phone") ?? null;

  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const chatsContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  const { selectedClientId } = useCrmClient();
  const clientId = propClientId || selectedClientId;

  const { data: tenants = [], isLoading: tenantsLoading } = useLeadClients();
  const activeTenant = tenants.find((t) => t.id === clientId) ?? null;
  const evolutionInstances = activeTenant?.n8n_settings?.evolution_instances ?? [];
  const hasConnectedInstances = evolutionInstances.some((inst) => inst.active);

  const campaignsQuery = useCampanhas(clientId ?? undefined);
  const campaignNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of campaignsQuery.data ?? []) {
      map.set(c.id, c.name);
    }
    return map;
  }, [campaignsQuery.data]);

  const canLoadInbox = !!clientId && hasConnectedInstances && !tenantsLoading;
  const chatsQuery = useWhatsAppChats(clientId, !!canLoadInbox);
  const messagesQuery = useWhatsAppMessages(clientId, selectedChatId, !!canLoadInbox);
  const sendMessage = useSendWhatsAppMessage(clientId, selectedChatId);

  const chats = chatsQuery.items ?? [];
  const messages = messagesQuery.data ?? [];

  useEffect(() => {
    if (!canLoadInbox) {
      setSelectedChatId(null);
      return;
    }

    if (!chats.length) {
      if (selectedChatId) setSelectedChatId(null);
      return;
    }

    // Se chegou via deep-link do Kanban com ?phone=, tenta abrir o chat desse número
    if (initialPhone) {
      const digits = initialPhone.replace(/\D/g, "");
      const match = chats.find((chat) => chat.id.replace(/@.*/, "") === digits);
      if (match) {
        setSelectedChatId(match.id);
        setSearchParams({}, { replace: true }); // limpa o param após selecionar
        return;
      }
    }

    const hasSelectedChat = chats.some((chat) => chat.id === selectedChatId);
    if (!selectedChatId || !hasSelectedChat) {
      setSelectedChatId(chats[0].id);
    }
  }, [canLoadInbox, chats, selectedChatId, initialPhone, setSearchParams]);

  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId) || null,
    [chats, selectedChatId]
  );

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }, [messages, selectedChatId]);

  const handleChatsScroll = () => {
    const container = chatsContainerRef.current;
    if (!container || !chatsQuery.hasMore || chatsQuery.isFetchingNextPage) {
      return;
    }

    const remainingScroll = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (remainingScroll < 160) {
      void chatsQuery.loadMore();
    }
  };

  const handleSendMessage = async () => {
    const trimmedDraft = draft.trim();
    if (!selectedChatId || !trimmedDraft) return;

    try {
      await sendMessage.mutateAsync(trimmedDraft);
      setDraft("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar mensagem.");
    }
  };

  return (
    <PageShell
      title={title}
      subtitle={subtitle}
      headerRight={headerRight}
      spacing="space-y-6"
    >
      <section className="w-full">
        <Card className="border-border/70 bg-card/70">
          <CardHeader className="pb-4">
            <SectionHeader
              title="Inbox"
              subtitle="Lista de conversas e envio de mensagens direto do CRM."
              icon={MessageCircle}
              className="mb-0"
            />
          </CardHeader>
          <CardContent>
            {tenantsLoading ? (
              <div className="flex flex-col items-center justify-center gap-4 py-16 text-sm text-muted-foreground">
                <LoaderCircle className="h-7 w-7 animate-spin text-primary" />
                Carregando conversas do WhatsApp...
              </div>
            ) : !hasConnectedInstances ? (
              <EmptyState
                icon={WifiOff}
                title="Nenhum chip de WhatsApp conectado"
                description="Conecte pelo menos um chip de WhatsApp ativo em 'Chips WhatsApp' para visualizar e enviar mensagens."
              />
            ) : (
              <div className="grid h-[calc(100vh-260px)] min-h-[620px] gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                <div className="min-h-0 overflow-hidden rounded-xl border border-border/70 bg-background/30">
                  <div className="border-b border-border/70 p-3">
                    <Input readOnly value="" placeholder="Conversas atualizadas automaticamente" />
                  </div>
                  <div
                    ref={chatsContainerRef}
                    onScroll={handleChatsScroll}
                    className="h-[calc(100%-62px)] overflow-y-auto"
                  >
                    {chatsQuery.isLoading ? (
                      <EmptyState message="Carregando conversas mais recentes..." />
                    ) : chats.length === 0 ? (
                      <EmptyState
                        title="Nenhuma conversa encontrada"
                        description="Nenhuma conversa registrada no banco de dados para os chips conectados."
                      />
                    ) : (
                      chats.map((chat) => (
                        <button
                          key={chat.id}
                          type="button"
                          onClick={() => setSelectedChatId(chat.id)}
                          className={cn(
                            "w-full border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-accent/40",
                            chat.id === selectedChatId && "bg-primary/10"
                          )}
                        >
                          <div className="mb-1 flex items-center justify-between gap-3">
                            <p className="truncate text-sm font-medium text-foreground">{chat.name}</p>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {formatTimestamp(chat.timestamp, true)}
                            </span>
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{getPreview(chat)}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {chat.unreadCount > 0 && (
                              <span className="rounded-full bg-electric-indigo px-2 py-0.5 text-[10px] font-bold text-black">
                                {chat.unreadCount} novas
                              </span>
                            )}
                            {chat.isGroup && (
                              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                                Grupo
                              </span>
                            )}
                            <OriginBadge
                              origin={chat.leadOrigin ?? null}
                              campaignId={chat.sourceCampaignId ?? null}
                              campaignNames={campaignNames}
                            />
                          </div>
                        </button>
                      ))
                    )}

                    {!chatsQuery.isLoading && chatsQuery.isFetchingNextPage && (
                      <div className="flex items-center justify-center p-3 text-xs text-muted-foreground">
                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                        Carregando mais conversas...
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-background/30">
                  <div className="border-b border-border/70 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">
                        {selectedChat?.name || "Selecione uma conversa"}
                      </p>
                      {selectedChat && (
                        <OriginBadge
                          origin={selectedChat.leadOrigin ?? null}
                          campaignId={selectedChat.sourceCampaignId ?? null}
                          campaignNames={campaignNames}
                        />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {selectedChat?.id || "Nenhuma conversa selecionada"}
                    </p>
                  </div>

                  <div
                    ref={messagesContainerRef}
                    className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
                  >
                    {messagesQuery.isLoading ? (
                      <EmptyState message="Carregando ultimas mensagens..." />
                    ) : !selectedChat ? (
                      <EmptyState
                        title="Escolha uma conversa"
                        description="Selecione um chat na coluna da esquerda para abrir o historico."
                      />
                    ) : messages.length === 0 ? (
                      <EmptyState
                        title="Sem mensagens carregadas"
                        description="Nenhuma mensagem registrada no banco de dados para esta conversa."
                      />
                    ) : (
                      messages.map((message) => (
                        <MessageBubble key={message.id || `${message.timestamp}-${message.body}`} message={message} />
                      ))
                    )}
                  </div>

                  <div className="border-t border-border/70 p-4">
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        Histórico de mensagens sincronizado diretamente a partir do banco de dados do CRM.
                      </p>
                      <Textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder="Digite uma mensagem..."
                        rows={4}
                        disabled={!selectedChat || sendMessage.isPending}
                      />
                      <div className="flex justify-end">
                        <Button
                          onClick={handleSendMessage}
                          disabled={!selectedChat || !draft.trim() || sendMessage.isPending}
                        >
                          {sendMessage.isPending ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                          Enviar
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </PageShell>
  );
}
