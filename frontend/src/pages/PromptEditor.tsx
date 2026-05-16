import { useState, useEffect } from "react";
import { FileEdit, Save, Eye, Code2, Clock, AlertTriangle } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";
import { useLeadClients } from "@/hooks/useLeadClients";
import { usePrompt, useSavePrompt, type PromptType } from "@/hooks/usePrompts";
import { useAuth } from "@/contexts/AuthContext";

const PROMPT_TYPES: { value: PromptType; label: string; description: string }[] = [
  {
    value: "padrao",
    label: "Qualificador (Padrão)",
    description: "Prompt do chatbot qualificador SPIN — usado em todos os atendimentos.",
  },
  {
    value: "extrato",
    label: "Extrato / Briefing SDR",
    description: "Prompt de geração do briefing enviado ao SDR quando o lead finaliza.",
  },
];

function formatDate(iso: string | null): string {
  if (!iso) return "Nunca salvo";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function PromptPreview({ content }: { content: string }) {
  if (!content.trim()) {
    return (
      <div className="flex h-full min-h-[300px] items-center justify-center rounded-lg border border-dashed border-slate-200 dark:border-white/10">
        <p className="text-sm text-slate-400">Nenhum conteúdo para visualizar.</p>
      </div>
    );
  }

  return (
    <div className="min-h-[300px] rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-slate-800/50">
      <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-700 dark:text-slate-300">
        {content}
      </pre>
    </div>
  );
}

interface PromptEditorCardProps {
  clientId: string;
  type: PromptType;
}

function PromptEditorCard({ clientId, type }: PromptEditorCardProps) {
  const { data: prompt, isLoading, error } = usePrompt(clientId, type);
  const savePrompt = useSavePrompt();
  const [draft, setDraft] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    setDraft(prompt?.content ?? "");
    setIsDirty(false);
  }, [prompt]);

  const handleChange = (value: string) => {
    setDraft(value);
    setIsDirty(value !== (prompt?.content ?? ""));
  };

  const handleSave = async () => {
    try {
      await savePrompt.mutateAsync({ clientId, type, content: draft });
      setIsDirty(false);
      toast({ title: "Prompt salvo", description: "Conteúdo atualizado com sucesso." });
    } catch (e) {
      toast({
        title: "Erro ao salvar",
        description: e instanceof Error ? e.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  };

  if (error) {
    const isApiNotReady =
      error instanceof Error &&
      (error.message.includes("404") || error.message.includes("not found"));

    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-8 text-center dark:border-amber-800/40 dark:bg-amber-900/10">
        <AlertTriangle className="h-8 w-8 text-amber-400" />
        {isApiNotReady ? (
          <>
            <p className="font-medium text-amber-800 dark:text-amber-300">Endpoint ainda não disponível</p>
            <p className="text-sm text-amber-700 dark:text-amber-400">
              O Conrado ainda não publicou <code className="rounded bg-amber-100 px-1 dark:bg-amber-800">PUT /api/prompts</code>.
              Assim que o endpoint estiver no ar, os prompts já podem ser editados aqui.
            </p>
          </>
        ) : (
          <>
            <p className="font-medium text-amber-800 dark:text-amber-300">Erro ao carregar prompt</p>
            <p className="text-sm text-amber-700 dark:text-amber-400">{error.message}</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Meta info */}
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <Clock className="h-3.5 w-3.5" />
        <span>
          Última edição: <span className="font-medium">{formatDate(prompt?.updatedAt ?? null)}</span>
          {prompt?.updatedByEmail && (
            <> por <span className="font-medium">{prompt.updatedByEmail}</span></>
          )}
        </span>
        {isDirty && (
          <Badge variant="outline" className="ml-auto border-amber-300 text-amber-600 dark:border-amber-600 dark:text-amber-400 text-[10px]">
            Alterações não salvas
          </Badge>
        )}
      </div>

      {/* Editor / Preview */}
      <Tabs defaultValue="editor">
        <TabsList className="h-8">
          <TabsTrigger value="editor" className="gap-1.5 text-xs">
            <Code2 className="h-3.5 w-3.5" />
            Editor
          </TabsTrigger>
          <TabsTrigger value="preview" className="gap-1.5 text-xs">
            <Eye className="h-3.5 w-3.5" />
            Preview
          </TabsTrigger>
        </TabsList>

        <TabsContent value="editor" className="mt-2">
          <Textarea
            value={isLoading ? "" : draft}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={
              isLoading
                ? "Carregando..."
                : "Cole ou escreva o prompt aqui.\n\nVariáveis disponíveis:\n{{nome}} — nome do lead\n{{empresa}} — empresa do lead\n{{produto}} — produto de interesse"
            }
            disabled={isLoading || savePrompt.isPending}
            className="min-h-[340px] resize-y font-mono text-xs leading-relaxed"
          />
        </TabsContent>

        <TabsContent value="preview" className="mt-2">
          <PromptPreview content={draft} />
        </TabsContent>
      </Tabs>

      {/* Actions */}
      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={!isDirty || savePrompt.isPending || isLoading}
          className="gap-1.5"
          size="sm"
        >
          <Save className="h-3.5 w-3.5" />
          {savePrompt.isPending ? "Salvando..." : "Salvar prompt"}
        </Button>
      </div>
    </div>
  );
}

export default function PromptEditor() {
  const { canAccessInternalPage } = useAuth();
  const { data: clients = [], isLoading: loadingClients } = useLeadClients();
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [selectedType, setSelectedType] = useState<PromptType>("padrao");

  useEffect(() => {
    if (!selectedClientId && clients.length > 0) {
      setSelectedClientId(clients[0].id);
    }
  }, [clients, selectedClientId]);

  if (!canAccessInternalPage("empresas")) {
    return (
      <PageShell title="Editor de Prompts" subtitle="Acesso restrito">
        <p className="text-sm text-slate-500">Você não tem permissão para acessar esta página.</p>
      </PageShell>
    );
  }

  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const selectedTypeInfo = PROMPT_TYPES.find((t) => t.value === selectedType)!;

  return (
    <PageShell
      title="Editor de Prompts"
      subtitle="Edite os prompts do chatbot por empresa e tipo de origem do lead"
      spacing="space-y-6"
    >
      {/* Info */}
      <Card className="border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-900/10">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <FileEdit className="h-5 w-5 shrink-0 text-indigo-500 mt-0.5" />
            <div className="space-y-1 text-sm text-indigo-800 dark:text-indigo-300">
              <p className="font-medium">Como funciona</p>
              <p className="text-indigo-700 dark:text-indigo-400">
                Cada empresa pode ter até 4 prompts: <strong>padrão</strong> (inbound), <strong>campanha</strong> (outbound), <strong>qualificação aprofundada</strong> e <strong>extrato SDR</strong>. O chatbot escolhe automaticamente com base na origem e fase do lead. Se não houver prompt salvo, usa o prompt padrão do código.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Seletores */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-slate-700 dark:text-slate-300">Selecionar contexto</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500 dark:text-slate-400">Empresa</Label>
              <Select
                value={selectedClientId}
                onValueChange={setSelectedClientId}
                disabled={loadingClients}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder={loadingClients ? "Carregando..." : "Selecione a empresa"} />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id} className="text-sm">
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500 dark:text-slate-400">Tipo de prompt</Label>
              <Select value={selectedType} onValueChange={(v) => setSelectedType(v as PromptType)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROMPT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value} className="text-sm">
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTypeInfo && (
                <p className="text-xs text-slate-400 dark:text-slate-500">{selectedTypeInfo.description}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Editor */}
      {selectedClientId ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Prompt — {selectedClient?.name ?? selectedClientId}
              </CardTitle>
              <Badge variant="outline" className="text-[10px]">
                {selectedTypeInfo.label}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <PromptEditorCard clientId={selectedClientId} type={selectedType} />
          </CardContent>
        </Card>
      ) : (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <p className="text-sm text-slate-400">Selecione uma empresa para editar o prompt.</p>
        </div>
      )}
    </PageShell>
  );
}
