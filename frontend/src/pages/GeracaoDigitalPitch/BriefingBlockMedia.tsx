import React, { useState } from "react";
import { TrendingUp, ChevronDown, ChevronUp, Check } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { BriefingField } from "@/lib/geracaoDigital/types";

interface BriefingBlockMediaProps {
  briefingFields: BriefingField[];
  onUpdateField: (fieldId: string, value: string) => void;
}

export function BriefingBlockMedia({ briefingFields, onUpdateField }: BriefingBlockMediaProps) {
  const [isOpen, setIsOpen] = useState(true);

  const mediaIds = [
    "objetivo_trafego",
    "verba",
    "verba_periodicidade",
    "divisao_verba",
    "tipo_pagamento",
    "ticket_margem",
    "ja_rodou_trafego",
    "trafego_historico",
    "produtos_trafego",
    "sazonalidade",
  ];

  const blockFields = briefingFields.filter((f) => mediaIds.includes(f.id));
  const completedCount = blockFields.filter((f) => f.value && f.value.trim().length > 0).length;

  const getField = (id: string) => briefingFields.find((f) => f.id === id);

  const objetivoField = getField("objetivo_trafego");
  const verbaField = getField("verba");
  const verbaPeriodicidadeField = getField("verba_periodicidade");
  const divisaoVerbaField = getField("divisao_verba");
  const tipoPagamentoField = getField("tipo_pagamento");
  const ticketMargemField = getField("ticket_margem");
  const jaRodouField = getField("ja_rodou_trafego");
  const trafegoHistoricoField = getField("trafego_historico");
  const produtosTrafegoField = getField("produtos_trafego");
  const sazonalidadeField = getField("sazonalidade");

  // Parse checkboxes list
  const parseSelectedList = (val: string): string[] => {
    if (!val) return [];
    if (val.includes("; ")) return val.split("; ").map((x) => x.trim()).filter(Boolean);
    return val.split(", ").map((x) => x.trim()).filter(Boolean);
  };

  const selectedObjetivos = parseSelectedList(objetivoField?.value || "");

  const handleToggleObjetivo = (opt: string) => {
    let list = [...selectedObjetivos];
    if (list.includes(opt)) {
      list = list.filter((x) => x !== opt);
    } else {
      list.push(opt);
    }
    onUpdateField("objetivo_trafego", list.join("; "));
  };

  const renderRadioGroup = (field?: BriefingField) => {
    if (!field) return null;
    return (
      <div className="space-y-1.5">
        <Label className="text-xs font-bold text-slate-800 dark:text-slate-200">{field.label}</Label>
        <div className="flex flex-wrap gap-2">
          {field.options?.map((opt) => {
            const isSelected = field.value === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onUpdateField(field.id, opt)}
                className={cn(
                  "text-xs font-medium py-1.5 px-3 rounded-xl border transition-all duration-150 cursor-pointer select-none",
                  isSelected
                    ? "bg-purple-600 text-white border-purple-600 shadow-xs"
                    : "bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900"
                )}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-xs overflow-hidden transition-all">
      <CardHeader
        className="p-5 flex flex-row items-center justify-between cursor-pointer select-none bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-100/60 dark:hover:bg-slate-800/60 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center justify-center font-bold">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <CardTitle className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              Bloco C · Estratégia de Mídia & Tráfego
            </CardTitle>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Orçamento de anúncios, objetivos, canais (Meta/Google) e histórico.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge
            className={cn(
              "font-mono text-xs font-semibold px-2.5 py-0.5 border",
              completedCount >= blockFields.length
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700"
            )}
          >
            {completedCount}/{blockFields.length} preenchidos
          </Badge>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
            aria-label="Expandir ou recolher"
          >
            {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
        </div>
      </CardHeader>

      {isOpen && (
        <CardContent className="p-6 space-y-6">
          {/* Objetivos do Tráfego */}
          {objetivoField && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  {objetivoField.label}
                </Label>
                {selectedObjetivos.length > 0 && (
                  <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
                    {selectedObjetivos.length} objetivos
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {objetivoField.options?.map((opt) => {
                  const isSelected = selectedObjetivos.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => handleToggleObjetivo(opt)}
                      className={cn(
                        "text-xs font-medium px-3 py-1.5 rounded-xl border transition-all duration-150 cursor-pointer select-none text-left",
                        isSelected
                          ? "bg-purple-600 text-white border-purple-600 shadow-xs"
                          : "bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900"
                      )}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Verba e Divisão */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
            {verbaField && (
              <div className="space-y-1.5">
                <Label htmlFor={verbaField.id} className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {verbaField.label}
                </Label>
                <Input
                  id={verbaField.id}
                  value={verbaField.value || ""}
                  onChange={(e) => onUpdateField(verbaField.id, e.target.value)}
                  placeholder="Ex: R$ 3.000 / mês"
                  className="h-10 text-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
            )}

            {divisaoVerbaField && (
              <div className="space-y-1.5">
                <Label htmlFor={divisaoVerbaField.id} className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {divisaoVerbaField.label}
                </Label>
                <Input
                  id={divisaoVerbaField.id}
                  value={divisaoVerbaField.value || ""}
                  onChange={(e) => onUpdateField(divisaoVerbaField.id, e.target.value)}
                  placeholder="Ex: 70% Meta e 30% Google"
                  className="h-10 text-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
            )}

            {ticketMargemField && (
              <div className="space-y-1.5">
                <Label htmlFor={ticketMargemField.id} className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {ticketMargemField.label}
                </Label>
                <Input
                  id={ticketMargemField.id}
                  value={ticketMargemField.value || ""}
                  onChange={(e) => onUpdateField(ticketMargemField.id, e.target.value)}
                  placeholder="Ex: R$ 500 com 45% margem"
                  className="h-10 text-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                />
              </div>
            )}

            {verbaPeriodicidadeField && renderRadioGroup(verbaPeriodicidadeField)}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            {tipoPagamentoField && renderRadioGroup(tipoPagamentoField)}
            {jaRodouField && renderRadioGroup(jaRodouField)}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            {produtosTrafegoField && (
              <div className="space-y-1.5">
                <Label htmlFor={produtosTrafegoField.id} className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {produtosTrafegoField.label}
                </Label>
                <textarea
                  id={produtosTrafegoField.id}
                  value={produtosTrafegoField.value || ""}
                  onChange={(e) => onUpdateField(produtosTrafegoField.id, e.target.value)}
                  placeholder={produtosTrafegoField.placeholder}
                  className="w-full h-24 p-3 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 outline-none leading-relaxed resize-none shadow-2xs focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10"
                />
              </div>
            )}

            {trafegoHistoricoField && (
              <div className="space-y-1.5">
                <Label htmlFor={trafegoHistoricoField.id} className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {trafegoHistoricoField.label}
                </Label>
                <textarea
                  id={trafegoHistoricoField.id}
                  value={trafegoHistoricoField.value || ""}
                  onChange={(e) => onUpdateField(trafegoHistoricoField.id, e.target.value)}
                  placeholder={trafegoHistoricoField.placeholder}
                  className="w-full h-24 p-3 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 outline-none leading-relaxed resize-none shadow-2xs focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10"
                />
              </div>
            )}

            {sazonalidadeField && (
              <div className="space-y-1.5">
                <Label htmlFor={sazonalidadeField.id} className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  {sazonalidadeField.label}
                </Label>
                <textarea
                  id={sazonalidadeField.id}
                  value={sazonalidadeField.value || ""}
                  onChange={(e) => onUpdateField(sazonalidadeField.id, e.target.value)}
                  placeholder={sazonalidadeField.placeholder}
                  className="w-full h-24 p-3 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 outline-none leading-relaxed resize-none shadow-2xs focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10"
                />
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
