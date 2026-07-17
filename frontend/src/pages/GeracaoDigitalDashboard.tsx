import { useNavigate } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { GeracaoDigitalTabs } from "@/components/GeracaoDigitalTabs";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  FileText,
  ClipboardList,
  FileSignature,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { useGdDashboard } from "@/hooks/useGdDashboard";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: number;
  caption?: string;
  accent?: "default" | "warning";
  loading?: boolean;
  onClick?: () => void;
}

function StatCard({ icon: Icon, label, value, caption, accent = "default", loading, onClick }: StatCardProps) {
  const isWarn = accent === "warning";
  return (
    <Card
      onClick={onClick}
      className={cn(
        "border shadow-sm transition-colors",
        onClick && "cursor-pointer hover:border-purple-400 dark:hover:border-purple-500",
        isWarn
          ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-500/30"
          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10"
      )}
    >
      <CardContent className="p-5 flex items-start gap-4">
        <div
          className={cn(
            "h-11 w-11 rounded-xl flex items-center justify-center shrink-0",
            isWarn ? "bg-amber-100 dark:bg-amber-500/20" : "bg-purple-100 dark:bg-purple-500/20"
          )}
        >
          <Icon className={cn("h-5 w-5", isWarn ? "text-amber-600 dark:text-amber-400" : "text-purple-650 dark:text-purple-300")} />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
          {loading ? (
            <div className="mt-1 h-8 w-16 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
          ) : (
            <p className={cn("text-3xl font-black leading-tight", isWarn ? "text-amber-700 dark:text-amber-300" : "text-slate-800 dark:text-slate-100")}>
              {value}
            </p>
          )}
          {caption && <p className="text-[11px] text-slate-400 dark:text-slate-450 mt-0.5">{caption}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function GeracaoDigitalDashboard() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useGdDashboard();

  return (
    <PageShell
      title="Dashboard Geração Digital"
      subtitle="Visão geral do módulo comercial GD: propostas, briefings, contratos e o que ainda falta fechar."
      icon={LayoutDashboard}
    >
      <GeracaoDigitalTabs />

      {isError ? (
        <Card className="border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-950/30">
          <CardContent className="p-5 text-sm text-red-700 dark:text-red-300">
            {(error as Error)?.message || "Erro ao carregar o dashboard."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={FileText}
            label="Propostas"
            value={data?.propostas ?? 0}
            caption="Total geradas"
            loading={isLoading}
            onClick={() => navigate("/crm/propostas-gd")}
          />
          <StatCard
            icon={ClipboardList}
            label="Briefings"
            value={data?.briefings ?? 0}
            caption="Coletados"
            loading={isLoading}
            onClick={() => navigate("/crm/geracao-digital?tab=briefings")}
          />
          <StatCard
            icon={FileSignature}
            label="Contratos"
            value={data?.contratos ?? 0}
            caption="Total criados"
            loading={isLoading}
            onClick={() => navigate("/crm/contratos-gd")}
          />
          <StatCard
            icon={AlertTriangle}
            label="Sem assinatura"
            value={data?.propostas_sem_assinatura ?? 0}
            caption="Propostas aguardando assinatura"
            accent="warning"
            loading={isLoading}
            onClick={() => navigate("/crm/propostas-gd")}
          />
        </div>
      )}
    </PageShell>
  );
}
