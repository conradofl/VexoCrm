// VexoCrm/frontend/src/pages/Agente.tsx
import { useMemo, useState } from "react";
import { AlertTriangle, Search } from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageShell } from "@/components/PageShell";
import { FilterPanel } from "@/components/FilterPanel";
import { NotificationList } from "@/components/NotificationList";
import { EmptyState } from "@/components/EmptyState";
import { NotificationItem } from "@/components/NotificationItem";
import type { NotificationItemData } from "@/components/NotificationItem";

type ReadFilter = "all" | "unread" | "read";
type TypeFilter = "all" | "n8n_error" | "other";

export default function Agente() {
  const { items, unreadCount, loading, error, markAsRead, markAllRead } = useNotifications();
  const [search, setSearch] = useState("");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesRead =
        readFilter === "all" ||
        (readFilter === "unread" && !item.read) ||
        (readFilter === "read" && item.read);
      const matchesType =
        typeFilter === "all" ||
        (typeFilter === "n8n_error" && item.type === "n8n_error") ||
        (typeFilter === "other" && item.type !== "n8n_error");
      const matchesSearch =
        !normalizedSearch ||
        item.title.toLowerCase().includes(normalizedSearch) ||
        (item.description || "").toLowerCase().includes(normalizedSearch);
      return matchesRead && matchesType && matchesSearch;
    });
  }, [items, readFilter, search, typeFilter]);

  const handleNotificationClick = async (item: NotificationItemData) => {
    if (!item.read) await markAsRead(item.id);
    if (item.link) window.open(item.link, "_blank", "noopener,noreferrer");
  };

  // Unread counter shown in the sticky header (right side)
  const headerRight = (
    <div className="text-right">
      <p className="text-xs text-muted-foreground">Não lidas</p>
      <p className="text-sm font-semibold text-foreground">{unreadCount}</p>
    </div>
  );

  return (
    <PageShell
      title="Agente"
      subtitle="Monitoramento de erros e alertas do n8n"
      headerRight={headerRight}
      spacing="space-y-4"
    >
      <FilterPanel cols={4}>
        <div className="relative lg:col-span-2">
          <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por título ou descrição"
            className="pl-9"
          />
        </div>

        <Select value={readFilter} onValueChange={(v) => setReadFilter(v as ReadFilter)}>
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="unread">Não lidas</SelectItem>
            <SelectItem value="read">Lidas</SelectItem>
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger>
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="n8n_error">Erros n8n</SelectItem>
            <SelectItem value="other">Outros</SelectItem>
          </SelectContent>
        </Select>
      </FilterPanel>

      <NotificationList count={filteredItems.length} unreadCount={unreadCount} onMarkAllRead={markAllRead}>
        {loading ? (
          <EmptyState message="Carregando notificações..." />
        ) : error ? (
          <EmptyState
            icon={AlertTriangle}
            title="Notificacoes indisponiveis"
            description={error}
          />
        ) : filteredItems.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title="Nenhuma notificação encontrada"
            description="Ajuste os filtros ou aguarde novos eventos do n8n."
          />
        ) : (
          <div className="divide-y divide-border">
            {filteredItems.map((item) => (
              <NotificationItem
                key={item.id}
                item={item}
                onClick={() => void handleNotificationClick(item)}
              />
            ))}
          </div>
        )}
      </NotificationList>
    </PageShell>
  );
}
