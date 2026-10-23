import React from "react";
import { FunnelStage, FunnelStageId } from "@/hooks/useClientPortal";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Flame, Eye, Award, ShoppingCart, Filter } from "lucide-react";

interface PortalFunnelProgressProps {
  stages: FunnelStage[];
  selectedStage: FunnelStageId | "todos";
  onSelectStage: (stage: FunnelStageId | "todos") => void;
  totalDeliverables: number;
  completedDeliverables: number;
}

export const PortalFunnelProgress: React.FC<PortalFunnelProgressProps> = ({
  stages,
  selectedStage,
  onSelectStage,
  totalDeliverables,
  completedDeliverables,
}) => {
  const percentCompleted =
    totalDeliverables > 0
      ? Math.round((completedDeliverables / totalDeliverables) * 100)
      : 0;

  const getStageIcon = (id: FunnelStageId) => {
    switch (id) {
      case "atrair":
        return <Eye className="w-4 h-4 text-sky-400" />;
      case "apresentar":
        return <Flame className="w-4 h-4 text-amber-400" />;
      case "provar":
        return <Award className="w-4 h-4 text-indigo-400" />;
      case "converter":
        return <ShoppingCart className="w-4 h-4 text-emerald-400" />;
    }
  };

  const getStageBorderColor = (id: FunnelStageId, isSelected: boolean) => {
    if (!isSelected) return "border-slate-800 hover:border-slate-700 bg-slate-900/60";
    switch (id) {
      case "atrair":
        return "border-sky-500 bg-sky-950/30 ring-1 ring-sky-500/50";
      case "apresentar":
        return "border-amber-500 bg-amber-950/30 ring-1 ring-amber-500/50";
      case "provar":
        return "border-indigo-500 bg-indigo-950/30 ring-1 ring-indigo-500/50";
      case "converter":
        return "border-emerald-500 bg-emerald-950/30 ring-1 ring-emerald-500/50";
    }
  };

  return (
    <section className="space-y-4">
      {/* Top Banner: Global Completion Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2.5">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <h2 className="text-base font-semibold text-white">
              Evolução da Esteira de Produção & Funil
            </h2>
          </div>
          <div className="flex items-center gap-2 text-xs sm:text-sm font-medium">
            <span className="text-slate-400">Progresso Geral:</span>
            <span className="text-emerald-400 font-bold text-sm sm:text-base">
              {percentCompleted}%
            </span>
            <span className="text-slate-500">
              ({completedDeliverables} de {totalDeliverables} peças prontas)
            </span>
          </div>
        </div>
        <Progress value={percentCompleted} className="h-2.5 bg-slate-800" />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/60 text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-indigo-400" />
            <span>Filtre as entregas por etapa do funil clicando nos cards abaixo:</span>
          </div>
          <button
            onClick={() => onSelectStage("todos")}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              selectedStage === "todos"
                ? "bg-indigo-600 text-white font-semibold shadow-sm"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}
          >
            Ver Todas as Peças ({totalDeliverables})
          </button>
        </div>
      </div>

      {/* 4 Funnel Stages Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {stages.map((stage) => {
          const isSelected = selectedStage === stage.id;
          const stagePct =
            stage.totalVideos > 0
              ? Math.round((stage.completedVideos / stage.totalVideos) * 100)
              : 0;

          return (
            <button
              key={stage.id}
              onClick={() => onSelectStage(isSelected ? "todos" : stage.id)}
              className={`text-left rounded-xl p-4 transition-all duration-200 border cursor-pointer ${getStageBorderColor(
                stage.id,
                isSelected
              )}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded">
                    {stage.number}
                  </span>
                  <div className="flex items-center gap-1.5 font-bold text-sm text-white">
                    {getStageIcon(stage.id)}
                    <span>{stage.name}</span>
                  </div>
                </div>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                  {stage.completedVideos}/{stage.totalVideos}
                </span>
              </div>

              <p className="mt-2 text-xs text-slate-400 line-clamp-1">
                {stage.subtitle}
              </p>

              <div className="mt-3 space-y-1">
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>Conclusão</span>
                  <span className="font-semibold text-slate-300">{stagePct}%</span>
                </div>
                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                    style={{ width: `${stagePct}%` }}
                  />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
};
