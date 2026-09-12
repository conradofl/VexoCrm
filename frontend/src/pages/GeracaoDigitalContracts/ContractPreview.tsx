import React, { useMemo, useRef } from "react";
import { applyContractMerge, formatExtenseDateClient, toggleBoldMarkdown, expandSignatureSpacingInText } from "@/lib/geracaoDigital/contractMerge";
import { GdContractFormData, GdContractTemplate } from "@/hooks/useGdContracts";
import { Button } from "@/components/ui/button";
import { RotateCcw, Pencil, FileText, Bold, MoveVertical } from "lucide-react";

interface ContractPreviewProps {
  template: GdContractTemplate | null;
  formData: GdContractFormData;
  onChangeTextoFinal?: (text: string | undefined) => void;
}

export function ContractPreview({ template, formData, onChangeTextoFinal }: ContractPreviewProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const handleToggleBold = () => {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const currentText = displayText;
    const { text: newText, newStart, newEnd } = toggleBoldMarkdown(currentText, start, end);

    if (onChangeTextoFinal) {
      onChangeTextoFinal(newText);
    }

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newStart, newEnd);
      }
    });
  };

  const handleExpandSignatureSpacing = () => {
    const newText = expandSignatureSpacingInText(displayText, 2);
    if (onChangeTextoFinal) {
      onChangeTextoFinal(newText);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Atalho de tecla para negrito: Ctrl+B (Windows/Linux) ou ⌘B (Mac)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      handleToggleBold();
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

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleToggleBold}
            title="Inserir/Alternar Negrito (Ctrl+B ou ⌘B)"
            className="h-8 text-xs flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-200 border-slate-300 dark:border-white/15 hover:bg-slate-100 dark:hover:bg-white/10"
          >
            <Bold className="h-3.5 w-3.5" />
            <span>Negrito</span>
            <kbd className="text-[10px] font-normal px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-white/10 text-slate-500">
              Ctrl+B
            </kbd>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExpandSignatureSpacing}
            title="Aumentar espaço entre as assinaturas para caber assinatura digital"
            className="h-8 text-xs flex items-center gap-1.5 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-white/15 hover:bg-slate-100 dark:hover:bg-white/10"
          >
            <MoveVertical className="h-3.5 w-3.5 text-slate-500" />
            <span>+ Espaço Assinatura</span>
          </Button>

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
      </div>

      <textarea
        ref={textareaRef}
        value={displayText}
        onChange={handleTextChange}
        onKeyDown={handleKeyDown}
        className="w-full h-[500px] rounded-md border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950 p-4 font-serif text-sm leading-relaxed text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500/50 shadow-inner resize-none overflow-y-auto"
        placeholder="Texto do contrato..."
      />

      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 px-1">
        <span>
          💡 Selecione qualquer palavra ou frase e aperte <strong>Ctrl+B</strong> (ou <strong>⌘B</strong>) para colocar em negrito (<code className="text-purple-600 dark:text-purple-400 font-mono">**palavra**</code>). Use o botão <strong>+ Espaço Assinatura</strong> ou dê <strong>Enter</strong> entre as linhas de assinatura para criar o espaço necessário para carimbos digitais.
        </span>
      </div>
    </div>
  );
}

