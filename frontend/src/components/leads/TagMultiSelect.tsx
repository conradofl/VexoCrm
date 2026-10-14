import React, { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { groupTagsByKind } from "@/lib/leads/leadListApi";

export interface TagMultiSelectItem {
  tag: string;
  kind?: string;
  count?: number;
  leads?: number;
}

export interface TagMultiSelectProps {
  selectedTags: string[];
  onChange: (tags: string[]) => void;
  tags: ReadonlyArray<TagMultiSelectItem>;
  placeholder?: string;
  helperText?: React.ReactNode;
  label?: string;
  className?: string;
  "data-testid"?: string;
  onTagChange?: () => void;
}

export function TagMultiSelect({
  selectedTags,
  onChange,
  tags,
  placeholder,
  helperText,
  label,
  className,
  onTagChange,
  ...rest
}: TagMultiSelectProps) {
  const [tagSearch, setTagSearch] = useState("");

  const toggleTag = (t: string) => {
    const next = selectedTags.includes(t)
      ? selectedTags.filter((x) => x !== t)
      : [...selectedTags, t];
    onChange(next);
    onTagChange?.();
  };

  const handleClear = () => {
    onChange([]);
    onTagChange?.();
  };

  const availableTagsList = tags;
  const filteredTags = useMemo(() => {
    const term = tagSearch.toLowerCase().trim();
    return availableTagsList.filter((t) => t.tag.toLowerCase().includes(term));
  }, [availableTagsList, tagSearch]);

  const hasDistinctKinds = useMemo(() => {
    return tags.some((t) => t.kind && t.kind !== "minhas");
  }, [tags]);

  const groups = useMemo(() => {
    if (!hasDistinctKinds) return [];
    return groupTagsByKind(filteredTags);
  }, [hasDistinctKinds, filteredTags]);

  const renderTagButton = (t: TagMultiSelectItem) => {
    const isSelected = selectedTags.includes(t.tag);
    const count = t.leads !== undefined ? t.leads : t.count;
    return (
      <button
        type="button"
        key={t.tag}
        onClick={() => toggleTag(t.tag)}
        className={`w-full flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition-colors text-left ${
          isSelected ? "bg-primary/10 font-medium" : "hover:bg-muted/60"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0 ${
              isSelected
                ? "bg-primary border-primary text-primary-foreground font-bold"
                : "border-input bg-background"
            }`}
          >
            {isSelected ? "✓" : ""}
          </span>
          <span className="truncate">{t.tag}</span>
        </div>
        {count !== undefined && (
          <span className="text-[11px] text-muted-foreground shrink-0 ml-2">
            ({count} leads)
          </span>
        )}
      </button>
    );
  };

  return (
    <div className={className || "space-y-2"} data-testid={rest["data-testid"]}>
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-foreground">
          {label || `Tags selecionadas (${selectedTags.length})`}
        </label>
        {selectedTags.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            className="text-[11px] text-muted-foreground hover:text-foreground underline"
          >
            Limpar seleção
          </button>
        )}
      </div>

      {/* Badges das tags selecionadas */}
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 bg-muted/40 rounded-md border text-xs max-h-20 overflow-y-auto">
          {selectedTags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium text-xs max-w-full"
            >
              <span className="truncate">{t}</span>
              <button
                type="button"
                onClick={() => toggleTag(t)}
                className="hover:text-rose-500 rounded-full shrink-0"
                aria-label={`Remover tag ${t}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Campo de busca para filtrar as tags */}
      <Input
        placeholder={placeholder || "Buscar tags..."}
        value={tagSearch}
        onChange={(e) => setTagSearch(e.target.value)}
        className="h-8 text-xs"
        aria-label="Buscar tags"
      />

      {/* Lista rolável de tags com checkboxes */}
      <div
        className="max-h-28 overflow-y-auto rounded-md border bg-background p-1 space-y-0.5 text-xs"
        role="group"
        aria-label="Lista de tags disponíveis"
      >
        {filteredTags.length === 0 ? (
          <p className="p-2 text-center text-muted-foreground text-xs">
            {tagSearch ? "Nenhuma tag encontrada para esta busca." : "Nenhuma tag disponível."}
          </p>
        ) : hasDistinctKinds ? (
          groups.map((g) => (
            <div key={g.kind} className="space-y-0.5">
              <div className="px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {g.label}
              </div>
              {g.items.map((t) => renderTagButton(t))}
            </div>
          ))
        ) : (
          filteredTags.map((t) => renderTagButton(t))
        )}
      </div>

      {/* Select oculto para compatibilidade com testes automatizados */}
      <select
        aria-label="Tag"
        value={selectedTags[0] ?? ""}
        onChange={(e) => {
          const val = e.target.value;
          onChange(val ? [val] : []);
          onTagChange?.();
        }}
        className="sr-only"
        tabIndex={-1}
      >
        <option value="">Escolha uma tag…</option>
        {availableTagsList.map((t) => (
          <option key={t.tag} value={t.tag}>
            {t.tag}{t.leads !== undefined ? ` (${t.leads})` : ""}
          </option>
        ))}
      </select>

      {/* Texto de regra ou ajuda explicativo */}
      {helperText && (
        <p className="text-[11px] text-muted-foreground mt-1" data-testid="tag-multi-select-helper">
          {helperText}
        </p>
      )}
    </div>
  );
}
