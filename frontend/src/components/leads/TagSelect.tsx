import { groupTagsByKind } from "@/lib/leads/leadListApi";

interface TagItem {
  tag: string;
  kind?: string;
}

interface TagSelectProps {
  value: string;
  onChange: (value: string) => void;
  tags: ReadonlyArray<TagItem>;
  className?: string;
  "data-testid"?: string;
}

/**
 * Seletor de tag AGRUPADO por tipo (Planilhas, Grupos e origem, Rótulos da IA, Minhas). Só muda a apresentação: nenhuma tag some e nenhum dado
 * muda — a procedência, o palpite da IA e a marcação da pessoa deixam de aparecer misturados numa lista só.
 */
export function TagSelect({ value, onChange, tags, className, ...rest }: TagSelectProps) {
  const groups = groupTagsByKind(tags);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className} data-testid={rest["data-testid"]}>
      <option value="">Todas as Tags</option>
      {groups.map((g) => (
        <optgroup key={g.kind} label={g.label} data-testid={`tag-group-${g.kind}`}>
          {g.tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
