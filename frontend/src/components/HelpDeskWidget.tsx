import { FormEvent, useMemo, useState } from "react";
import { HelpCircle, Loader2, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import {
  HelpDeskMessage,
  useHelpDeskChat,
  useHelpDeskStatus,
} from "@/hooks/useHelpDesk";
import { cn } from "@/lib/utils";

interface HelpDeskWidgetProps {
  pageTitle: string;
}

const INITIAL_MESSAGES: HelpDeskMessage[] = [
  {
    role: "assistant",
    content:
      "Oi. Me diga onde voce esta travado no Vexo OS que eu te passo o caminho direto.",
  },
];

export function HelpDeskWidget({ pageTitle }: HelpDeskWidgetProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<HelpDeskMessage[]>(INITIAL_MESSAGES);
  const crmClient = useOptionalCrmClient();
  const status = useHelpDeskStatus();
  const chat = useHelpDeskChat();

  const currentContext = useMemo(
    () => ({
      pageTitle,
      currentPath: typeof window === "undefined" ? "" : window.location.pathname,
      selectedClientId: crmClient?.selectedClientId || null,
      selectedClientName: crmClient?.selectedClient?.name || null,
    }),
    [crmClient?.selectedClient?.name, crmClient?.selectedClientId, pageTitle]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const message = draft.trim();
    if (!message || chat.isPending) return;

    const userMessage: HelpDeskMessage = { role: "user", content: message };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");

    try {
      const answer = await chat.mutateAsync({
        message,
        history: messages,
        context: currentContext,
      });
      setMessages((current) => [...current, answer]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "Nao consegui responder agora. Tente novamente em instantes.",
        },
      ]);
    }
  };

  const resetChat = () => {
    setMessages(INITIAL_MESSAGES);
    setDraft("");
  };

  const disabledByConfig = status.data && !status.data.enabled;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="hidden h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/85 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70 dark:hover:bg-white/[0.08] dark:hover:text-white md:flex"
          aria-label="Abrir help desk"
          title="Help desk"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/70 px-5 py-4">
          <DialogTitle>Help desk Vexo OS</DialogTitle>
          <DialogDescription>
            Tire duvidas sobre fluxo, telas e configuracoes do sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[56vh] space-y-3 overflow-y-auto px-5 py-4">
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={cn(
                "max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-6",
                message.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "mr-auto border border-border/70 bg-muted/70 text-foreground"
              )}
            >
              {message.content}
            </div>
          ))}
          {chat.isPending ? (
            <div className="mr-auto flex max-w-[86%] items-center gap-2 rounded-2xl border border-border/70 bg-muted/70 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Respondendo...
            </div>
          ) : null}
        </div>

        {disabledByConfig ? (
          <div className="border-t border-border/70 px-5 py-4 text-sm text-muted-foreground">
            A IA do help desk ainda nao esta configurada no backend.
          </div>
        ) : (
          <form className="border-t border-border/70 p-4" onSubmit={handleSubmit}>
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ex.: como importo uma planilha para um cliente?"
              className="min-h-[92px] resize-none"
              disabled={chat.isPending}
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <Button type="button" variant="ghost" size="sm" onClick={resetChat}>
                <Trash2 className="h-4 w-4" />
                Limpar
              </Button>
              <Button type="submit" disabled={!draft.trim() || chat.isPending}>
                {chat.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Enviar
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
