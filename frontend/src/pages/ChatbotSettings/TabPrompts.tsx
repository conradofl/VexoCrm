import { useState, useEffect } from "react";
import { Clock, Code2, Eye, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { usePrompt, useSavePrompt, type PromptType } from "@/hooks/usePrompts";
import { formatDate } from "@/lib/chatbotSettings/helpers";
import { PROMPT_CONFIGS } from "@/lib/chatbotSettings/constants";

function PromptBlock({ clientId, type, label, description }: { clientId: string; type: PromptType; label: string; description: string }) {
  const { data: prompt, isLoading } = usePrompt(clientId, type);
  const savePrompt = useSavePrompt();
  const [draft, setDraft] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => { setDraft(prompt?.content ?? ""); setIsDirty(false); }, [prompt]);

  async function handleSave() {
    try {
      await savePrompt.mutateAsync({ clientId, type, content: draft });
      setIsDirty(false);
      toast({ title: "Prompt salvo" });
    } catch (e) {
      toast({ title: "Erro ao salvar", description: e instanceof Error ? e.message : "Erro", variant: "destructive" });
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm">{label}</CardTitle>
            <p className="text-xs text-slate-400 mt-0.5">{description}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isDirty && <Badge variant="outline" className="border-amber-300 text-amber-600 text-[10px]">Não salvo</Badge>}
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? <Code2 className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showPreview ? "Editor" : "Preview"}
            </Button>
          </div>
        </div>
        {prompt?.updatedAt && (
          <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-1">
            <Clock className="h-3 w-3" />
            Última edição: {formatDate(prompt.updatedAt)}
            {prompt.updatedByEmail && <> por {prompt.updatedByEmail}</>}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {showPreview ? (
          <div className="min-h-[280px] rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-slate-800/50">
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-700 dark:text-slate-300">{draft || "Sem conteúdo."}</pre>
          </div>
        ) : (
          <Textarea
            value={isLoading ? "" : draft}
            onChange={(e) => { setDraft(e.target.value); setIsDirty(e.target.value !== (prompt?.content ?? "")); }}
            placeholder={isLoading ? "Carregando..." : "Cole ou escreva o prompt aqui..."}
            disabled={isLoading || savePrompt.isPending}
            className="min-h-[280px] resize-y font-mono text-xs leading-relaxed"
          />
        )}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!isDirty || savePrompt.isPending || isLoading} size="sm" className="gap-1.5">
            <Save className="h-3.5 w-3.5" />
            {savePrompt.isPending ? "Salvando..." : "Salvar prompt"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function TabPrompts({ clientId }: { clientId: string }) {
  return (
    <div className="space-y-5 max-w-3xl">
      {PROMPT_CONFIGS.map((p) => (
        <PromptBlock key={p.type} clientId={clientId} type={p.type} label={p.label} description={p.description} />
      ))}
    </div>
  );
}
