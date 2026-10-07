import React from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, UserCheck, UserX } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { LeadImportAnalysisResult } from "@/hooks/useLeadImports";

export type DuplicateStrategy = "merge" | "skip" | "overwrite";

interface DuplicateDecisionCardProps {
  analysis: LeadImportAnalysisResult;
  strategy: DuplicateStrategy;
  onStrategyChange: (strategy: DuplicateStrategy) => void;
  className?: string;
}

export function DuplicateDecisionCard({
  analysis,
  strategy,
  onStrategyChange,
  className,
}: DuplicateDecisionCardProps) {
  if (!analysis || analysis.duplicateCount === 0) return null;

  return (
    <div
      data-testid="duplicate-decision-card"
      className={cn(
        "rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3.5 transition-all text-xs",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <h4 className="font-bold text-foreground text-sm flex items-center gap-1.5">
              Detector Inteligente de Duplicados
            </h4>
            <p className="text-[11px] text-muted-foreground">
              Foram identificados contatos que já constam na base. Selecione a estratégia de tratamento:
            </p>
          </div>
        </div>
      </div>

      {/* Badges de Contagem */}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <span
          data-testid="badge-new-leads"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {analysis.newCount.toLocaleString("pt-BR")} leads novos
        </span>
        <span
          data-testid="badge-duplicate-leads"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          {analysis.duplicateCount.toLocaleString("pt-BR")} já existem no Banco de Dados
          {analysis.duplicatesByPhone > 0 || analysis.duplicatesByName > 0 ? (
            <span className="font-normal opacity-85 text-[11px]">
              ({analysis.duplicatesByPhone > 0 ? `${analysis.duplicatesByPhone} por telefone` : ""}
              {analysis.duplicatesByPhone > 0 && analysis.duplicatesByName > 0 ? ", " : ""}
              {analysis.duplicatesByName > 0 ? `${analysis.duplicatesByName} por nome` : ""})
            </span>
          ) : null}
        </span>
      </div>

      {/* Amostras de Duplicados Encontrados */}
      {analysis.sampleDuplicates && analysis.sampleDuplicates.length > 0 && (
        <div className="p-2.5 rounded-lg bg-background/60 border border-border space-y-1">
          <span className="text-[11px] font-semibold text-muted-foreground block">
            Exemplos encontrados no banco de dados:
          </span>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {analysis.sampleDuplicates.slice(0, 5).map((sample, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted/50 border border-border/60 text-foreground"
              >
                <strong>{sample.nome || "Sem nome"}</strong> ({sample.telefone})
                {sample.existingTags && sample.existingTags.length > 0 && (
                  <span className="text-muted-foreground">[{sample.existingTags.join(", ")}]</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Opções de Estratégia de Importação */}
      <RadioGroup
        value={strategy}
        onValueChange={(val) => onStrategyChange(val as DuplicateStrategy)}
        className="grid gap-2 pt-1"
        data-testid="duplicate-strategy-options"
      >
        {/* 1. Merge (Recomendado) */}
        <Label
          htmlFor="strategy-merge"
          className={cn(
            "flex items-start gap-3 p-3 rounded-lg border transition-all cursor-pointer",
            strategy === "merge"
              ? "border-emerald-500/50 bg-emerald-500/10 shadow-sm"
              : "border-border hover:bg-muted/40"
          )}
        >
          <RadioGroupItem value="merge" id="strategy-merge" className="mt-0.5" data-testid="radio-strategy-merge" />
          <div className="space-y-0.5 flex-1">
            <span className="font-bold text-foreground text-xs flex items-center gap-1.5">
              <UserCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              Atualizar e Mesclar (Recomendado)
            </span>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Mantém o histórico do lead, preenche dados vazios e adiciona as novas tags da planilha sem criar linhas duplicadas.
            </p>
          </div>
        </Label>

        {/* 2. Skip */}
        <Label
          htmlFor="strategy-skip"
          className={cn(
            "flex items-start gap-3 p-3 rounded-lg border transition-all cursor-pointer",
            strategy === "skip"
              ? "border-amber-500/50 bg-amber-500/10 shadow-sm"
              : "border-border hover:bg-muted/40"
          )}
        >
          <RadioGroupItem value="skip" id="strategy-skip" className="mt-0.5" data-testid="radio-strategy-skip" />
          <div className="space-y-0.5 flex-1">
            <span className="font-bold text-foreground text-xs flex items-center gap-1.5">
              <UserX className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              Ignorar Repetidos
            </span>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Importa apenas os {analysis.newCount.toLocaleString("pt-BR")} leads novos. Os contatos que já existem no banco permanecem inalterados.
            </p>
          </div>
        </Label>

        {/* 3. Overwrite */}
        <Label
          htmlFor="strategy-overwrite"
          className={cn(
            "flex items-start gap-3 p-3 rounded-lg border transition-all cursor-pointer",
            strategy === "overwrite"
              ? "border-purple-500/50 bg-purple-500/10 shadow-sm"
              : "border-border hover:bg-muted/40"
          )}
        >
          <RadioGroupItem value="overwrite" id="strategy-overwrite" className="mt-0.5" data-testid="radio-strategy-overwrite" />
          <div className="space-y-0.5 flex-1">
            <span className="font-bold text-foreground text-xs flex items-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
              Substituir Cadastro
            </span>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Sobrescreve os dados existentes com as informações fornecidas nesta planilha.
            </p>
          </div>
        </Label>
      </RadioGroup>
    </div>
  );
}
