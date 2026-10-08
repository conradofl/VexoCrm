// frontend/src/components/followup/LeadReactivationCard.tsx
// Card de Configuração Inteligente: Reativação Automática de Leads Parados (Pilar 2)

import { useEffect, useState } from "react";
import {
  Sparkles,
  Zap,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Send,
  ShieldAlert,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useLeadReactivationSettings,
  useUpdateLeadReactivationSettings,
  useRunLeadReactivation,
} from "@/hooks/useLeadReactivation";

interface LeadReactivationCardProps {
  clientId?: string;
  className?: string;
}

export function LeadReactivationCard({ clientId, className }: LeadReactivationCardProps) {
  const { data, isLoading, refetch } = useLeadReactivationSettings(clientId);
  const updateSettings = useUpdateLeadReactivationSettings();
  const runReactivation = useRunLeadReactivation();

  const [enabled, setEnabled] = useState(false);
  const [stalledDays, setStalledDays] = useState(7);
  const [cadenceId, setCadenceId] = useState<string>("");
  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Sincroniza estado com os dados remotos
  useEffect(() => {
    if (data) {
      setEnabled(data.reactivation_enabled);
      setStalledDays(data.reactivation_stalled_days || 7);
      setCadenceId(data.reactivation_cadence_id || "");
    }
  }, [data]);

  const handleSave = async (
    override?: {
      enabled?: boolean;
      stalledDays?: number;
      cadenceId?: string;
    }
  ) => {
    if (!clientId) return;

    const newEnabled = override?.enabled !== undefined ? override.enabled : enabled;
    const newDays = override?.stalledDays !== undefined ? override.stalledDays : stalledDays;
    const newCadence = override?.cadenceId !== undefined ? override.cadenceId : cadenceId;

    try {
      setFeedbackMessage(null);
      await updateSettings.mutateAsync({
        clientId,
        reactivation_enabled: newEnabled,
        reactivation_stalled_days: Number(newDays) || 7,
        reactivation_cadence_id: newCadence ? newCadence : null,
        reactivation_cooldown_days: data?.reactivation_cooldown_days || 30,
      });
      setFeedbackMessage({
        type: "success",
        text: "Configurações de reativação salvas com sucesso!",
      });
    } catch (err: any) {
      setFeedbackMessage({
        type: "error",
        text: err?.message || "Falha ao salvar configurações de reativação.",
      });
    }
  };

  const handleToggle = (checked: boolean) => {
    setEnabled(checked);
    handleSave({ enabled: checked });
  };

  const handleRunNow = async () => {
    if (!clientId) return;
    try {
      setFeedbackMessage(null);
      const res = await runReactivation.mutateAsync({ clientId });
      if (res.success) {
        setFeedbackMessage({
          type: "success",
          text: `Reativação executada! ${res.reactivated_count} lead(s) inscrito(s) na cadência de resgate.`,
        });
        refetch();
      } else {
        setFeedbackMessage({
          type: "error",
          text: res.message || "Não foi possível executar a reativação.",
        });
      }
    } catch (err: any) {
      setFeedbackMessage({
        type: "error",
        text: err?.message || "Erro ao executar reativação sob demanda.",
      });
    }
  };

  const cadences = data?.cadences || [];
  const eligibleCount = data?.eligible_count ?? 0;
  const reactivatedLast30Days = data?.reactivated_last_30_days ?? 0;

  return (
    <Card
      className={`border-indigo-500/20 bg-gradient-to-br from-card via-card to-indigo-950/10 shadow-sm ${className || ""}`}
    >
      <CardHeader className="p-4 pb-3 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <Zap className="h-4 w-4" />
            </span>
            <div>
              <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                Reativação Automática de Leads Parados (Regra de Resgate)
                <Badge
                  variant="outline"
                  className={
                    enabled
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10.5px] px-1.5 py-0"
                      : "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300 text-[10.5px] px-1.5 py-0"
                  }
                >
                  {enabled ? "Ativa" : "Desativada"}
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Nenhum lead esquecido: o CRM inscreve contatos inativos em cadência de follow-up sem ação manual do vendedor.
              </CardDescription>
            </div>
          </div>

          <div className="flex items-center gap-2.5 bg-background/80 px-3 py-1.5 rounded-lg border border-border/60">
            <Label htmlFor="toggle-reactivation" className="text-xs font-semibold cursor-pointer">
              Ativar Reativação Automática
            </Label>
            <Switch
              id="toggle-reactivation"
              checked={enabled}
              onCheckedChange={handleToggle}
              disabled={isLoading || updateSettings.isPending}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-0 space-y-4">
        {feedbackMessage && (
          <div
            className={`flex items-center gap-2 text-xs p-2.5 rounded-lg border ${
              feedbackMessage.type === "success"
                ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200 border-emerald-500/30"
                : "bg-destructive/10 text-destructive border-destructive/30"
            }`}
          >
            {feedbackMessage.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span>{feedbackMessage.text}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Seletor de Cadência */}
          <div className="space-y-1.5">
            <Label htmlFor="reactivation-cadence" className="text-xs font-semibold flex items-center gap-1.5">
              <Send className="h-3.5 w-3.5 text-indigo-500" />
              Cadência de Follow-up (Resgate)
            </Label>
            <Select
              value={cadenceId}
              onValueChange={(val) => {
                setCadenceId(val);
                handleSave({ cadenceId: val });
              }}
              disabled={isLoading || updateSettings.isPending}
            >
              <SelectTrigger id="reactivation-cadence" className="h-9 text-xs bg-background">
                <SelectValue placeholder="Selecione a cadência" />
              </SelectTrigger>
              <SelectContent>
                {cadences.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cadences.length === 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Nenhuma cadência ativa encontrada. Crie uma cadência no Passo 2 acima.
              </p>
            )}
          </div>

          {/* Dias de Inatividade */}
          <div className="space-y-1.5">
            <Label htmlFor="stalled-days-input" className="text-xs font-semibold flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-amber-500" />
              Disparar após X dias sem resposta
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="stalled-days-input"
                type="number"
                min={1}
                max={90}
                value={stalledDays}
                onChange={(e) => setStalledDays(parseInt(e.target.value, 10) || 7)}
                onBlur={() => handleSave({ stalledDays })}
                disabled={isLoading || updateSettings.isPending}
                className="h-9 text-xs bg-background w-24"
              />
              <span className="text-xs text-muted-foreground">dias de inatividade</span>
            </div>
          </div>

          {/* Contador de Impacto */}
          <div className="rounded-lg border border-border/60 bg-background/50 p-2.5 flex flex-col justify-center">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                Impacto da Automação
              </span>
              <Badge variant="secondary" className="text-xs font-bold px-2 py-0.5">
                {reactivatedLast30Days}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {reactivatedLast30Days === 1
                ? "1 lead reativado automaticamente nos últimos 30 dias"
                : `${reactivatedLast30Days} leads reativados automaticamente nos últimos 30 dias`}
            </p>
          </div>
        </div>

        {/* Rodapé com Ação Rápida e Info de Cooldown */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/50">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
            <span>
              Proteção anti-looping: cooldown de {data?.reactivation_cooldown_days || 30} dias para não reinscrever o mesmo contato.
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRunNow}
              disabled={isLoading || runReactivation.isPending || !cadenceId}
              className="h-8 text-xs font-semibold gap-1.5 border-indigo-500/30 hover:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${runReactivation.isPending ? "animate-spin" : ""}`}
              />
              Testar / Executar Reativação Agora
              <Badge
                variant="secondary"
                className="ml-1 text-[10px] px-1.5 py-0 bg-indigo-500/20 text-indigo-800 dark:text-indigo-200"
              >
                {eligibleCount} elegíveis
              </Badge>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
