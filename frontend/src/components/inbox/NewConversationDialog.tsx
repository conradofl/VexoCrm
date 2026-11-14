// Janela "Nova conversa" da aba Conversas: a empresa escreve primeiro para um número.
//
// Três campos: para quem (número digitado ou lead achado pelo nome), por qual chip (só os
// conectados; o padrão vem escolhido) e a primeira mensagem. O envio usa a mesma rota da resposta
// manual. Qualquer recusa do servidor (número inválido, chip desconectado, número com opt-out)
// aparece aqui dentro, e nada é enviado. Se a conversa já existe, a janela fecha e a tela abre ela.
import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Send, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  formatPhoneLabel,
  looksLikePhone,
  searchLeads,
  type NewConversationChip,
  type NewConversationLead,
  type StartConversationResult,
} from "@/lib/inbox/newConversation";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leads: NewConversationLead[];
  /** Só chips conectados da empresa. */
  chips: NewConversationChip[];
  onSend: (input: { phone: string; chipId: string; body: string }) => Promise<StartConversationResult>;
  /** Conversa criada ou já existente: a tela abre. `unsentBody` vem quando a conversa já existia e nada foi enviado. */
  onStarted: (result: StartConversationResult & { unsentBody?: string }) => void;
}

export function NewConversationDialog({ open, onOpenChange, leads, chips, onSend, onStarted }: Props) {
  const [target, setTarget] = useState("");
  const [pickedLead, setPickedLead] = useState<NewConversationLead | null>(null);
  const [chipId, setChipId] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const defaultChipId = useMemo(() => (chips.find((c) => c.isDefault) || chips[0])?.id || "", [chips]);

  useEffect(() => {
    if (!open) return;
    setTarget("");
    setPickedLead(null);
    setBody("");
    setError(null);
    setSending(false);
    setChipId(defaultChipId);
  }, [open, defaultChipId]);

  const suggestions = useMemo(() => (pickedLead ? [] : searchLeads(leads, target)), [leads, target, pickedLead]);
  const phone = pickedLead ? pickedLead.phone : target;
  const phoneOk = pickedLead ? Boolean(pickedLead.phone.replace(/\D/g, "")) : looksLikePhone(target);
  const canSend = phoneOk && Boolean(chipId) && body.trim().length > 0 && !sending;

  const handleSend = async () => {
    if (!canSend) return;
    setError(null);
    setSending(true);
    try {
      const result = await onSend({ phone, chipId, body: body.trim() });
      onStarted(result.existing ? { ...result, unsentBody: body.trim() } : result);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar. Nada foi enviado.");
    } finally {
      setSending(false);
    }
  };

  const fieldClass =
    "w-full rounded-[10px] border border-border bg-background px-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-indigo-400 md:text-sm";

  return (
    <Dialog open={open} onOpenChange={(next) => !sending && onOpenChange(next)}>
      <DialogContent className="inbox-touch max-h-[100dvh] overflow-y-auto sm:max-w-[460px]" data-testid="new-conversation-dialog">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">Nova conversa</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Escreva primeiro para um número. A mensagem sai pelo chip escolhido e a conversa entra na lista.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5 py-1">
          {/* Para quem */}
          <div className="space-y-1">
            <label htmlFor="new-conversation-target" className="text-xs font-semibold text-foreground">
              Para quem
            </label>
            {pickedLead ? (
              <div
                className="flex min-h-11 items-center gap-2 rounded-[10px] border border-indigo-200 bg-indigo-50 px-3 dark:border-indigo-500/40 dark:bg-indigo-500/10"
                data-testid="new-conversation-picked"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">{pickedLead.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{formatPhoneLabel(pickedLead.phone)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPickedLead(null);
                    setTarget("");
                    setError(null);
                  }}
                  aria-label="Trocar o destinatário"
                  className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <>
                <input
                  id="new-conversation-target"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setError(null);
                  }}
                  placeholder="Número com DDD ou nome do lead"
                  data-testid="new-conversation-target"
                  className={cn(fieldClass, "h-11")}
                />
                {suggestions.length > 0 && (
                  <ul className="overflow-hidden rounded-[10px] border border-border" data-testid="new-conversation-suggestions">
                    {suggestions.map((lead) => (
                      <li key={lead.id} className="border-b border-border/60 last:border-b-0">
                        <button
                          type="button"
                          onClick={() => {
                            setPickedLead(lead);
                            setError(null);
                          }}
                          data-testid="new-conversation-suggestion"
                          className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left hover:bg-muted"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{lead.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{formatPhoneLabel(lead.phone)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {target.trim() && !phoneOk && suggestions.length === 0 && (
                  <p className="text-[11px] text-muted-foreground" data-testid="new-conversation-target-hint">
                    {/[a-zA-Z]/.test(target) ? "Nenhum lead com esse nome. Digite o número com DDD." : "Digite o número com DDD, por exemplo (34) 99999-0000."}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Por qual chip */}
          <div className="space-y-1">
            <label htmlFor="new-conversation-chip" className="text-xs font-semibold text-foreground">
              Sai pelo chip
            </label>
            {chips.length === 0 ? (
              <p className="rounded-[10px] border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100" data-testid="new-conversation-no-chip">
                Nenhum chip conectado. Reconecte um chip em Integrações para iniciar conversa.
              </p>
            ) : (
              <select
                id="new-conversation-chip"
                value={chipId}
                onChange={(e) => {
                  setChipId(e.target.value);
                  setError(null);
                }}
                data-testid="new-conversation-chip"
                className={cn(fieldClass, "h-11 cursor-pointer")}
              >
                {chips.map((chip) => (
                  <option key={chip.id} value={chip.id}>
                    {chip.name}
                    {chip.isDefault ? " (padrão)" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Primeira mensagem */}
          <div className="space-y-1">
            <label htmlFor="new-conversation-body" className="text-xs font-semibold text-foreground">
              Primeira mensagem
            </label>
            <textarea
              id="new-conversation-body"
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setError(null);
              }}
              rows={3}
              placeholder="Escreva a mensagem…"
              data-testid="new-conversation-body"
              className={cn(fieldClass, "resize-none py-2.5 leading-normal")}
            />
          </div>

          {error && (
            <div
              role="alert"
              data-testid="new-conversation-error"
              className="rounded-[10px] border border-rose-300 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100"
            >
              <p className="font-bold">Mensagem não enviada</p>
              <p>{error}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={sending}
            className="min-h-9 cursor-pointer rounded-[10px] border border-border bg-card px-4 text-sm font-semibold text-foreground/80 hover:bg-muted disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            data-testid="new-conversation-send"
            className="flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-green-600 px-5 text-sm font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Enviar
            {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
