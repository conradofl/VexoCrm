import { useState, useId } from "react";
import { Link } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  Download,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  MessageCircle,
  ExternalLink,
  AlertTriangle,
  PhoneOff,
  MessageSquareQuote,
} from "lucide-react";
import { useCampaignRecipients, type CampaignRecipientItem } from "@/hooks/useCampanhas";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/lib/api";
import { cn } from "@/lib/utils";

interface CampaignRecipientsDialogProps {
  campaignId: string | null;
  initialFilter?: string;
  onClose: () => void;
}

export function CampaignRecipientsDialog({
  campaignId,
  initialFilter = "all",
  onClose,
}: CampaignRecipientsDialogProps) {
  const [statusFilter, setStatusFilter] = useState<string>(initialFilter);
  const [searchQuery, setSearchQuery] = useState("");
  const [downloadingCsv, setDownloadingCsv] = useState(false);

  const { toast } = useToast();
  const { getIdToken } = useAuth();
  const searchInputId = useId();

  const { data, isLoading, isFetching } = useCampaignRecipients(
    campaignId,
    statusFilter,
    searchQuery
  );

  const handleDownloadCsv = async () => {
    if (!campaignId) return;
    try {
      setDownloadingCsv(true);
      const token = await getIdToken();
      const url = new URL(`${API_BASE_URL}/api/campaigns/${campaignId}/recipients`);
      url.searchParams.set("format", "csv");
      if (statusFilter && statusFilter !== "all") {
        url.searchParams.set("status", statusFilter);
      }
      if (searchQuery.trim()) {
        url.searchParams.set("search", searchQuery.trim());
      }

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("Falha ao exportar relatório CSV");

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      const fileName = `destinatarios-${(data?.campaignName || "campanha").replace(/[^a-zA-Z0-9_-]/g, "_")}.csv`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);

      toast({ title: "Relatório CSV baixado com sucesso" });
    } catch (err: any) {
      toast({ title: "Erro na exportação", description: err.message, variant: "destructive" });
    } finally {
      setDownloadingCsv(false);
    }
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try {
      return new Date(dateStr).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  const getStatusBadge = (item: CampaignRecipientItem) => {
    if (item.replied) {
      return (
        <Badge className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px] font-bold">
          <CheckCircle2 className="h-3 w-3 mr-1 text-emerald-600" />
          {item.repliedAt ? `Respondeu às ${new Date(item.repliedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Respondeu"}
        </Badge>
      );
    }

    switch (item.status) {
      case "sent":
        return (
          <Badge className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px] font-medium">
            <CheckCircle2 className="h-3 w-3 mr-1 text-emerald-600" /> Enviado
          </Badge>
        );
      case "invalid_number":
        return (
          <Badge className="border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-700 dark:bg-purple-900/30 dark:text-purple-400 text-[10px] font-bold">
            <PhoneOff className="h-3 w-3 mr-1 text-purple-600" /> Número inválido
          </Badge>
        );
      case "failed":
        return (
          <Badge className="border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-400 text-[10px] font-bold">
            <XCircle className="h-3 w-3 mr-1 text-rose-600" /> Falhou
          </Badge>
        );
      case "skipped":
        return (
          <Badge className="border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[10px] font-bold">
            <AlertTriangle className="h-3 w-3 mr-1 text-amber-600" /> Pulado
          </Badge>
        );
      case "claimed":
        return (
          <Badge className="border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-[10px] font-medium">
            <Clock className="h-3 w-3 mr-1 text-blue-600 animate-spin" /> Em envio
          </Badge>
        );
      case "pending":
      default:
        return (
          <Badge className="border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 text-[10px] font-medium">
            <Clock className="h-3 w-3 mr-1 text-slate-500" /> Na fila
          </Badge>
        );
    }
  };

  const recipients = data?.recipients || [];
  const counts = data?.counts || { all: 0, sent: 0, replied: 0, failed: 0, pending: 0 };

  return (
    <Dialog open={!!campaignId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col bg-white dark:bg-slate-900 border border-border shadow-2xl rounded-2xl p-6">
        <DialogHeader className="pb-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border/50">
          <div>
            <DialogTitle className="text-lg font-bold font-display text-foreground flex items-center gap-2">
              Destinatários da Campanha
              {data?.campaignName && (
                <span className="text-indigo-600 dark:text-indigo-400">“{data.campaignName}”</span>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-0.5">
              Total de <strong>{data?.total ?? "..."}</strong> destinatários mapeados em todos os lotes
            </DialogDescription>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="default"
              disabled={downloadingCsv || isLoading}
              onClick={handleDownloadCsv}
              className="h-8 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm gap-1.5"
            >
              {downloadingCsv ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Exportar CSV
            </Button>
          </div>
        </DialogHeader>

        {/* Filtros e Busca */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3">
          <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
            <Button
              size="sm"
              variant={statusFilter === "all" ? "default" : "outline"}
              onClick={() => setStatusFilter("all")}
              className={cn(
                "h-7 text-xs px-2.5 rounded-lg font-bold transition-colors",
                statusFilter === "all" && "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
              )}
            >
              Todos ({counts.all})
            </Button>
            <Button
              size="sm"
              variant={statusFilter === "sent" ? "default" : "outline"}
              onClick={() => setStatusFilter("sent")}
              className={cn(
                "h-7 text-xs px-2.5 rounded-lg font-bold transition-colors",
                statusFilter === "sent"
                  ? "bg-emerald-600 text-white"
                  : "text-emerald-600 border-emerald-300 dark:border-emerald-800"
              )}
            >
              Enviados ({counts.sent})
            </Button>
            <Button
              size="sm"
              variant={statusFilter === "replied" ? "default" : "outline"}
              onClick={() => setStatusFilter("replied")}
              className={cn(
                "h-7 text-xs px-2.5 rounded-lg font-bold transition-colors",
                statusFilter === "replied"
                  ? "bg-indigo-600 text-white"
                  : "text-indigo-600 border-indigo-300 dark:border-indigo-800"
              )}
            >
              Responderam ({counts.replied}) ✨
            </Button>
            <Button
              size="sm"
              variant={statusFilter === "failed" ? "default" : "outline"}
              onClick={() => setStatusFilter("failed")}
              className={cn(
                "h-7 text-xs px-2.5 rounded-lg font-bold transition-colors",
                statusFilter === "failed"
                  ? "bg-rose-600 text-white"
                  : "text-rose-600 border-rose-300 dark:border-rose-800"
              )}
            >
              Falharam ({counts.failed})
            </Button>
            <Button
              size="sm"
              variant={statusFilter === "pending" ? "default" : "outline"}
              onClick={() => setStatusFilter("pending")}
              className={cn(
                "h-7 text-xs px-2.5 rounded-lg font-bold transition-colors",
                statusFilter === "pending"
                  ? "bg-slate-600 text-white"
                  : "text-slate-600 border-slate-300 dark:border-slate-700"
              )}
            >
              Na Fila ({counts.pending})
            </Button>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <label htmlFor={searchInputId} className="sr-only">Buscar por nome ou telefone</label>
            <Input
              id={searchInputId}
              placeholder="Buscar por nome ou telefone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs rounded-xl"
            />
          </div>
        </div>

        {/* Tabela de Destinatários */}
        <div className="flex-1 overflow-y-auto mt-3 rounded-xl border border-border bg-slate-50/50 dark:bg-slate-900/40">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
              <p className="text-xs font-medium">Buscando destinatários da campanha...</p>
            </div>
          ) : recipients.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
              <p className="text-sm font-medium">Nenhum destinatário encontrado com os filtros atuais.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/60 hover:bg-transparent">
                  <TableHead className="w-12 text-xs font-bold text-center">#</TableHead>
                  <TableHead className="text-xs font-bold">Contato</TableHead>
                  <TableHead className="text-xs font-bold">Lote</TableHead>
                  <TableHead className="text-xs font-bold">Status & Resposta</TableHead>
                  <TableHead className="text-xs font-bold">Data de Envio</TableHead>
                  <TableHead className="text-xs font-bold text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recipients.map((item, idx) => {
                  const cleanPhone = (item.telefone || "").replace(/\D/g, "");
                  return (
                    <TableRow key={item.leadId ? `${item.leadId}-${idx}` : `row-${idx}`} className="border-b border-border/30 hover:bg-muted/10">
                      <TableCell className="text-center text-xs text-muted-foreground font-mono">{idx + 1}</TableCell>
                      <TableCell className="py-2.5">
                        <p className="text-xs font-bold text-foreground">{item.nome}</p>
                        <p className="text-[11px] text-muted-foreground font-mono">{item.telefone}</p>
                      </TableCell>
                      <TableCell className="py-2.5 text-xs text-muted-foreground font-medium">
                        {item.dispatchName || "—"}
                      </TableCell>
                      <TableCell className="py-2.5 max-w-[260px]">
                        <div className="space-y-1">
                          <div>{getStatusBadge(item)}</div>
                          {item.replied && item.lastInboundText && (
                            <p
                              className="text-[11px] text-muted-foreground italic flex items-start gap-1 line-clamp-2 mt-0.5"
                              title={item.lastInboundText}
                            >
                              <MessageSquareQuote className="h-3 w-3 shrink-0 text-indigo-500 mt-0.5" />
                              <span>“{item.lastInboundText}”</span>
                            </p>
                          )}
                          {!item.replied && item.failureReason && (
                            <p className="text-[10px] text-rose-600 dark:text-rose-400 font-semibold truncate" title={item.failureReason}>
                              {item.failureReason}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground py-2.5 font-mono">
                        {formatTime(item.sentAt)}
                      </TableCell>
                      <TableCell className="py-2.5 text-right">
                        {cleanPhone ? (
                          <Button
                            asChild
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-[11px] font-semibold gap-1 rounded-lg text-emerald-700 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950/30"
                          >
                            <Link
                              to={`/crm/whatsapp?chatId=${cleanPhone}&phone=${cleanPhone}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`Abrir conversa com ${item.nome || cleanPhone} no WhatsApp Inbox`}
                            >
                              <MessageCircle className="h-3 w-3" />
                              <span>Abrir no WhatsApp</span>
                              <ExternalLink className="h-2.5 w-2.5 opacity-60 ml-0.5" />
                            </Link>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter className="mt-3 flex items-center justify-between border-t border-border/50 pt-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />}
            <span>Exibindo {recipients.length} destinatários</span>
          </div>
          <Button onClick={onClose} variant="outline" className="h-8 text-xs font-bold rounded-xl px-4">
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
