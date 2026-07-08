import { CheckSquare, Square, TrendingUp } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CHECKLIST_DAYS } from "@/lib/aquecimento/constants";

export function TabChecklist({
  activeClientId,
  checkedTasks,
  toggleTask,
}: {
  activeClientId: string;
  checkedTasks: Record<string, boolean>;
  toggleTask: (taskKey: string) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Explanatory Banner */}
      <div className="p-4 rounded-xl border border-blue-200/40 bg-blue-500/5 flex items-start gap-3 text-xs leading-relaxed">
        <TrendingUp className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
        <div className="space-y-1 text-slate-700 dark:text-white/80">
          <p className="font-bold text-blue-700 dark:text-blue-400">
            Importante: A Rotina Manual é Indispensável!
          </p>
          <p>
            Segundo as regras recomendadas no Notion, **nunca ative nenhuma automação nos primeiros 3 dias**. O comportamento inicial precisa ser 100% humano para não acionar alertas nos servidores do WhatsApp. Utilize o checklist abaixo para guiar a sua operação diária.
          </p>
        </div>
      </div>

      {/* Stepper Checklist Cards Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {CHECKLIST_DAYS.map((dayItem) => {
          const dayKeyPrefix = `${activeClientId}_day_${dayItem.day}`;
          const completedCount = dayItem.tasks.filter((t, i) => checkedTasks[`${dayKeyPrefix}_${i}`]).length;
          const isFullyCompleted = completedCount === dayItem.tasks.length;

          return (
            <Card
              key={dayItem.day}
              className={`border-slate-200/80 bg-white/90 shadow-sm rounded-2xl overflow-hidden transition-all duration-200 ${
                isFullyCompleted
                  ? "border-emerald-500/30 bg-emerald-500/[0.01] dark:border-emerald-500/20"
                  : ""
              }`}
            >
              <CardHeader className="pb-3 border-b border-slate-100 dark:border-white/5 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    {dayItem.title}
                  </CardTitle>
                  <CardDescription className="text-[10px]">
                    {completedCount} de {dayItem.tasks.length} tarefas completas
                  </CardDescription>
                </div>
                {isFullyCompleted && (
                  <Badge className="border border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 text-[9px] rounded-xl">
                    Concluído
                  </Badge>
                )}
              </CardHeader>
              <CardContent className="p-5 space-y-3.5">
                {dayItem.tasks.map((task, idx) => {
                  const taskKey = `${dayKeyPrefix}_${idx}`;
                  const isChecked = checkedTasks[taskKey] ?? false;

                  return (
                    <div
                      key={idx}
                      onClick={() => toggleTask(taskKey)}
                      className="flex items-start gap-2.5 text-xs text-foreground cursor-pointer select-none hover:opacity-85"
                    >
                      <div className="shrink-0 mt-0.5 text-indigo-500 dark:text-indigo-400">
                        {isChecked ? (
                          <CheckSquare className="h-4.5 w-4.5 fill-indigo-100 dark:fill-indigo-950/40" />
                        ) : (
                          <Square className="h-4.5 w-4.5" />
                        )}
                      </div>
                      <span className={`leading-normal ${isChecked ? "line-through text-muted-foreground" : "font-medium"}`}>
                        {task}
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
