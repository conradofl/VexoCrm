import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { useWhatsAppSession } from "@/hooks/useWhatsAppSession";
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
  subtitle = "Conecte a conta por QR Code e atenda conversas dentro do CRM.",
  headerRight,
  allowSessionControls = true,
}: WhatsAppInboxProps) {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const chatsContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  const { selectedClientId } = useCrmClient();
  const campaignsQuery = useCampanhas(selectedClientId ?? undefined);
  const campaignNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of campaignsQuery.data ?? []) {
      map.set(c.id, c.name);
    }
    return map;
  }, [campaignsQuery.data]);

  const {
    session,
    isLoading: sessionLoading,
    isFetching: sessionFetching,
    error: sessionError,
    refetch: refetchSession,
    startSession,
    resetSession,
    isStarting,
    isResetting,
  } = useWhatsAppSession();

  const isReady = session?.status === "ready";
  const canLoadInbox = isReady && !sessionLoading && !sessionFetching;
  const chatsQuery = useWhatsAppChats(!!canLoadInbox);
  const messagesQuery = useWhatsAppMessages(selectedChatId, !!canLoadInbox);
  const sendMessage = useSendWhatsAppMessage(selectedChatId);

  const chats = chatsQuery.items ?? [];
  const messages = messagesQuery.data ?? [];
  const isSyncingAfterQr =
    session?.status === "authenticated" ||
    (session?.status === "ready" && chatsQuery.isLoading && chats.length === 0);
  const syncElapsedMinutes = session?.syncStartedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(session.syncStartedAt).getTime()) / 60000))
    : 0;

  useEffect(() => {
    if (!canLoadInbox) {
      setSelectedChatId(null);
      return;
    }

    if (!chats.length) {
      if (selectedChatId) {
        setSelectedChatId(null);
      }
      return;
    }

    const hasSelectedChat = chats.some((chat) => chat.id === selectedChatId);
    if (!selectedChatId || !hasSelectedChat) {
      setSelectedChatId(chats[0].id);
    }
  }, [canLoadInbox, chats, selectedChatId]);

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

  const handleStartSession = async () => {
    try {
      await startSession();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao iniciar o WhatsApp.");
    }
  };

  const handleResetSession = async () => {
    try {
      await resetSession();
      setSelectedChatId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao reiniciar a sessao.");
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

  const sessionControls = allowSessionControls ? (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => refetchSession()} disabled={sessionLoading}>
        <RefreshCw className={cn("h-4 w-4", sessionLoading && "animate-spin")} />
        Atualizar
      </Button>
      <Button onClick={handleStartSession} disabled={isStarting || isReady}>
        {isStarting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
        {session?.status === "idle" ? "Iniciar sessao" : "Gerar QR"}
      </Button>
      <Button variant="outline" size="sm" onClick={handleResetSession} disabled={isResetting}>
        {isResetting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <WifiOff className="h-4 w-4" />}
        Desconectar
      </Button>
    </div>
  ) : null;

  return (
    <PageShell
      title={title}
      subtitle={subtitle}
      headerRight={
        headerRight ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {headerRight}
            {sessionControls}
          </div>
        ) : (
          sessionControls
        )
      }
      spacing="space-y-6"
    >
      <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="border-border/70 bg-card/70">
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Smartphone className="h-5 w-5 text-electric-indigo" />
                  Conexao
                </CardTitle>
                <CardDescription>
                  {session?.message || "Inicialize a sessao para gerar o QR Code."}
                </CardDescription>
              </div>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em]",
                  isReady
                    ? "border-electric-indigo/30 bg-electric-indigo/10 text-electric-indigo"
                    : "border-amber-400/20 bg-amber-500/8 text-amber-200"
                )}
              >
                {STATUS_LABELS[session?.status || "idle"]}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ErrorMessage
              message={
                (sessionError as Error | null)?.message || session?.lastError || chatsQuery.error?.message || null
              }
              variant="banner"
            />

            {session?.qrCodeDataUrl ? (
              <div className="rounded-2xl border border-border/70 bg-white p-5">
                <img
                  src={session.qrCodeDataUrl}
                  alt="QR Code do WhatsApp"
                  className="mx-auto block w-full max-w-[280px]"
                />
              </div>
            ) : isSyncingAfterQr ? (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-amber-200">
                  <Clock3 className="h-4 w-4" />
                  QR lido. Sincronizando conversas...
                </div>
                <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/40 p-4">
                  <LoaderCircle className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-amber-200/80" />
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p className="text-foreground">A conexao foi iniciada com sucesso.</p>
                    <p>
                      Aguarde enquanto sincronizamos o WhatsApp e montamos as conversas iniciais
                      no CRM.
                    </p>
                    <p>
                      {session?.syncStatusMessage
                        ? `Etapa atual: ${session.syncStatusMessage}.`
                        : "O WhatsApp ainda esta preparando o historico inicial."}
                    </p>
                    {typeof session?.syncProgress === "number" && (
                      <p>Progresso informado pelo cliente: {session.syncProgress}%.</p>
                    )}
                    <p>
                      Em contas maiores, esse processo pode passar de 2 a 3 minutos antes das
                      primeiras conversas aparecerem.
                    </p>
                    {syncElapsedMinutes >= 5 && (
                      <p className="text-amber-200">
                        Ja estamos ha mais de 5 minutos sincronizando. Se nao sair disso,
                        reinicie a sessao do WhatsApp.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : isReady ? (
              <div className="rounded-2xl border border-electric-indigo/20 bg-electric-indigo/5 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-electric-indigo">
                  <Wifi className="h-4 w-4" />
                  Conta conectada
                </div>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>Nome: <span className="text-foreground">{session.clientInfo?.pushname || "Nao identificado"}</span></p>
                  <p>Numero: <span className="text-foreground">{session.clientInfo?.wid || "Nao identificado"}</span></p>
                  <p>Plataforma: <span className="text-foreground">{session.clientInfo?.platform || "WhatsApp Web"}</span></p>
                </div>
              </div>
            ) : allowSessionControls ? (
              <EmptyState
                icon={WifiOff}
                title="Sessao offline"
                description="Clique em iniciar sessao para abrir o WhatsApp Web no backend e gerar o QR Code."
                className="rounded-2xl border border-dashed border-border/70 bg-background/30"
              />
            ) : (
              <EmptyState
                icon={WifiOff}
                title="Sessao offline"
                description="O WhatsApp da operacao esta offline no momento. Assim que a equipe reconectar a sessao, suas conversas liberadas voltam a aparecer aqui."
                className="rounded-2xl border border-dashed border-border/70 bg-background/30"
              />
            )}

            {allowSessionControls && (
              <>
                <div className="grid gap-2 text-xs text-muted-foreground">
                  <p>1. Clique em iniciar sessao para subir o cliente do WhatsApp.</p>
                  <p>2. Escaneie o QR Code com o celular do atendente.</p>
                  <p>3. Quando o status mudar para conectado, a caixa de entrada libera automaticamente.</p>
                </div>

                <Button className="w-full" onClick={handleStartSession} disabled={isStarting || isReady}>
                  {isStarting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                  {session?.status === "idle" ? "Iniciar sessao e gerar QR" : "Gerar novo QR Code"}
                </Button>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleResetSession}
                  disabled={isResetting}
                >
                  {isResetting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Sair da sessao do WhatsApp Web
                </Button>
              </>
            )}
          </CardContent>
        </Card>

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
            {!canLoadInbox ? (
              <EmptyState
                icon={QrCode}
                title="Conecte o WhatsApp primeiro"
                description={
                  sessionLoading || sessionFetching
                    ? "Validando o estado atual da sessao do WhatsApp..."
                    : "A interface de conversas aparece assim que a sessao estiver pronta."
                }
              />
            ) : isSyncingAfterQr ? (
              <EmptyState
                icon={Clock3}
                title="Sincronizando conversas"
                description={
                  syncElapsedMinutes >= 5
                    ? "A sincronizacao esta demorando mais que o normal. Se continuar assim, reinicie a sessao."
                    : "O WhatsApp acabou de conectar e ainda esta carregando os chats mais recentes."
                }
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
                        description="A conta conectou, mas ainda nao retornou chats disponiveis."
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
                      <EmptyState message="Carregando ultimas 20 mensagens..." />
                    ) : !selectedChat ? (
                      <EmptyState
                        title="Escolha uma conversa"
                        description="Selecione um chat na coluna da esquerda para abrir o historico."
                      />
                    ) : messages.length === 0 ? (
                      <EmptyState
                        title="Sem mensagens carregadas"
                        description="Esse chat ainda nao retornou historico pelo cliente do WhatsApp."
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
                        Mostrando as 20 mensagens mais recentes desta conversa.
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
