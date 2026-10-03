import { Users, MessageCircleOff, Trophy, HeartPulse, Timer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMetricNumber } from "@/lib/dashboard/formatters";
import type { DashboardAnalysis, TemperatureKey } from "@/hooks/useDashboard";

interface Block4AnalysisProps {
  // undefined = payload gravado antes da análise existir; cada medida pode ser null (indisponível)
  analysis?: DashboardAnalysis;
}

const TEMPERATURE_LABELS: Record<TemperatureKey, string> = {
  QUENTE: "Quente",
  MORNO: "Morno",
  FRIO: "Frio",
  SEM_CLASSIFICACAO: "Sem classificação",
};

// Uma linha, na tela, quando o cliente não registra conversões: o ranking continua, sem a coluna.
export const NO_CLOSINGS_NOTICE = "Fechamentos não entram neste cliente: ele não registra conversões.";

const STAGE_LABELS: Record<string, string> = {
  buyer: "Compraram",
  open_budget: "Orçamento aberto",
  inquiry: "Em atendimento",
  cold: "Sem avanço",
  lost: "Perdidos",
  sem_estagio: "Sem estágio",
};

export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

// Medida que não pôde ser calculada: nunca zero.
function Unavailable() {
  return (
    <div role="status" className="py-6 text-center text-xs text-muted-foreground">
      Indisponível — não foi possível calcular agora
    </div>
  );
}

