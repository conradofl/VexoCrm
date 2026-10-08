// frontend/src/components/leads/LeadCustomFieldsSection.tsx
// Pilar 4: Seção de "Campos Personalizados / Informações Comerciais" no Drawer de Detalhes do Lead
// Exibe os campos preenchidos, badge "🤖 Preenchido pela IA" e edição rápida via lápis para operadores humanos.

import React, { useState } from "react";
import { Sparkles, Pencil, Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCustomFieldLabel, isFieldAiExtracted, isFieldManuallyEdited } from "@/lib/leads/aiExtractedFields";

export interface LeadCustomFieldsSectionProps {
  lead: {
    id: string;
    nome?: string | null;
    dados?: {
      campos?: Record<string, any>;
      ai_extracted_fields?: string[];
      manual_fields?: string[];
      [key: string]: any;
    } | null;
    [key: string]: any;
  };
  onUpdateField?: (key: string, value: string) => Promise<void> | void;
  onTriggerAiExtraction?: () => Promise<void> | void;
  isExtractingAi?: boolean;
}

export const LeadCustomFieldsSection: React.FC<LeadCustomFieldsSectionProps> = ({
  lead,
  onUpdateField,
  onTriggerAiExtraction,
  isExtractingAi = false,
}) => {
  const dados = lead?.dados || {};
  const campos = (dados.campos && typeof dados.campos === "object") ? dados.campos : {};
  const aiExtractedList = dados.ai_extracted_fields || [];
  const manualFieldsList = dados.manual_fields || [];

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);

  const entries = Object.entries(campos).filter(([k]) => Boolean(k && k.trim()));

  const handleStartEdit = (key: string, currentValue: any) => {
    setEditingKey(key);
    setEditValue(currentValue !== null && currentValue !== undefined ? String(currentValue) : "");
  };

  const handleCancelEdit = () => {
    setEditingKey(null);
    setEditValue("");
  };

  const handleSaveEdit = async (key: string) => {
    if (!onUpdateField) return;
    setIsSaving(true);
    try {
      await onUpdateField(key, editValue.trim());
      setEditingKey(null);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-2 pt-3 border-t border-border" data-testid="lead-custom-fields-section">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
          <span>Campos Personalizados / Informações Comerciais</span>
        </label>

        {onTriggerAiExtraction && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onTriggerAiExtraction}
            disabled={isExtractingAi}
            className="h-6 px-2 text-[11px] gap-1 text-purple-700 dark:text-purple-300 hover:bg-purple-500/10"
            title="Analisar a conversa com IA e preencher a ficha comercial automaticamente"
          >
            {isExtractingAi ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Extraindo...</span>
              </>
            ) : (
              <>
                <span>🤖</span>
                <span>Extrair com IA</span>
              </>
            )}
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-center space-y-2">
          <p className="text-xs text-muted-foreground italic">
            Nenhuma informação comercial anotada nesta ficha ainda.
          </p>
          {onTriggerAiExtraction && (
            <Button
              size="sm"
              variant="outline"
              onClick={onTriggerAiExtraction}
              disabled={isExtractingAi}
              className="h-7 text-xs gap-1.5 border-purple-500/30 text-purple-700 dark:text-purple-300 hover:bg-purple-500/10"
            >
              {isExtractingAi ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Analisando mensagens...</span>
                </>
              ) : (
                <>
                  <span>🤖</span>
                  <span>Preencher Ficha com IA</span>
                </>
              )}
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-muted/40 p-2.5 space-y-2 text-xs">
          {entries.map(([key, val]) => {
            const label = formatCustomFieldLabel(key);
            const isAi = isFieldAiExtracted(key, aiExtractedList);
            const isManual = isFieldManuallyEdited(key, manualFieldsList);
            const isEditing = editingKey === key;

            return (
              <div
                key={key}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 py-1 px-1.5 rounded hover:bg-background/60 transition-colors"
                data-testid={`custom-field-row-${key}`}
              >
                {/* Cabeçalho da Chave e Badges */}
                <div className="flex items-center gap-1.5 min-w-[130px] flex-wrap">
                  <span className="text-muted-foreground font-medium text-xs">
                    {label}:
                  </span>

                  {isAi && (
                    <span
                      data-testid={`ai-badge-${key}`}
                      className="inline-flex items-center gap-1 bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/30 text-[10px] px-1.5 py-0.5 rounded font-medium"
                    >
                      🤖 Preenchido pela IA
                    </span>
                  )}

                  {isManual && !isAi && (
                    <span
                      data-testid={`manual-badge-${key}`}
                      className="inline-flex items-center gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-[10px] px-1.5 py-0.5 rounded font-medium"
                    >
                      ✍️ Validado
                    </span>
                  )}
                </div>

                {/* Valor ou Formulário de Edição Inline */}
                <div className="flex items-center gap-1.5 flex-1 justify-end">
                  {isEditing ? (
                    <div className="flex items-center gap-1 w-full sm:max-w-[240px]">
                      <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleSaveEdit(key);
                          } else if (e.key === "Escape") {
                            handleCancelEdit();
                          }
                        }}
                        className="h-7 text-xs px-2"
                        autoFocus
                        disabled={isSaving}
                      />
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => handleSaveEdit(key)}
                        disabled={isSaving}
                        className="h-7 w-7 p-0 bg-emerald-600 hover:bg-emerald-700 text-white"
                        title="Salvar alteração"
                      >
                        {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleCancelEdit}
                        disabled={isSaving}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                        title="Cancelar"
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 max-w-full truncate">
                      <span
                        className="font-semibold text-foreground truncate max-w-[180px] sm:max-w-[220px]"
                        title={String(val ?? "")}
                      >
                        {val !== null && val !== undefined && String(val).trim() !== "" ? String(val) : "—"}
                      </span>

                      {onUpdateField && (
                        <button
                          type="button"
                          onClick={() => handleStartEdit(key, val)}
                          className="text-muted-foreground/60 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5 rounded transition-colors"
                          title={`Editar ${label}`}
                          aria-label={`Editar ${label}`}
                          data-testid={`edit-btn-${key}`}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
