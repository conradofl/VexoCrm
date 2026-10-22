import React, { useState } from "react";
import { Building2, ChevronDown, ChevronUp, Check, CheckCircle2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BriefingField } from "@/lib/geracaoDigital/types";

export interface ClientContractInfo {
  razaoSocial: string;
  cnpj: string;
  responsavel: string;
  whatsapp: string;
  email: string;
  endereco: string;
}

interface BriefingBlockContractProps {
  clientInfo: ClientContractInfo;
  setClientInfo: React.Dispatch<React.SetStateAction<ClientContractInfo>>;
  produtosField?: BriefingField;
  onUpdateField: (fieldId: string, value: string) => void;
}

export function BriefingBlockContract({
  clientInfo,
  setClientInfo,
  produtosField,
  onUpdateField,
}: BriefingBlockContractProps) {
  const [isOpen, setIsOpen] = useState(true);

  // Calcula campos preenchidos deste bloco
  const infoCount = [
    clientInfo.razaoSocial,
    clientInfo.cnpj,
    clientInfo.responsavel,
    clientInfo.whatsapp,
    clientInfo.email,
    clientInfo.endereco,
  ].filter((v) => v && v.trim().length > 0).length;

  const totalBlockFields = 7; // 6 contratuais + produtos
  const produtosPreenchidos = produtosField?.value ? 1 : 0;
  const totalCompleted = infoCount + produtosPreenchidos;

  const parseSelectedList = (val: string, opts?: string[]): string[] => {
    if (!val) return [];
    if (val.startsWith("[") && val.endsWith("]")) {
      try {
        const arr = JSON.parse(val);
        if (Array.isArray(arr)) return arr.map(String);
      } catch {}
    }
    if (val.includes("; ")) {
      return val.split("; ").map((x) => x.trim()).filter(Boolean);
    }
    if (Array.isArray(opts) && opts.length > 0) {
      const matched = opts.filter((opt) => val.includes(opt));
      if (matched.length > 0) return matched;
    }
    return val.split(", ").map((x) => x.trim()).filter(Boolean);
  };

  const selectedList = parseSelectedList(produtosField?.value || "", produtosField?.options);
  const outrosItem = selectedList.find(
    (x) => x.startsWith("Outros:") || x.toLowerCase().startsWith("outros")
  );
  const hasOutros = !!outrosItem;
  const outrosText = outrosItem
    ? outrosItem.includes(":")
      ? outrosItem.split(":")[1].trim()
      : outrosItem.replace(/outros/i, "").trim()
    : "";

  const handleToggleProduct = (option: string) => {
    let newList = [...selectedList];
    if (newList.includes(option)) {
      newList = newList.filter((x) => x !== option);
    } else {
      newList.push(option);
    }
    newList = newList.filter(Boolean);
    const joined = newList.join("; ");
    onUpdateField("produtos", joined);
  };

  const handleOutrosTextChange = (text: string) => {
    let newList = selectedList.filter(
      (x) => !x.startsWith("Outros:") && !x.toLowerCase().startsWith("outros")
    );
    if (text.trim()) {
      newList.push(`Outros: ${text.trim()}`);
    } else {
      newList.push("Outros");
    }
    const joined = newList.join("; ");
    onUpdateField("produtos", joined);
  };

  return (
    <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl shadow-xs overflow-hidden transition-all">
      <CardHeader
        className="p-5 flex flex-row items-center justify-between cursor-pointer select-none bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-100/60 dark:hover:bg-slate-800/60 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 flex items-center justify-center font-bold">
            <Building2 className="w-4 h-4" />
          </div>
          <div>
            <CardTitle className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              Bloco A · Dados Contratuais e Empresa
            </CardTitle>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Identificação formal, contatos corporativos e escopo fechado.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge
            className={cn(
              "font-mono text-xs font-semibold px-2.5 py-0.5 border",
              totalCompleted >= totalBlockFields
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700"
            )}
          >
            {totalCompleted}/{totalBlockFields} preenchidos
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Razão Social / Nome da Empresa *
              </Label>
              <Input
                value={clientInfo.razaoSocial}
                onChange={(e) => setClientInfo({ ...clientInfo, razaoSocial: e.target.value })}
                placeholder="Ex: Sonhare Colchões Ltda"
                className="h-10 text-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                CNPJ
              </Label>
              <Input
                value={clientInfo.cnpj}
                onChange={(e) => setClientInfo({ ...clientInfo, cnpj: e.target.value })}
                placeholder="Ex: 00.000.000/0001-00"
                className="h-10 text-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Responsável Principal (Decisor)
              </Label>
              <Input
                value={clientInfo.responsavel}
                onChange={(e) => setClientInfo({ ...clientInfo, responsavel: e.target.value })}
                placeholder="Ex: Caio Almeida / Dr. Silva"
                className="h-10 text-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                WhatsApp Comercial
              </Label>
              <Input
                value={clientInfo.whatsapp}
                onChange={(e) => setClientInfo({ ...clientInfo, whatsapp: e.target.value })}
                placeholder="Ex: (11) 98888-7777"
                className="h-10 text-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                E-mail Comercial / Financeiro
              </Label>
              <Input
                type="email"
                value={clientInfo.email}
                onChange={(e) => setClientInfo({ ...clientInfo, email: e.target.value })}
                placeholder="Ex: contato@empresa.com.br"
                className="h-10 text-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Endereço / Cidade / Região
              </Label>
              <Input
                value={clientInfo.endereco}
                onChange={(e) => setClientInfo({ ...clientInfo, endereco: e.target.value })}
                placeholder="Ex: São Paulo - SP (ou Av. Paulista, 1000)"
                className="h-10 text-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {/* Produtos Contratados */}
          {produtosField && (
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                    {produtosField.label}
                  </Label>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Selecione todos os serviços incluídos no contrato deste parceiro.
                  </p>
                </div>
                {produtosField.status === "completed" ? (
                  <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-bold flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    {selectedList.length} selecionados
                  </Badge>
                ) : (
                  <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] border border-slate-200 dark:border-slate-700">
                    Nenhum pacote selecionado
                  </Badge>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {produtosField.options?.map((opt) => {
                  const isSelected =
                    selectedList.includes(opt) || (opt === "Outros ______________" && hasOutros);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        if (opt === "Outros ______________") {
                          if (hasOutros) {
                            const newList = selectedList.filter(
                              (x) => !x.startsWith("Outros:") && !x.toLowerCase().startsWith("outros")
                            );
                            onUpdateField("produtos", newList.join("; "));
                          } else {
                            handleToggleProduct("Outros");
                          }
                        } else {
                          handleToggleProduct(opt);
                        }
                      }}
                      className={cn(
                        "text-xs font-medium px-3 py-1.5 rounded-xl border transition-all duration-150 cursor-pointer select-none",
                        isSelected
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                          : "bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900"
                      )}
                    >
                      {opt === "Outros ______________" ? "Outros" : opt}
                    </button>
                  );
                })}
              </div>

              {hasOutros && (
                <div className="pt-2">
                  <Input
                    value={outrosText}
                    onChange={(e) => handleOutrosTextChange(e.target.value)}
                    placeholder="Especifique outros pacotes ou serviços contratados..."
                    className="h-10 text-sm border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                  />
                </div>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
