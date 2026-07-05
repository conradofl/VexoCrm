import { useState } from "react";
import {
  Search,
  LayoutDashboard,
  Users,
  FileSpreadsheet,
  MessageSquare,
  Bot,
  UserRound,
  Building2,
  Megaphone,
  Globe,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface ChecklistPanelProps {
  title: string;
  description: string;
  items: string[];
  selected: string[];
  disabled: boolean;
  emptyMessage: string;
  searchPlaceholder?: string;
  onToggle: (item: string, checked: boolean) => void;
  onSelectAll?: () => void;
  onClear?: () => void;
  renderLabel: (item: string) => string;
  renderHint?: (item: string) => string | null;
}

function getPermissionIcon(item: string, active: boolean) {
  const cnIcon = cn(
    "h-5 w-5 transition-transform duration-300 group-hover:scale-110",
    active ? "text-primary-foreground" : "text-muted-foreground"
  );

  const key = item.toLowerCase();

  if (key.startsWith("dashboard")) return <LayoutDashboard className={cnIcon} />;
  if (key.startsWith("leads")) return <Users className={cnIcon} />;
  if (key.startsWith("planilhas") || key.includes("imports")) return <FileSpreadsheet className={cnIcon} />;
  if (key.startsWith("whatsapp")) return <MessageSquare className={cnIcon} />;
  if (key.startsWith("agente")) return <Bot className={cnIcon} />;
  if (key.startsWith("usuarios") || key.includes("users")) return <UserRound className={cnIcon} />;
  if (key.startsWith("empresas") || key.includes("tenants")) return <Building2 className={cnIcon} />;
  if (key.startsWith("campanhas") || key.includes("campaigns")) return <Megaphone className={cnIcon} />;

  return <Globe className={cnIcon} />;
}

export function ChecklistPanel({
  title,
  description,
  items,
  selected,
  disabled,
  emptyMessage,
  searchPlaceholder,
  onToggle,
  onSelectAll,
  onClear,
  renderLabel,
  renderHint,
}: ChecklistPanelProps) {
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    if (!term) return true;

    const label = renderLabel(item).toLowerCase();
    const hint = renderHint?.(item)?.toLowerCase() || "";
    return label.includes(term) || hint.includes(term);
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-bold text-foreground tracking-tight">{title}</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{description}</p>
        </div>

        <div className="flex items-center gap-1.5 bg-muted/10 border border-border/40 p-1 rounded-xl">
          <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary rounded-lg font-semibold px-2 py-0.5 text-[10px]">
            {selected.length} selecionados
          </Badge>

          {onSelectAll ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="rounded-lg font-medium px-2 h-7 text-[10px] hover:bg-background/80"
              disabled={disabled || items.length === 0}
              onClick={onSelectAll}
            >
              Marcar todos
            </Button>
          ) : null}

          {onClear ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="rounded-lg font-medium px-2 h-7 text-[10px] hover:bg-background/80 text-muted-foreground hover:text-destructive"
              disabled={disabled || selected.length === 0}
              onClick={onClear}
            >
              Limpar
            </Button>
          ) : null}
        </div>
      </div>

      {items.length > 6 ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/80" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={searchPlaceholder || "Filtrar por nome ou descrição..."}
            className="pl-9 h-9 text-xs rounded-xl bg-background/50 border-border/60 focus-visible:ring-primary/20 focus-visible:border-primary/50"
          />
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="text-center py-8 rounded-xl border border-dashed border-border/60 bg-muted/5">
          <ShieldAlert className="h-6 w-6 text-muted-foreground mx-auto mb-2 opacity-60" />
          <p className="text-xs text-muted-foreground font-medium">{emptyMessage}</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-8 rounded-xl border border-dashed border-border/60 bg-muted/5">
          <Search className="h-6 w-6 text-muted-foreground mx-auto mb-2 opacity-60" />
          <p className="text-xs text-muted-foreground font-medium">Nenhum módulo corresponde ao termo buscado.</p>
        </div>
      ) : (
        <ScrollArea className="max-h-[360px] pr-2">
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
            {filteredItems.map((item, index) => {
              const isSelected = selected.includes(item);
              return (
                <div
                  key={item}
                  onClick={() => {
                    if (!disabled) {
                      onToggle(item, !isSelected);
                    }
                  }}
                  className={cn(
                    "flex items-center justify-between py-2 px-3.5 rounded-xl border transition-all duration-200 cursor-pointer select-none",
                    isSelected
                      ? "border-primary/25 bg-primary/[0.03] shadow-sm"
                      : "border-border/40 bg-background/30 hover:border-border/80 hover:bg-muted/5",
                    disabled && "opacity-60 cursor-not-allowed"
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors border",
                      isSelected ? "text-primary bg-primary/10 border-primary/20" : "text-muted-foreground bg-muted/40 border-border/40"
                    )}>
                      {getPermissionIcon(item, isSelected)}
                    </div>
                    <div className="space-y-0.5 min-w-0">
                      <span className={cn(
                        "block font-semibold text-xs transition-colors",
                        isSelected ? "text-primary" : "text-foreground"
                      )}>
                        {renderLabel(item)}
                      </span>
                      {renderHint?.(item) ? (
                        <span className="block text-[10px] text-muted-foreground/80 truncate max-w-[160px]">
                          {renderHint(item)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <Switch
                    checked={isSelected}
                    disabled={disabled}
                    className="scale-75 data-[state=checked]:bg-primary"
                  />
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
