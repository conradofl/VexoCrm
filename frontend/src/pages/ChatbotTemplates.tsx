import { useState } from "react";
import { Plus, Bot } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { useLeadClients } from "@/hooks/useLeadClients";
import {
  useChatbotTemplates,
  useDeleteChatbotTemplate,
  type ChatbotTemplate,
} from "@/hooks/useChatbotTemplates";
import { emptyTemplate, cloneFromBuiltin } from "@/lib/chatbotTemplates/helpers";
import { TemplateCard } from "./ChatbotTemplates/TemplateCard";
import { TemplateEditor } from "./ChatbotTemplates/TemplateEditor";

type EditorState = ReturnType<typeof emptyTemplate>;

export default function ChatbotTemplates() {
  const { data: clients = [] } = useLeadClients();
  const [clientId, setClientId] = useState<string>("");
  const [editing, setEditing] = useState<EditorState | null>(null);

  const { data: templates = [], isLoading } = useChatbotTemplates(clientId || null);
  const deleteMutation = useDeleteChatbotTemplate();

  const builtins = templates.filter((t) => t.is_builtin);
  const custom = templates.filter((t) => !t.is_builtin);

  async function handleDelete(t: ChatbotTemplate) {
    if (!confirm(`Deletar template "${t.display_name}"?`)) return;
    try {
      await deleteMutation.mutateAsync({ id: t.id, clientId: clientId! });
      toast({ title: "Template deletado" });
    } catch (e) {
      toast({ title: "Erro ao deletar", description: String(e), variant: "destructive" });
    }
  }

  return (
    <PageShell
      title="Templates de Chatbot"
      subtitle="Configure os campos de coleta e critérios de qualificação para cada agente."
    >
      <div className="space-y-6 max-w-5xl">
        {/* Seletor de empresa */}
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-end gap-4">
              <div className="w-72">
                <Label className="text-xs mb-1.5 block">Empresa</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar empresa…" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {clientId && !editing && (
                <Button size="sm" onClick={() => setEditing(emptyTemplate(clientId))}>
                  <Plus className="size-3.5 mr-1.5" />
                  Novo template
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {!clientId && (
          <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10 py-16">
            <p className="text-sm text-slate-400">
              Selecione uma empresa para visualizar ou criar templates.
            </p>
          </div>
        )}

        {clientId && editing && (
          <TemplateEditor
            initial={editing}
            clientId={clientId}
            onClose={() => setEditing(null)}
          />
        )}

        {clientId && !editing && (
          <>
            {isLoading && (
              <p className="text-sm text-slate-400 text-center py-8">
                Carregando templates…
              </p>
            )}

            {!isLoading && builtins.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
                  Templates Built-in
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {builtins.map((t) => (
                    <TemplateCard
                      key={t.id}
                      template={t}
                      onEdit={() => {}}
                      onClone={() => setEditing(cloneFromBuiltin(t, clientId))}
                      onDelete={() => {}}
                    />
                  ))}
                </div>
              </div>
            )}

            {!isLoading && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
                  Templates Personalizados
                  {custom.length > 0 && (
                    <span className="ml-2 text-xs normal-case font-normal">
                      ({custom.length})
                    </span>
                  )}
                </h3>
                {custom.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10 py-12 gap-3">
                    <Bot className="size-8 text-slate-300" />
                    <p className="text-sm text-slate-400">
                      Nenhum template personalizado ainda.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(emptyTemplate(clientId))}
                    >
                      <Plus className="size-3.5 mr-1.5" />
                      Criar template
                    </Button>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {custom.map((t) => (
                      <TemplateCard
                        key={t.id}
                        template={t}
                        onEdit={() =>
                          setEditing({
                            clientId,
                            client_id: t.client_id,
                            template_key: t.template_key,
                            display_name: t.display_name,
                            agent_name: t.agent_name,
                            agent_role: t.agent_role,
                            data_fields: t.data_fields,
                            required_fields: t.required_fields,
                            classification: t.classification,
                          })
                        }
                        onClone={() => setEditing(cloneFromBuiltin(t, clientId))}
                        onDelete={() => handleDelete(t)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}
