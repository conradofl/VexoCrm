import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/hooks/useNotifications";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface NotificationBellProps {
  collapsed?: boolean;
}

export function NotificationBell({ collapsed }: NotificationBellProps) {
  const { items, unreadCount, error, markAsRead, markAllRead } = useNotifications();

  const handleClick = (item: { id: string; link: string | null; read: boolean }) => {
    if (!item.read) markAsRead(item.id);
    if (item.link) window.open(item.link, "_blank");
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "relative flex w-full text-sm transition-colors",
            collapsed
              ? "h-10 items-center justify-center rounded-xl px-0"
              : "items-center gap-2.5 rounded-xl px-3 py-2.5",
            "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-sidebar-foreground dark:hover:bg-white/[0.04] dark:hover:text-sidebar-accent-foreground"
          )}
        >
          <Bell className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Notificacoes</span>}
          {unreadCount > 0 && (
            <span
              className={cn(
                "absolute h-2 min-w-[8px] rounded-full bg-primary shadow-[0_0_10px_rgba(99,102,241,0.8)]",
                collapsed ? "right-2 top-2" : "right-2.5 top-2.5"
              )}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-80 border-slate-200/90 bg-white p-0 text-foreground dark:border-white/10 dark:bg-[#090b17]">
        <div className="flex items-center justify-between border-b border-slate-200/80 p-3 dark:border-white/8">
          <h4 className="text-sm font-semibold text-foreground">Notificacoes</h4>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-7 rounded-full text-xs" onClick={markAllRead}>
              <CheckCheck className="mr-1 h-3 w-3" />
              Marcar todas como lidas
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-[320px]">
          {error ? (
            <div className="space-y-1 p-6 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Notificacoes indisponiveis</p>
              <p className="text-xs leading-5">{error}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">Nenhuma notificacao</div>
          ) : (
            <div className="divide-y divide-slate-200/80 dark:divide-white/8">
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleClick(item)}
                  className={cn(
                    "flex w-full gap-2 px-3 py-2.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]",
                    !item.read && "bg-primary/6"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-xs leading-snug", !item.read && "font-medium text-foreground")}>{item.title}</p>
                    {item.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(item.created_at), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </p>
                  </div>
                  {item.link && <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
