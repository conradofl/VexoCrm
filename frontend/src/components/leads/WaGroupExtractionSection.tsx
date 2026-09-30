import { useState, useRef, useEffect } from "react";
import { AlertTriangle, Loader2, Users } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { API_BASE_URL, readApiErrorMessage } from "@/lib/api";

// Terceira procedência do Banco de Dados, ao lado de conversas e agenda:
// membros de grupo do WhatsApp. Nunca representa telefone na tela — só
// contagem (nome do grupo, quantos entram, quantos se perdem). O aviso de
// risco (gente que nunca falou com a empresa, parte sem telefone
// recuperável, padrão que já custou bloqueio de chip) é bloqueante e só
// aparece uma vez por sessão — quem já confirmou não é perguntado de novo.

export interface WaGroupPreviewItem {
  id: string;
  name: string;
  totalMembers: number;
  usableCount: number;
  lidCount: number;
}

type PreviewState = "idle" | "loading" | "loaded" | "empty" | "error";

interface WaGroupExtractionSectionProps {
  clientId: string;
  instanceId: string;
  getIdToken: () => Promise<string | null>;
  /** Já confirmou o aviso nesta sessão (visita à página) — vive no componente pai, sobrevive a fechar/reabrir o modal. */
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  /** Chamado sempre que a seleção de grupos muda — vazio quando a opção está desmarcada. */
  onSelectionChange: (groupIds: string[], selectedGroups?: WaGroupPreviewItem[]) => void;
  /** Chamado sempre que o checkbox "Membros de grupos" muda — independente de já ter algum grupo escolhido na prévia. O pai usa isso pra montar `sources` e pra decidir se o botão de extrair fica habilitado. */
  onEnabledChange: (enabled: boolean) => void;
  disabled?: boolean;
}

export function sumGroupSelection(groups: WaGroupPreviewItem[], selectedIds: Set<string>): { contacts: number; lost: number } {
  let contacts = 0;
  let lost = 0;
  for (const g of groups) {
    if (!selectedIds.has(g.id)) continue;
    contacts += g.usableCount;
    lost += g.lidCount;
  }
  return { contacts, lost };
}

export function WaGroupExtractionSection({
  clientId,
  instanceId,
  getIdToken,
  confirmed,
  onConfirmedChange,
  onSelectionChange,
  onEnabledChange,
  disabled,
}: WaGroupExtractionSectionProps) {
  const [enabled, setEnabled] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  const [groups, setGroups] = useState<WaGroupPreviewItem[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState("");

  const prevInstanceIdRef = useRef(instanceId);

  const fetchPreview = async (targetInstanceId?: string) => {
    const activeInstanceId = targetInstanceId !== undefined ? targetInstanceId : instanceId;
    setPreviewState("loading");
    setErrorMessage("");
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/leads/extract-wa-groups/preview`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, instanceId: activeInstanceId || undefined }),
      });
      if (!res.ok) {
        const msg = await readApiErrorMessage(res, "Erro ao pré-visualizar grupos do WhatsApp");
        setErrorMessage(msg);
        setPreviewState("error");
        return;
      }
      const data = await res.json();
      const list: WaGroupPreviewItem[] = Array.isArray(data.groups) ? data.groups : [];
      setGroups(list);
      setPreviewState(list.length === 0 ? "empty" : "loaded");
    } catch (err: any) {
      setErrorMessage(err?.message || "Erro ao pré-visualizar grupos do WhatsApp");
      setPreviewState("error");
    }
  };

  // Trocar de instância: limpa lista e seleção, e recarrega a prévia automaticamente se marcada
  useEffect(() => {
    if (prevInstanceIdRef.current !== instanceId) {
      prevInstanceIdRef.current = instanceId;
      setGroups([]);
      setSelectedGroupIds(new Set());
      onSelectionChange([], []);
      if (enabled) {
        if (confirmed) {
          fetchPreview(instanceId);
        }
      } else {
        setPreviewState("idle");
      }
    }
  }, [instanceId, enabled, confirmed]);

  const handleCheckboxChange = (checked: boolean) => {
    if (checked) {
      setEnabled(true);
      onEnabledChange(true);
      if (confirmed) {
        fetchPreview();
      } else {
        setShowConfirm(true);
      }
    } else {
      setEnabled(false);
      onEnabledChange(false);
      setGroups([]);
      setSelectedGroupIds(new Set());
      setPreviewState("idle");
      onSelectionChange([], []);
    }
  };

  // setShowConfirm aqui é só o dado de decisão (confirmar liga, cancelar
  // desliga) — fechar visualmente o AlertDialog é separado (onOpenChange,
  // abaixo), porque o clique em Action/Cancel do Radix já dispara
  // onOpenChange(false) sozinho; se a lógica de desmarcar morasse ali
  // também, confirmar desmarcaria a opção por engano.
  const handleConfirm = () => {
    onConfirmedChange(true);
    fetchPreview();
  };

  const handleCancelConfirm = () => {
    setEnabled(false);
    onEnabledChange(false);
  };

  const toggleGroup = (groupId: string, checked: boolean) => {
    const next = new Set(selectedGroupIds);
    if (checked) next.add(groupId);
    else next.delete(groupId);
    setSelectedGroupIds(next);
    const selectedList = groups.filter((g) => next.has(g.id));
    onSelectionChange(Array.from(next), selectedList);
  };

  const { contacts, lost } = sumGroupSelection(groups, selectedGroupIds);

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs font-semibold text-foreground cursor-pointer">
        <Checkbox
          checked={enabled}
          onCheckedChange={(v) => handleCheckboxChange(v === true)}
          disabled={disabled}
          aria-label="Membros de grupos"
        />
        Membros de grupos
      </label>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Antes de importar membros de grupo
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1.5 text-left">
                <p>Essas pessoas nunca falaram com a empresa.</p>
                <p>Parte dos membros vem sem telefone, e não tem como recuperar.</p>
                <p>Disparo para lista assim é o padrão que já causou bloqueio de chip.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelConfirm}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>Entendi, quero ver os grupos</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {enabled && previewState === "loading" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Buscando grupos...
        </div>
      )}

      {enabled && previewState === "error" && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
          {errorMessage}
        </div>
      )}

      {enabled && previewState === "empty" && (
        <div className="rounded-md border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">
          Nenhum grupo encontrado nesta instância.
        </div>
      )}

      {enabled && previewState === "loaded" && (
        <div className="space-y-2">
          <div className="max-h-48 overflow-y-auto space-y-1.5 border border-border rounded-md p-2">
            {groups.map((g) => (
              <label key={g.id} className="flex items-start gap-2 text-xs py-1 cursor-pointer">
                <Checkbox
                  checked={selectedGroupIds.has(g.id)}
                  onCheckedChange={(v) => toggleGroup(g.id, v === true)}
                  disabled={disabled}
                  aria-label={g.name}
                />
                <span className="flex-1">
                  <span className="font-medium flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {g.name}
                  </span>
                  <span className="text-muted-foreground">
                    {g.totalMembers} membros · {g.usableCount} entram · {g.lidCount} se perdem
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {selectedGroupIds.size === 0
              ? "Nenhum grupo selecionado."
              : `Selecionados: ${contacts} contato${contacts === 1 ? "" : "s"} entram, ${lost} se perde${lost === 1 ? "" : "m"}.`}
          </p>
        </div>
      )}
    </div>
  );
}
