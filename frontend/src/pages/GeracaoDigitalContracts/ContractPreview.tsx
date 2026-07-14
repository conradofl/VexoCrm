import React from "react";
import { applyContractMerge, formatExtenseDateClient } from "@/lib/geracaoDigital/contractMerge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GdContractFormData, GdContractTemplate } from "@/hooks/useGdContracts";

interface ContractPreviewProps {
  template: GdContractTemplate | null;
  formData: GdContractFormData;
}

export function ContractPreview({ template, formData }: ContractPreviewProps) {
  if (!template) {
    return (
      <div className="flex h-[400px] items-center justify-center text-slate-500 bg-slate-50 dark:bg-slate-900 rounded-md border border-slate-200 dark:border-white/10">
        Nenhum template ativo encontrado.
      </div>
    );
  }

  const mergedData = {
    ...formData,
    data_extenso: formatExtenseDateClient(),
  };

  const mergedText = applyContractMerge(template.conteudo, mergedData);

  return (
    <ScrollArea className="h-[500px] w-full rounded-md border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950 p-6">
      <div className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-slate-800 dark:text-slate-200">
        {mergedText}
      </div>
    </ScrollArea>
  );
}
