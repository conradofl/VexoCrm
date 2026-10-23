import React, { useState } from "react";
import { DeliverableItem, DeliverableStatus, FunnelStageId } from "@/hooks/useClientPortal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  Search,
  Eye,
  Wrench,
  Calendar,
  Sparkles,
} from "lucide-react";

interface PortalDeliverablesListProps {
  items: DeliverableItem[];
  selectedStage: FunnelStageId | "todos";
  onSelectItem: (item: DeliverableItem) => void;
  onApproveItem: (itemId: string) => void;
}

export const PortalDeliverablesList: React.FC<PortalDeliverablesListProps> = ({
  items,
  selectedStage,
  onSelectItem,
  onApproveItem,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<DeliverableStatus | "todos">("todos");

  // Filtra por estágio, termo de busca e status
  const filteredItems = items.filter((item) => {
    if (selectedStage !== "todos" && item.stage !== selectedStage) {
      return false;
    }
    if (statusFilter !== "todos" && item.status !== statusFilter) {
      return false;
    }
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const matchCode = item.code.toLowerCase().includes(term);
      const matchTitle = item.title.toLowerCase().includes(term);
      const matchFormat = item.format.toLowerCase().includes(term);
      if (!matchCode && !matchTitle && !matchFormat) {
        return false;
      }
    }
    return true;
  });

  const getStatusBadge = (status: DeliverableStatus) => {
    switch (status) {
      case "publicado":
        return (
          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 gap-1 text-[11px] font-semibold py-0.5">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            Publicado
          </Badge>
        );
      case "aguardando_aprovacao":
        return (
          <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 gap-1 text-[11px] font-bold py-0.5 animate-pulse">
            <AlertCircle className="w-3 h-3 text-amber-400" />
            Aguardando Aprovação
          </Badge>
        );
      case "em_producao":
        return (
          <Badge className="bg-sky-500/20 text-sky-300 border-sky-500/30 gap-1 text-[11px] font-semibold py-0.5">
            <Clock className="w-3 h-3 text-sky-400" />
            Em Produção
          </Badge>
        );
      case "ajuste_solicitado":
        return (
          <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 gap-1 text-[11px] font-semibold py-0.5">
            <Wrench className="w-3 h-3 text-purple-400" />
            Ajuste Solicitado
          </Badge>
        );
      default:
        return (
          <Badge className="bg-slate-700/50 text-slate-300 border-slate-600 gap-1 text-[11px] font-medium py-0.5">
            <FileText className="w-3 h-3 text-slate-400" />
            Roteiro Pronto
          </Badge>
        );
    }
  };

  return (
    <section className="space-y-4">
      {/* Search & Status Filters Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900/80 p-4 rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por código (V01), tema ou formato..."
            className="pl-9 bg-slate-950 border-slate-800 text-xs text-white placeholder:text-slate-500 h-9"
          />
        </div>

        {/* Quick Filter Buttons */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 text-xs">
          <button
            onClick={() => setStatusFilter("todos")}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
              statusFilter === "todos"
                ? "bg-slate-800 text-white font-semibold"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Todos
          </button>
          <button
            onClick={() => setStatusFilter("aguardando_aprovacao")}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap flex items-center gap-1 transition-colors ${
              statusFilter === "aguardando_aprovacao"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold"
                : "text-amber-400/80 hover:text-amber-300"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            Para Aprovar
          </button>
          <button
            onClick={() => setStatusFilter("publicado")}
            className={`px-3 py-1.5 rounded-lg whitespace-nowrap flex items-center gap-1 transition-colors ${
              statusFilter === "publicado"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold"
                : "text-emerald-400/80 hover:text-emerald-300"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Publicados
          </button>
        </div>
      </div>

      {/* Deliverables Cards Timeline */}
      {filteredItems.length === 0 ? (
        <div className="text-center py-12 bg-slate-900/40 border border-slate-800 rounded-xl p-6">
          <FileText className="w-8 h-8 text-slate-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-300">
            Nenhuma peça encontrada com os filtros selecionados
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Experimente limpar a busca ou selecionar outra etapa do funil.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filteredItems.map((item) => {
            const isPendingApproval = item.status === "aguardando_aprovacao";

            return (
              <div
                key={item.id}
                className={`group rounded-xl p-4 sm:p-5 transition-all duration-200 border flex flex-col justify-between ${
                  isPendingApproval
                    ? "bg-gradient-to-br from-amber-950/20 via-slate-900 to-slate-900 border-amber-500/50 shadow-lg shadow-amber-950/20 ring-1 ring-amber-500/30"
                    : "bg-slate-900/70 border-slate-800 hover:border-slate-700 hover:bg-slate-900"
                }`}
              >
                <div>
                  {/* Card Top: Code, Stage & Status */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        {item.code}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                        {item.stage}
                      </span>
                    </div>
                    {getStatusBadge(item.status)}
                  </div>

                  {/* Title & Preview of Hook */}
                  <h3 className="text-sm sm:text-base font-bold text-white group-hover:text-indigo-200 transition-colors leading-snug">
                    {item.title}
                  </h3>

                  <p className="mt-1.5 text-xs text-slate-400 line-clamp-2 italic">
                    "{item.hook}"
                  </p>

                  {/* Date & Format Metadata */}
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-400 border-t border-slate-800/80 pt-2.5">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                      <span>{item.date} ({item.dayOfWeek})</span>
                    </span>
                    <span>•</span>
                    <span className="text-slate-300 font-medium">
                      {item.format}
                    </span>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onSelectItem(item)}
                    className="text-xs bg-slate-800/60 border-slate-700 text-slate-200 hover:bg-indigo-600 hover:text-white hover:border-indigo-500 gap-1.5 flex-1 sm:flex-none"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Ver Roteiro & Preview</span>
                  </Button>

                  {/* Immediate Approval button if pending */}
                  {isPendingApproval && (
                    <Button
                      size="sm"
                      onClick={() => onApproveItem(item.id)}
                      className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold gap-1 shadow-sm"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Aprovar</span>
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
