import { useState } from "react";
import { ChevronDown, ChevronUp, Copy, Pencil, Trash2, Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChatbotTemplate } from "@/hooks/useChatbotTemplates";

export function TemplateCard({
  template,
  onEdit,
  onClone,
  onDelete,
}: {
  template: ChatbotTemplate;
  onEdit: () => void;
  onClone: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="border border-slate-200 dark:border-white/10">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Bot className="size-4 shrink-0 text-indigo-500" />
            <CardTitle className="truncate text-base">{template.display_name}</CardTitle>
            {template.is_builtin && (
              <Badge variant="secondary" className="shrink-0 text-xs">
                built-in
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="size-7" onClick={onClone} title="Clonar como base">
              <Copy className="size-3.5" />
            </Button>
            {!template.is_builtin && (
              <>
                <Button variant="ghost" size="icon" className="size-7" onClick={onEdit} title="Editar">
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-red-500 hover:text-red-600"
                  onClick={onDelete}
                  title="Deletar"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon" className="size-7" onClick={() => setExpanded((v) => !v)}>
              {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </Button>
          </div>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {template.agent_name && <span className="font-medium">{template.agent_name}</span>}
          {template.agent_role && ` · ${template.agent_role}`}
        </p>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0 space-y-3">
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Campos ({template.data_fields.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {template.data_fields.map((f) => (
                <Badge
                  key={f.key}
                  variant={template.required_fields.includes(f.key) ? "default" : "outline"}
                  className="text-xs"
                >
                  {f.label}
                  {template.required_fields.includes(f.key) ? " *" : ""}
                </Badge>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["quente", "morno", "frio"] as const).map((tier) => (
              <div key={tier} className="rounded-md border border-slate-100 dark:border-white/10 p-2">
                <p
                  className={`text-xs font-semibold mb-1 ${
                    tier === "quente" ? "text-green-600" : tier === "morno" ? "text-yellow-600" : "text-slate-500"
                  }`}
                >
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
