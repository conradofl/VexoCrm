import { useState } from "react";
import {
  Bot, ChevronDown, ChevronUp, Copy, GripVertical, Pencil, Plus, Save, Trash2, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import {
  useChatbotTemplates, useSaveChatbotTemplate, useDeleteChatbotTemplate,
  type ChatbotTemplate, type TemplateField,
} from "@/hooks/useChatbotTemplates";
import { emptyTemplate, type EditorState } from "@/lib/chatbotSettings/helpers";

function FieldEditor({
  field, isRequired, index, total, onUpdate, onToggleRequired, onRemove, onMoveUp, onMoveDown,
}: {
  field: TemplateField; isRequired: boolean; index: number; total: number;
  onUpdate: (p: Partial<TemplateField>) => void; onToggleRequired: () => void;
  onRemove: () => void; onMoveUp: () => void; onMoveDown: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-slate-200 dark:border-white/10 p-3">
      <div className="mt-2 flex flex-col gap-0.5 text-slate-400">
        <button onClick={onMoveUp} disabled={index === 0} className="disabled:opacity-30"><ChevronUp className="size-3.5" /></button>
        <GripVertical className="size-3.5" />
        <button onClick={onMoveDown} disabled={index === total - 1} className="disabled:opacity-30"><ChevronDown className="size-3.5" /></button>
      </div>
      <div className="flex-1 grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Chave (key)</Label>
          <Input value={field.key} onChange={(e) => onUpdate({ key: e.target.value.toLowerCase().replace(/\s+/g, "_") })} placeholder="ex: cidade" className="h-8 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Label</Label>
          <Input value={field.label} onChange={(e) => onUpdate({ label: e.target.value })} placeholder="ex: Cidade" className="h-8 text-sm" />
        </div>
        <div className="col-span-2">
          <Label className="text-xs">Descrição (instrução para o agente)</Label>
          <Input value={field.description} onChange={(e) => onUpdate({ description: e.target.value })} placeholder="ex: Cidade onde o lead mora" className="h-8 text-sm" />
        </div>
        <div className="flex items-center gap-2 col-span-2">
          <Switch id={`req-${index}`} checked={isRequired} onCheckedChange={onToggleRequired} />
          <Label htmlFor={`req-${index}`} className="text-xs cursor-pointer">Obrigatório</Label>
        </div>
      </div>
      <Button variant="ghost" size="icon" className="size-7 shrink-0 mt-1 text-red-500" onClick={onRemove}>
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

function TemplateEditorPanel({ initial, clientId, onClose }: { initial: EditorState; clientId: string; onClose: () => void }) {
  const [state, setState] = useState<EditorState>(initial);
  const save = useSaveChatbotTemplate();

  function updateField(idx: number, patch: Partial<TemplateField>) {
    setState((s) => ({ ...s, data_fields: s.data_fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)) }));
  }
  function toggleRequired(key: string) {
    setState((s) => ({
      ...s,
      required_fields: s.required_fields.includes(key)
        ? s.required_fields.filter((k) => k !== key)
        : [...s.required_fields, key],
    }));
  }
  function addField() {
    setState((s) => ({ ...s, data_fields: [...s.data_fields, { key: "", label: "", description: "", required: false }] }));
  }
  function removeField(idx: number) {
    setState((s) => {
      const removed = s.data_fields[idx];
      return { ...s, data_fields: s.data_fields.filter((_, i) => i !== idx), required_fields: s.required_fields.filter((k) => k !== removed.key) };
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
    if (!state.template_key) return toast({ title: "Preencha a chave do template", variant: "destructive" });
    if (!state.display_name) return toast({ title: "Preencha o nome do template", variant: "destructive" });
    try {
      await save.mutateAsync({ ...state, clientId });
      toast({ title: "Template salvo" });
      onClose();
    } catch (e) {
      toast({ title: "Erro ao salvar", description: String(e), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base">{initial.template_key ? "Editar template" : "Novo template"}</h3>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}><X className="size-3.5 mr-1.5" />Cancelar</Button>
          <Button size="sm" onClick={handleSave} disabled={save.isPending}><Save className="size-3.5 mr-1.5" />{save.isPending ? "Salvando…" : "Salvar"}</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Identidade do Agente</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Chave única (template_key)</Label>
            <Input value={state.template_key} onChange={(e) => setState((s) => ({ ...s, template_key: e.target.value.toLowerCase().replace(/\s+/g, "_") }))} placeholder="ex: outlier_imoveis" className="h-8 text-sm mt-1" />
          </div>
          <div>
            <Label className="text-xs">Nome de exibição</Label>
            <Input value={state.display_name} onChange={(e) => setState((s) => ({ ...s, display_name: e.target.value }))} placeholder="ex: Outlier Imóveis" className="h-8 text-sm mt-1" />
          </div>
          <div>
            <Label className="text-xs">Nome do agente</Label>
            <Input value={state.agent_name} onChange={(e) => setState((s) => ({ ...s, agent_name: e.target.value }))} placeholder="ex: Áureo" className="h-8 text-sm mt-1" />
          </div>
          <div>
            <Label className="text-xs">Cargo / papel</Label>
            <Input value={state.agent_role} onChange={(e) => setState((s) => ({ ...s, agent_role: e.target.value }))} placeholder="ex: SDR da Outlier Consórcios" className="h-8 text-sm mt-1" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Campos de Coleta ({state.data_fields.length})</CardTitle>
            <Button variant="outline" size="sm" onClick={addField}><Plus className="size-3.5 mr-1.5" />Adicionar campo</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {state.data_fields.length === 0 && <p className="text-sm text-slate-400 text-center py-4">Nenhum campo configurado.</p>}
          {state.data_fields.map((field, idx) => (
            <FieldEditor
              key={idx} field={field} isRequired={state.required_fields.includes(field.key)}
              index={idx} total={state.data_fields.length}
              onUpdate={(p) => updateField(idx, p)} onToggleRequired={() => toggleRequired(field.key)}
              onRemove={() => removeField(idx)} onMoveUp={() => moveField(idx, -1)} onMoveDown={() => moveField(idx, 1)}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Classificação SPIN (QUENTE / MORNO / FRIO)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {(["quente", "morno", "frio"] as const).map((tier) => (
            <div key={tier}>
              <Label className={`text-xs font-semibold ${tier === "quente" ? "text-green-600" : tier === "morno" ? "text-yellow-600" : "text-slate-500"}`}>
                {tier.toUpperCase()}
              </Label>
              <Textarea
                value={state.classification[tier]}
                onChange={(e) => setState((s) => ({ ...s, classification: { ...s.classification, [tier]: e.target.value } }))}
                placeholder={tier === "quente" ? "Ex: Objetivo claro, prazo curto, valor informado" : tier === "morno" ? "Ex: Interesse real mas pesquisando" : "Ex: Curioso sem prazo, pouca intenção"}
                rows={2} className="mt-1 text-sm resize-none"
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function TemplateCard({ template, onEdit, onClone, onDelete }: { template: ChatbotTemplate; onEdit: () => void; onClone: () => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card className="border border-slate-200 dark:border-white/10">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Bot className="size-4 shrink-0 text-indigo-500" />
            <CardTitle className="truncate text-base">{template.display_name}</CardTitle>
            {template.is_builtin && <Badge variant="secondary" className="shrink-0 text-xs">built-in</Badge>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="size-7" onClick={onClone} title="Clonar"><Copy className="size-3.5" /></Button>
            {!template.is_builtin && (
              <>
                <Button variant="ghost" size="icon" className="size-7" onClick={onEdit} title="Editar"><Pencil className="size-3.5" /></Button>
                <Button variant="ghost" size="icon" className="size-7 text-red-500" onClick={onDelete} title="Deletar"><Trash2 className="size-3.5" /></Button>
              </>
            )}
            <Button variant="ghost" size="icon" className="size-7" onClick={() => setExpanded((v) => !v)}>
              {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </Button>
          </div>
        </div>
        <p className="text-xs text-slate-500">{template.agent_name}{template.agent_role && ` · ${template.agent_role}`}</p>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {template.data_fields.map((f) => (
              <Badge key={f.key} variant={template.required_fields.includes(f.key) ? "default" : "outline"} className="text-xs">
                {f.label}{template.required_fields.includes(f.key) ? " *" : ""}
              </Badge>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["quente", "morno", "frio"] as const).map((tier) => (
              <div key={tier} className="rounded-md border border-slate-100 dark:border-white/10 p-2">
                <p className={`text-xs font-semibold mb-1 ${tier === "quente" ? "text-green-600" : tier === "morno" ? "text-yellow-600" : "text-slate-500"}`}>
                  {tier.charAt(0).toUpperCase() + tier.slice(1)}
                </p>
                <p className="text-xs text-slate-500 line-clamp-2">{template.classification[tier] || "—"}</p>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export function TabTemplate({ clientId }: { clientId: string }) {
  const { data: templates = [], isLoading } = useChatbotTemplates(clientId);
  const [editing, setEditing] = useState<EditorState | null>(null);
  const deleteMutation = useDeleteChatbotTemplate();

  const builtins = templates.filter((t) => t.is_builtin);
  const custom = templates.filter((t) => !t.is_builtin);

  function cloneFromBuiltin(t: ChatbotTemplate): EditorState {
    return {
      clientId, client_id: clientId,
      template_key: `${t.template_key}_custom`,
      display_name: `${t.display_name} (cópia)`,
      agent_name: t.agent_name, agent_role: t.agent_role,
      data_fields: t.data_fields.map((f) => ({ ...f })),
      required_fields: [...t.required_fields],
      classification: { ...t.classification },
    };
  }

  async function handleDelete(t: ChatbotTemplate) {
    if (!confirm(`Deletar template "${t.display_name}"?`)) return;
    try {
      await deleteMutation.mutateAsync({ id: t.id, clientId });
      toast({ title: "Template deletado" });
    } catch (e) {
      toast({ title: "Erro ao deletar", description: String(e), variant: "destructive" });
    }
  }

  if (editing) {
    return <TemplateEditorPanel initial={editing} clientId={clientId} onClose={() => setEditing(null)} />;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditing(emptyTemplate(clientId))}>
          <Plus className="size-3.5 mr-1.5" />Novo template
        </Button>
      </div>

      {isLoading && <p className="text-sm text-slate-400 text-center py-8">Carregando templates…</p>}

      {!isLoading && builtins.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Templates Built-in</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {builtins.map((t) => (
              <TemplateCard key={t.id} template={t} onEdit={() => {}} onClone={() => setEditing(cloneFromBuiltin(t))} onDelete={() => {}} />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Templates Personalizados {custom.length > 0 && <span className="normal-case font-normal">({custom.length})</span>}
        </h3>
        {!isLoading && custom.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10 py-12 gap-3">
            <Bot className="size-8 text-slate-300" />
            <p className="text-sm text-slate-400">Nenhum template personalizado ainda.</p>
            <Button variant="outline" size="sm" onClick={() => setEditing(emptyTemplate(clientId))}>
              <Plus className="size-3.5 mr-1.5" />Criar template
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {custom.map((t) => (
              <TemplateCard
                key={t.id} template={t}
                onEdit={() => setEditing({ clientId, client_id: t.client_id, template_key: t.template_key, display_name: t.display_name, agent_name: t.agent_name, agent_role: t.agent_role, data_fields: t.data_fields, required_fields: t.required_fields, classification: t.classification })}
                onClone={() => setEditing(cloneFromBuiltin(t))}
                onDelete={() => handleDelete(t)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
