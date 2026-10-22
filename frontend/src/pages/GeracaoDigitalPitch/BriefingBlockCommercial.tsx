import React, { useState } from "react";
import { MessageSquareText, ChevronDown, ChevronUp, Check, Users2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { BriefingField } from "@/lib/geracaoDigital/types";

interface BriefingBlockCommercialProps {
  briefingFields: BriefingField[];
  onUpdateField: (fieldId: string, value: string) => void;
  onUpdateSubfield: (fieldId: string, subfieldId: string, value: string) => void;
}

export function BriefingBlockCommercial({
  briefingFields,
  onUpdateField,
  onUpdateSubfield,
}: BriefingBlockCommercialProps) {
  const [isOpen, setIsOpen] = useState(true);

  // Lista dos IDs do Bloco B
  const commercialIds = [
    "concorrentes",
    "como_vende",
    "servicos",
    "mitos_perguntas_recorrentes",
    "temas",
    "base_existente",
    "publico_alvo",
    "dores_publico",
    "bloqueado",
    "inspiracao",
  ];

  const blockFields = briefingFields.filter((f) => commercialIds.includes(f.id));
  const completedCount = blockFields.filter((f) => f.value && f.value.trim().length > 0).length;

  const getField = (id: string) => briefingFields.find((f) => f.id === id);

  const concorrentesField = getField("concorrentes");
  const comoVendeField = getField("como_vende");
  const servicosField = getField("servicos");
  const mitosField = getField("mitos_perguntas_recorrentes");
  const temasField = getField("temas");
  const baseExistenteField = getField("base_existente");
  const publicoAlvoField = getField("publico_alvo");
  const doresPublicoField = getField("dores_publico");
  const bloqueadoField = getField("bloqueado");
  const inspiracaoField = getField("inspiracao");

  const renderTextareaField = (field?: BriefingField, minH = "h-24") => {
    if (!field) return null;
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={field.id} className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-tight">
            {field.label}
          </Label>
          {field.status === "completed" ? (
            <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-bold flex items-center gap-1 px-2 py-0.5">
              <Check className="w-3 h-3" />
              {field.confidence ? `IA (${field.confidence}%)` : "Preenchido"}
            </Badge>
          ) : (
            <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] border border-slate-200 dark:border-slate-700">
              Pendente
            </Badge>
          )}
        </div>
        <textarea
          id={field.id}
          value={field.value || ""}
          onChange={(e) => onUpdateField(field.id, e.target.value)}
          placeholder={field.placeholder}
          className={cn(
            "w-full p-3 text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 outline-none leading-relaxed resize-none transition-all shadow-2xs focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10",
            minH,
            field.status === "completed" && "border-emerald-500/30 dark:border-emerald-500/30"
          )}
        />
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
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 flex items-center justify-center font-bold">
            <MessageSquareText className="w-4 h-4" />
          </div>
          <div>
            <CardTitle className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              Bloco B · Diagnóstico Comercial & Funil (Perguntas Estratégicas do Caio)
            </CardTitle>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Processo de vendas atual, concorrentes, diferenciais e base de contatos.
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
          {/* Seção 1: As 6 Perguntas Chaves do Caio */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {renderTextareaField(comoVendeField, "h-28")}
            {renderTextareaField(servicosField, "h-28")}
            {renderTextareaField(concorrentesField, "h-28")}
            {renderTextareaField(baseExistenteField, "h-28")}
            {renderTextareaField(mitosField, "h-28")}
            {renderTextareaField(temasField, "h-28")}
          </div>

          {/* Seção 2: Público-Alvo e Dores */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4">
            {publicoAlvoField && (
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users2 className="w-4 h-4 text-purple-500" />
                    <Label className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                      {publicoAlvoField.label}
                    </Label>
                  </div>
                  {publicoAlvoField.status === "completed" && (
                    <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
                      Definido
                    </Badge>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                  {publicoAlvoField.subfields?.map((sf) => (
                    <div key={sf.id} className="space-y-1">
                      <Label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                        {sf.label}
                      </Label>
                      <Input
                        value={sf.value}
                        onChange={(e) => onUpdateSubfield(publicoAlvoField.id, sf.id, e.target.value)}
                        placeholder={`Ex: ${sf.label}`}
                        className="h-9 text-xs border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              {renderTextareaField(doresPublicoField, "h-20")}
              {renderTextareaField(bloqueadoField, "h-20")}
              {inspiracaoField && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={inspiracaoField.id} className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      {inspiracaoField.label}
                    </Label>
                  </div>
                  <Input
                    id={inspiracaoField.id}
                    value={inspiracaoField.value || ""}
                    onChange={(e) => onUpdateField(inspiracaoField.id, e.target.value)}
                    placeholder={inspiracaoField.placeholder}
                    className="h-10 text-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>
              )}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
