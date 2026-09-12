import React, { useMemo } from "react";
import { applyContractMerge, formatExtenseDateClient } from "@/lib/geracaoDigital/contractMerge";
import { GdContractFormData, GdContractTemplate } from "@/hooks/useGdContracts";
import { Button } from "@/components/ui/button";
import { RotateCcw, Pencil, FileText } from "lucide-react";

interface ContractPreviewProps {
  template: GdContractTemplate | null;
  formData: GdContractFormData;
  onChangeTextoFinal?: (text: string | undefined) => void;
}

export function ContractPreview({ template, formData, onChangeTextoFinal }: ContractPreviewProps) {
  // Texto padrão gerado mesclando os dados atuais do formulário com o template ativo
  const defaultMergedText = useMemo(() => {
    if (!template) return "";
    const mergedData = {
      ...formData,
      data_extenso: formatExtenseDateClient(),
    };
    return applyContractMerge(template.conteudo, mergedData);
  }, [template, formData]);

  if (!template) {
    return (
      <div className="flex h-[400px] items-center justify-center text-slate-500 bg-slate-50 dark:bg-slate-900 rounded-md border border-slate-200 dark:border-white/10">
        Nenhum template ativo encontrado.
      </div>
    );
  }

  // Se o usuário já editou (mesmo que tenha apagado tudo), exibe texto_final; caso contrário, exibe o mesclado do modelo
  const isEdited = typeof formData.texto_final === "string";
  const displayText = isEdited ? formData.texto_final : defaultMergedText;

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (onChangeTextoFinal) {
      onChangeTextoFinal(e.target.value);
    }
  };

  const handleRestore = () => {
    if (window.confirm("Deseja descartar as edições manuais e restaurar o texto a partir do modelo?")) {
      if (onChangeTextoFinal) {
        onChangeTextoFinal(undefined);
      }
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          {isEdited ? (
            <span className="text-xs font-semibold px-2 py-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1.5">
              <Pencil className="h-3.5 w-3.5" />
              Texto editado manualmente (será salvo como texto final)
            </span>
          ) : (
            <span className="text-xs font-medium px-2 py-1 rounded bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-white/10 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Texto gerado a partir do modelo (edite diretamente para customizar)
            </span>
          )}
        </div>

        {isEdited && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRestore}
            className="h-8 text-xs flex items-center gap-1.5 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-white/15 hover:bg-slate-100 dark:hover:bg-white/10"
          >
            <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
            Restaurar do modelo
          </Button>
        )}
      </div>

      <textarea
        value={displayText}
        onChange={handleTextChange}
        className="w-full h-[500px] rounded-md border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950 p-4 font-serif text-sm leading-relaxed text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500/50 shadow-inner resize-none overflow-y-auto"
        placeholder="Texto do contrato..."
      />
    </div>
  );
}