function Stat({ label, value, hint, alert }: { label: string; value: string; hint?: string; alert?: boolean }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <p className={`text-xl font-extrabold tracking-tight ${alert ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>
        {value}
      </p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Block4Analysis({ analysis }: Block4AnalysisProps) {
  if (!analysis) return null;
  const { leadClassification, firstReplyOnly, topProfiles, baseHealth, firstHumanResponse } = analysis;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Quem são os leads e como estão sendo atendidos · Análise
        </h2>
        <p className="text-xs text-muted-foreground">Leads, perfis que convertem, saúde da base e velocidade de atendimento</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* 1. Leads do período por temperatura e estágio */}
        <Card className="rounded-2xl border border-border/80 shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-foreground">
              <Users className="h-3.5 w-3.5 text-indigo-500" />
              Leads do período
            </CardTitle>
            <CardDescription className="text-[11px]">Por temperatura e por estágio</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 pb-4">
            {leadClassification === null ? (
              <Unavailable />
            ) : (
              <div className="space-y-3">
                <Stat label="Leads que chegaram" value={formatMetricNumber(leadClassification.total)} />
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {(Object.keys(TEMPERATURE_LABELS) as TemperatureKey[]).map((key) => (
                    <div key={key} className="flex items-center justify-between rounded-lg border border-border/60 px-2 py-1">
                      <span className="text-muted-foreground">{TEMPERATURE_LABELS[key]}</span>
                      <span className="font-bold text-foreground">{formatMetricNumber(leadClassification.byTemperature[key])}</span>
                    </div>
                  ))}
                </div>
                <div className="divide-y divide-border/50 text-xs">
                  {leadClassification.byStage.map((s) => (
                    <div key={s.stage} className="flex items-center justify-between py-1">
                      <span className="text-muted-foreground">{STAGE_LABELS[s.stage] ?? s.stage}</span>
                      <span className="font-bold text-foreground">{formatMetricNumber(s.count)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 2. Responderam só a primeira e pararam */}
        <Card className="rounded-2xl border border-border/80 shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-foreground">
              <MessageCircleOff className="h-3.5 w-3.5 text-amber-500" />
              Responderam só a primeira
            </CardTitle>
            <CardDescription className="text-[11px]">Separa interesse de curiosidade</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 pb-4">
            {firstReplyOnly === null ? (
              <Unavailable />
            ) : (
              <div className="space-y-3">
                <Stat
                  label="Pararam depois da primeira resposta"
                  value={firstReplyOnly.stoppedRate == null ? "—" : `${firstReplyOnly.stoppedRate}%`}
                  hint={
                    firstReplyOnly.stoppedRate == null
                      ? "Ninguém recebeu o passo seguinte ainda"
                      : `${formatMetricNumber(firstReplyOnly.stoppedAfterFirst)} de ${formatMetricNumber(firstReplyOnly.receivedFollowUp)} que receberam o passo seguinte`
                  }
                />
                <p className="text-[11px] text-muted-foreground">
                  {formatMetricNumber(firstReplyOnly.repliedFirst)} responderam ao primeiro envio do período;{" "}
                  {formatMetricNumber(firstReplyOnly.receivedFollowUp)} receberam outro envio de campanha depois.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3. Perfil que mais converteu */}
        <Card className="rounded-2xl border border-border/80 shadow-xs">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-foreground">
                <Trophy className="h-3.5 w-3.5 text-emerald-500" />
                Perfil que mais converteu
              </CardTitle>
              {topProfiles && (
                <Badge variant="outline" className="text-[10px] text-muted-foreground font-normal">
                  Min. {topProfiles.minLeads} leads
                </Badge>
              )}
            </div>
            <CardDescription className="text-[11px]">
              {topProfiles?.closingsAvailable === false
                ? "Temperatura × origem: responderam e agendaram"
                : "Temperatura × origem: responderam, agendaram, fecharam"}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 pb-4">
            {topProfiles === null ? (
              <Unavailable />
            ) : topProfiles.top.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground space-y-1">
                <p>Nenhum perfil com {topProfiles.minLeads}+ leads no período</p>
                {topProfiles.closingsAvailable === false && <p className="text-[10px]">{NO_CLOSINGS_NOTICE}</p>}
              </div>
            ) : (
              <div className="divide-y divide-border/50 text-xs">
                {topProfiles.top.map((p, idx) => (
                  <div key={`${p.temperature}-${p.origin}`} className="py-2 space-y-0.5">
                    <p className="font-semibold text-foreground">
                      {idx + 1}. {TEMPERATURE_LABELS[p.temperature] ?? p.temperature} ·{" "}
                      {p.origin === "sem_origem" ? "Sem origem" : p.origin}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatMetricNumber(p.leads)} leads · {p.replyRate}% responderam · {p.scheduleRate}% agendaram
                      {topProfiles.closingsAvailable !== false && p.closeRate != null && <> · {p.closeRate}% fecharam</>}
                    </p>
                  </div>
                ))}
                {topProfiles.closingsAvailable === false && (
                  <p className="py-2 text-[10px] text-muted-foreground">{NO_CLOSINGS_NOTICE}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 4. Saúde da base */}
        <Card className="rounded-2xl border border-border/80 shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-foreground">
              <HeartPulse className="h-3.5 w-3.5 text-rose-500" />
              Saúde da base
            </CardTitle>
            <CardDescription className="text-[11px]">Toda a base de leads, não só o período</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 pb-4">
            {baseHealth === null ? (
              <Unavailable />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Leads na base" value={formatMetricNumber(baseHealth.total)} />
                <Stat
                  label="Com telefone válido"
                  value={formatMetricNumber(baseHealth.validPhone)}
                  hint={`${formatMetricNumber(baseHealth.invalidPhone)} sem telefone válido`}
                />
                <Stat label="Nunca abordados" value={formatMetricNumber(baseHealth.neverApproached)} hint="com telefone válido" />
                <Stat
                  label={`Sem resposta há ${baseHealth.silenceDays}+ dias`}
                  value={formatMetricNumber(baseHealth.noReplyOverDays)}
                  hint="abordados há mais de 90 dias"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* 5. Tempo até a primeira resposta humana */}
        <Card className="rounded-2xl border border-border/80 shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-foreground">
              <Timer className="h-3.5 w-3.5 text-sky-500" />
              Primeira resposta humana
            </CardTitle>
            <CardDescription className="text-[11px]">Do lead responder até alguém da equipe responder</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 pb-4">
            {firstHumanResponse === null ? (
              <Unavailable />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  label="Tempo típico (mediana)"
                  value={formatMinutes(firstHumanResponse.medianMinutes)}
                  hint={
                    firstHumanResponse.p90Minutes == null
                      ? "Ninguém foi respondido ainda"
                      : `9 em 10 em até ${formatMinutes(firstHumanResponse.p90Minutes)}`
                  }
                />
                <Stat
                  label="Esperando resposta"
                  value={formatMetricNumber(firstHumanResponse.waiting)}
                  hint={`de ${formatMetricNumber(firstHumanResponse.conversations)} conversas`}
                />
                <Stat
                  label={`Esperando há mais de ${firstHumanResponse.thresholdHours} h`}
                  value={formatMetricNumber(firstHumanResponse.waitingOverThreshold)}
                  alert={firstHumanResponse.waitingOverThreshold > 0}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
