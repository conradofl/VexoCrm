import { MessageSquare, Smartphone, MapPin, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMetricNumber } from "@/lib/dashboard/formatters";
import type { DashboardPayload } from "@/hooks/useDashboard";

interface Block2RankingsProps {
  rankings: DashboardPayload["rankings"];
}

export function Block2Rankings({ rankings }: Block2RankingsProps) {
  // Garantir no máximo 3 linhas por ranking
  const topMessages = (rankings?.messages || []).slice(0, 3);
  const topChips = (rankings?.chips || []).slice(0, 3);
  const topRegions = (rankings?.regions || []).slice(0, 3);
  const failureReasons = (rankings?.failureReasons || []).slice(0, 3);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          O que está indo bem e o que não está · Rankings
        </h2>
        <p className="text-xs text-muted-foreground">
          Quatro rankings curtos, até três linhas cada, indicando onde investir ou intervir
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {/* 1. Mensagem */}
        <Card className="rounded-2xl border border-border/80 shadow-xs flex flex-col justify-between">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-foreground">
                <MessageSquare className="h-3.5 w-3.5 text-indigo-500" />
                Mensagens
              </CardTitle>
              <Badge variant="outline" className="text-[10px] text-muted-foreground font-normal">
                Min. 30 envios
              </Badge>
            </div>
            <CardDescription className="text-[11px]">
              Eficácia por taxa de resposta
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 pb-4 flex-1">
            {topMessages.length === 0 ? (
              <div className="h-28 flex items-center justify-center text-xs text-muted-foreground text-center px-2">
                Nenhuma mensagem com 30+ disparos no período
              </div>
            ) : (
              <div className="divide-y divide-border/50 text-xs">
                {topMessages.map((m: any, idx: number) => {
                  const name = m.campaign_name || m.name || "Mensagem sem título";
                  const sent = m.sent_count ?? m.sent ?? 0;
                  const replies = m.replied_count ?? m.replies ?? 0;
                  const rate = m.reply_rate ?? m.replyRate ?? 0;

                  return (
                    <div key={m.campaign_id || m.id || idx} className="py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground truncate" title={name}>
                          {idx + 1}. {name}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatMetricNumber(sent)} envios · {formatMetricNumber(replies)} respostas
                        </p>
                      </div>
                      <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
                        {rate}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 2. Chip */}
        <Card className="rounded-2xl border border-border/80 shadow-xs flex flex-col justify-between">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-foreground">
                <Smartphone className="h-3.5 w-3.5 text-emerald-500" />
                Chips WhatsApp
              </CardTitle>
              <Badge variant="outline" className="text-[10px] text-muted-foreground font-normal">
                Entrega & cota
              </Badge>
            </div>
            <CardDescription className="text-[11px]">
              Envios, respostas e cota consumida
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 pb-4 flex-1">
            {topChips.length === 0 ? (
              <div className="h-28 flex items-center justify-center text-xs text-muted-foreground text-center px-2">
                Nenhum disparo por chip no período
              </div>
            ) : (
              <div className="divide-y divide-border/50 text-xs">
                {topChips.map((c: any, idx: number) => {
                  const name = c.name || c.instanceName || "Instância";
                  const sent = c.sent ?? 0;
                  const replies = c.replies ?? 0;
                  const quotaText = c.quotaConsumedText || c.consumedQuotaText || `${c.sentToday || 0} de ${c.quotaLimit || 50}`;
                  const rate = c.replyRate ?? (sent > 0 ? Number(((replies / sent) * 100).toFixed(1)) : 0);

                  return (
                    <div key={c.instanceId || idx} className="py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground truncate" title={name}>
                          {idx + 1}. {name}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatMetricNumber(sent)} envios · cota: {quotaText}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs font-bold text-foreground">
                          {formatMetricNumber(replies)}
                        </span>
                        <span className="text-[10px] text-muted-foreground block">
                          ({rate}%)
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3. Região */}
        <Card className="rounded-2xl border border-border/80 shadow-xs flex flex-col justify-between">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-foreground">
                <MapPin className="h-3.5 w-3.5 text-amber-500" />
                Regiões
              </CardTitle>
              <Badge variant="outline" className="text-[10px] text-muted-foreground font-normal">
                DDD & Cidade
              </Badge>
            </div>
            <CardDescription className="text-[11px]">
              Concentração e resposta regional
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 pb-4 flex-1">
            {topRegions.length === 0 ? (
              <div className="h-28 flex items-center justify-center text-xs text-muted-foreground text-center px-2">
                Nenhum lead com região identificada
              </div>
            ) : (
              <div className="divide-y divide-border/50 text-xs">
                {topRegions.map((r: any, idx: number) => {
                  const title = r.label || (r.cidade ? `DDD ${r.ddd} · ${r.cidade}` : `DDD ${r.ddd}`);
                  const sent = r.sent ?? 0;
                  const replies = r.replies ?? 0;
                  const rate = r.replyRate ?? 0;

                  return (
                    <div key={`${r.ddd}-${r.cidade || ""}-${idx}`} className="py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground truncate" title={title}>
                          {idx + 1}. {title}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatMetricNumber(sent)} envios · {formatMetricNumber(replies)} respostas
                        </p>
                      </div>
                      <span className="text-xs font-bold text-amber-600 dark:text-amber-400 shrink-0">
                        {rate}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 4. Motivo de Falha (Soma 100%) */}
        <Card className="rounded-2xl border border-border/80 shadow-xs flex flex-col justify-between">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                Motivos de Falha
              </CardTitle>
              <Badge variant="outline" className="text-[10px] text-muted-foreground font-normal">
                Soma 100%
              </Badge>
            </div>
            <CardDescription className="text-[11px]">
              Por que os envios não chegaram
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 pb-4 flex-1">
            {failureReasons.length === 0 ? (
              <div className="h-28 flex items-center justify-center text-xs text-muted-foreground text-center px-2">
                Nenhuma falha de envio registrada
              </div>
            ) : (
              <div className="divide-y divide-border/50 text-xs">
                {failureReasons.map((f: any, idx: number) => (
                  <div key={f.reason || idx} className="py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground truncate" title={f.reason}>
                        {f.reason}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {formatMetricNumber(f.count)} ocorrências
                      </p>
                    </div>
                    <span className="text-xs font-mono font-bold text-red-600 dark:text-red-400 shrink-0">
                      {f.percentage}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
