import { useState } from "react";
import { Plus, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { useSaveChatbotTemplate, type TemplateField, type ChatbotTemplate } from "@/hooks/useChatbotTemplates";
import { generateJsonPreview, emptyTemplate } from "@/lib/chatbotTemplates/helpers";
import { FieldEditor } from "./FieldEditor";

type EditorState = Omit<ChatbotTemplate, "id" | "is_builtin" | "created_at" | "updated_at" | "updated_by_email"> & {
  clientId: string;
};

export function TemplateEditor({
  initial,
  clientId,
  onClose,
}: {
  initial: EditorState;
  clientId: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<EditorState>(initial);
  const save = useSaveChatbotTemplate();

  function updateField(idx: number, patch: Partial<TemplateField>) {
    setState((s) => {
      const fields = s.data_fields.map((f, i) => (i === idx ? { ...f, ...patch } : f));
      return { ...s, data_fields: fields };
    });
  }

  function toggleRequired(key: string) {
    setState((s) => {
      const already = s.required_fields.includes(key);
      return {
        ...s,
        required_fields: already
          ? s.required_fields.filter((k) => k !== key)
          : [...s.required_fields, key],
      };
    });
  }

  function addField() {
    setState((s) => ({
      ...s,
      data_fields: [
        ...s.data_fields,
        { key: "", label: "", description: "", required: false },
      ],
    }));
  }

  function removeField(idx: number) {
    setState((s) => {
      const removed = s.data_fields[idx];
      return {
        ...s,
        data_fields: s.data_fields.filter((_, i) => i !== idx),
        required_fields: s.required_fields.filter((k) => k !== removed.key),
      };
    });
  }

  function moveField(idx: number, dir: -1 | 1) {
    setState((s) => {
      const arr = [...s.data_fields];
      const target = idx + dir;
      if (target < 0 || target >= arr.length) return s;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      return { ...s, data_fields: arr };
    });
  }

  async function handleSave() {
    if (!state.template_key)
      return toast({ title: "Preencha a chave do template", variant: "destructive" });
    if (!state.display_name)
      return toast({ title: "Preencha o nome do template", variant: "destructive" });
    try {
      await save.mutateAsync({ ...state, clientId });
      toast({ title: "Template salvo com sucesso" });
      onClose();
    } catch (e) {
      toast({ title: "Erro ao salvar", description: String(e), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho do editor */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base">
          {initial.template_key ? "Editar Template" : "Novo Template"}
        </h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            <X className="size-3.5 mr-1.5" />
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSave} disabled={save.isPending}>
            <Save className="size-3.5 mr-1.5" />
            {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>

      {/* Identidade do agente */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Identidade do Agente</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Chave única (template_key)</Label>
            <Input
              value={state.template_key}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  template_key: e.target.value.toLowerCase().replace(/\s+/g, "_"),
                }))
              }
              placeholder="ex: outlier_imoveis"
              className="h-8 text-sm mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Nome de exibição</Label>
            <Input
              value={state.display_name}
              onChange={(e) =>
                setState((s) => ({ ...s, display_name: e.target.value }))
              }
              placeholder="ex: Outlier Imóveis"
              className="h-8 text-sm mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Nome do agente</Label>
            <Input
              value={state.agent_name}
              onChange={(e) =>
                setState((s) => ({ ...s, agent_name: e.target.value }))
              }
              placeholder="ex: Áureo"
              className="h-8 text-sm mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Cargo / papel</Label>
            <Input
              value={state.agent_role}
              onChange={(e) =>
                setState((s) => ({ ...s, agent_role: e.target.value }))
              }
              placeholder="ex: SDR da Outlier Consórcios"
              className="h-8 text-sm mt-1"
            />
          </div>
        </CardContent>
      </Card>

      {/* Campos de coleta */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">
              Campos de Coleta ({state.data_fields.length})
            </CardTitle>
            <Button variant="outline" size="sm" onClick={addField}>
              <Plus className="size-3.5 mr-1.5" />
              Adicionar campo
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {state.data_fields.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-4">
              Nenhum campo configurado.
            </p>
          )}
          {state.data_fields.map((field, idx) => (
            <FieldEditor
              key={idx}
              field={field}
              isRequired={state.required_fields.includes(field.key)}
              index={idx}
              total={state.data_fields.length}
              onUpdate={(patch) => updateField(idx, patch)}
              onToggleRequired={() => toggleRequired(field.key)}
              onRemove={() => removeField(idx)}
              onMoveUp={() => moveField(idx, -1)}
              onMoveDown={() => moveField(idx, 1)}
            />
          ))}
        </CardContent>
      </Card>

      {/* Critérios de classificação */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            Classificação de Lead (QUENTE / MORNO / FRIO)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(["quente", "morno", "frio"] as const).map((tier) => (
            <div key={tier}>
              <Label
                className={`text-xs font-semibold ${
                  tier === "quente"
                    ? "text-green-600"
                    : tier === "morno"
                      ? "text-yellow-600"
                      : "text-slate-500"
                }`}
              >
                {tier.toUpperCase()}
              </Label>
              <Textarea
                value={state.classification[tier]}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    classification: {
                      ...s.classification,
                      [tier]: e.target.value,
                    },
                  }))
                }
                placeholder={
                  tier === "quente"
                    ? "Ex: Objetivo claro, prazo curto, valor informado"
                    : tier === "morno"
                      ? "Ex: Interesse real mas pesquisando, faltam dados"
                      : "Ex: Curioso sem prazo, sem valor, pouca intenção"
                }
                rows={2}
                className="mt-1 text-sm resize-none"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Preview JSON */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">
            Preview — Estrutura de dados coletados
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="rounded-md bg-slate-900 p-4 text-xs text-green-400 overflow-x-auto leading-relaxed">
            {generateJsonPreview(state.data_fields)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
