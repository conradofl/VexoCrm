import React, { useMemo, useRef, useState } from "react";
import { applyContractMerge, formatExtenseDateClient, toggleBoldMarkdown, expandSignatureSpacingInText } from "@/lib/geracaoDigital/contractMerge";
import { GdContractFormData, GdContractTemplate } from "@/hooks/useGdContracts";
import { Button } from "@/components/ui/button";
import { RotateCcw, Pencil, FileText, Bold, MoveVertical, Eye, Palette } from "lucide-react";

interface ContractPreviewProps {
  template: GdContractTemplate | null;
  formData: GdContractFormData;
  onChangeTextoFinal?: (text: string | undefined) => void;
  rawTemplateContent?: string;
}

export function ContractPreview({ template, formData, onChangeTextoFinal, rawTemplateContent }: ContractPreviewProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [useSystemTheme, setUseSystemTheme] = useState(false);

  // Texto padrão gerado mesclando os dados atuais do formulário com o template ativo ou blocos montados
  const defaultMergedText = useMemo(() => {
    const templateContent = rawTemplateContent !== undefined ? rawTemplateContent : (template?.conteudo || "");
    if (!templateContent) return "";
    const mergedData = {
      ...formData,
      data_extenso: formatExtenseDateClient(),
    };
    return applyContractMerge(templateContent, mergedData);
  }, [template, rawTemplateContent, formData]);

  if (!template && !rawTemplateContent) {
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
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          {isEdited ? (
            <span className="text-xs font-semibold px-2 py-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1.5">
              <Pencil className="h-3.5 w-3.5" />
              Texto editado manualmente (será salvo como texto final)
            </span>
          ) : (
            <span className="text-xs font-medium px-2 py-1 rounded bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-white/10 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Texto gerado a partir do modelo oficial GD (edite diretamente para customizar)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setUseSystemTheme((v) => !v)}
            title="Alternar entre visualização de Folha Real (fundo branco) e tema da interface"
            className="h-8 text-xs flex items-center gap-1.5 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-white/15 hover:bg-slate-100 dark:hover:bg-white/10"
          >
            <Palette className="h-3.5 w-3.5 text-slate-500" />
            <span>{useSystemTheme ? "Modo Folha Real" : "Modo Tema Escuro"}</span>
          </Button>

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

      {/* Container que simula Folha de Documento Real */}
      <div className="bg-slate-100 dark:bg-slate-950/60 p-3 sm:p-6 rounded-xl border border-slate-200 dark:border-white/10 flex justify-center">
        <div
          className={`w-full max-w-4xl rounded-lg p-6 sm:p-8 shadow-md border transition-colors ${
            useSystemTheme
              ? "bg-card text-foreground border-border dark:bg-slate-900 dark:text-slate-100 dark:border-white/10"
              : "bg-white text-slate-900 border-slate-200 shadow-slate-300/40"
          }`}
        >
          <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-white/10 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span className={`text-xs font-semibold uppercase tracking-wider ${useSystemTheme ? "text-muted-foreground" : "text-slate-600"}`}>
                Minuta Oficial do Contrato
              </span>
            </div>
            <span className={`text-[11px] font-mono ${useSystemTheme ? "text-muted-foreground" : "text-slate-400"}`}>
              {displayText.split("\n").length} linhas
            </span>
          </div>

          <textarea
            ref={textareaRef}
            value={displayText}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            className={`w-full h-[520px] font-serif text-[13px] sm:text-sm leading-relaxed border-0 p-0 focus:outline-none focus:ring-0 resize-none overflow-y-auto ${
              useSystemTheme
                ? "bg-transparent text-foreground placeholder:text-muted-foreground"
                : "bg-white text-slate-900 placeholder:text-slate-400"
            }`}
            placeholder="Texto do contrato..."
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 px-1">
        <span>
          💡 Selecione qualquer palavra ou frase e aperte <strong>Ctrl+B</strong> (ou <strong>⌘B</strong>) para colocar em negrito (<code className="text-purple-600 dark:text-purple-400 font-mono">**palavra**</code>). Use o botão <strong>+ Espaço Assinatura</strong> para abrir espaço para carimbos digitais.
        </span>
      </div>
    </div>
  );
}
