import React, { useMemo, useRef, useState } from "react";
import {
  applyContractMerge,
  formatExtenseDateClient,
  toggleBoldMarkdown,
  expandSignatureSpacingInText,
  parseTemplateContentToClauses,
  toExtenseOrdinal,
} from "@/lib/geracaoDigital/contractMerge";
import { GdContractFormData, GdContractTemplate } from "@/hooks/useGdContracts";
import { Button } from "@/components/ui/button";
import { RotateCcw, Pencil, FileText, Bold, MoveVertical, Eye, Palette, Building2 } from "lucide-react";

interface ContractPreviewProps {
  template: GdContractTemplate | null;
  formData: GdContractFormData;
  onChangeTextoFinal?: (text: string | undefined) => void;
  rawTemplateContent?: string;
}

function renderMarkdownText(text: string) {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-inherit">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

export function ContractPreview({ template, formData, onChangeTextoFinal, rawTemplateContent }: ContractPreviewProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [useSystemTheme, setUseSystemTheme] = useState(false);
  const [viewMode, setViewMode] = useState<"formatted" | "raw">("formatted");

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

  // Extração estruturada das cláusulas a partir do texto completo
  const parsedContract = useMemo(() => {
    return parseTemplateContentToClauses(displayText);
  }, [displayText]);

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

  // Dados das partes para os cards da Cláusula Primeira
  const contratadaRazaoSocial = String(formData.contratada_razao_social || "AGÊNCIA GERAÇÃO DIGITAL LTDA").trim();
  const contratadaCnpj = String(formData.contratada_cnpj || "66.722.723/0001-02").trim();
  const contratadaRepresentante = String(formData.contratada_representante || "Caio Vinícius Almeida de Oliveira").trim();
  const contratadaEndereco = String(formData.contratada_endereco || "Av. Paraná, 65, Tibery, Uberlândia – MG, CEP 38405-022").trim();
  const contratadaTelefone = String(formData.contratada_telefone || "(34) 99771-9779").trim();
  const contratadaEmail = String(formData.contratada_email || "comercial@mktgeracaodigital.com.br").trim();
  const contratadaComarca = String(formData.contratada_comarca || "Uberlândia – MG").trim();

  const contratanteRazaoSocial = String(formData.razao_social || "—").trim();
  const contratanteCnpj = String(formData.cnpj || "—").trim();
  const contratanteResponsavel = String(
    formData.representante_nome || formData.responsavel_nome || formData.representante || "—"
  ).trim();
  const contratanteEndereco = String(formData.endereco || "—").trim();
  const contratanteTelefone = String(formData.telefone || "—").trim();
  const contratanteEmail = String(formData.email || "—").trim();

  const dataExtenso = formatExtenseDateClient();

  // Cláusulas seguintes (Segunda à Sexta ou outras)
  const subsequentClauses = useMemo(() => {
    return parsedContract.clausulas.filter((c) => c.id !== "partes" && !/das\s+partes/i.test(c.titulo));
  }, [parsedContract.clausulas]);

  return (
    <div className="space-y-3">
      {/* Barra de Ações Superior */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          {isEdited ? (
            <span className="text-xs font-semibold px-2 py-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 flex items-center gap-1.5">
              <Pencil className="h-3.5 w-3.5" />
              Texto editado manualmente (será salvo como texto final)
            </span>
          ) : (
            <span className="text-xs font-medium px-2 py-1 rounded bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/20 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Modelo Oficial GD (6 Cláusulas Estruturadas)
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Alternador de Modo de Visualização */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setViewMode((m) => (m === "formatted" ? "raw" : "formatted"))}
            title={viewMode === "formatted" ? "Alternar para edição de texto puro" : "Alternar para visualização formatada"}
            className="h-8 text-xs flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200 border-slate-300 dark:border-white/15 hover:bg-slate-100 dark:hover:bg-white/10"
          >
            {viewMode === "formatted" ? (
              <>
                <Pencil className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                <span>Editar Texto Puro</span>
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Visualização Formatada</span>
              </>
            )}
          </Button>

          {/* Alternador de Tema (Folha Real / Tema Escuro) */}
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

          {/* Botões específicos do modo Raw */}
          {viewMode === "raw" && (
            <>
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
            </>
          )}

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

      {/* Conteúdo Principal do Contrato */}
      <div className="bg-slate-100 dark:bg-slate-950/70 p-3 sm:p-6 rounded-xl border border-slate-200 dark:border-white/10 flex justify-center">
        <div
          className={`w-full max-w-4xl rounded-xl p-6 sm:p-10 shadow-lg border transition-colors ${
            useSystemTheme
              ? "bg-slate-900 border-white/10 text-slate-100 shadow-2xl"
              : "bg-white border-slate-200 text-slate-900 shadow-slate-300/40"
          }`}
        >
          {viewMode === "formatted" ? (
            <div className="space-y-8 font-serif">
              {/* a) Cabeçalho Oficial */}
              <div className="text-center space-y-1.5 pb-6 border-b border-slate-200 dark:border-white/10">
                <h1 className="text-lg sm:text-2xl font-bold uppercase tracking-wider font-serif">
                  CONTRATO DE PRESTAÇÃO DE SERVIÇOS
                </h1>
                <p className="text-xs sm:text-sm font-semibold uppercase tracking-widest text-purple-600 dark:text-purple-400">
                  MARKETING DIGITAL & AUTOMAÇÃO
                </p>
              </div>

              {/* b) Cláusula Primeira | Das Partes */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-500" />
                  <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider">
                    CLÁUSULA PRIMEIRA | DAS PARTES
                  </h2>
                </div>

                {/* Grid em 2 Colunas / Cards Elegantes Lado a Lado */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Card 1: Contratada */}
                  <div
                    className={`p-4 rounded-xl border transition-colors ${
                      useSystemTheme
                        ? "bg-slate-950/80 border-white/10 text-slate-100"
                        : "bg-slate-50/90 border-slate-200 text-slate-900"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200 dark:border-white/10">
                      <span className="text-[11px] font-bold tracking-wider px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-300 border border-purple-500/20">
                        CONTRATADA
                      </span>
                      <Building2 className="h-4 w-4 text-purple-500/70" />
                    </div>
                    <div className="space-y-1.5 text-xs font-sans">
                      <div>
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Razão Social: </span>
                        <span className="font-bold">{contratadaRazaoSocial}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500 dark:text-slate-400">CNPJ: </span>
                        <span>{contratadaCnpj}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Representante: </span>
                        <span>{contratadaRepresentante}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Endereço: </span>
                        <span>{contratadaEndereco}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 pt-0.5">
                        <div>
                          <span className="font-semibold text-slate-500 dark:text-slate-400">Tel: </span>
                          <span>{contratadaTelefone}</span>
                        </div>
                        <div>
                          <span className="font-semibold text-slate-500 dark:text-slate-400">E-mail: </span>
                          <span>{contratadaEmail}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Contratante */}
                  <div
                    className={`p-4 rounded-xl border transition-colors ${
                      useSystemTheme
                        ? "bg-slate-950/80 border-white/10 text-slate-100"
                        : "bg-slate-50/90 border-slate-200 text-slate-900"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200 dark:border-white/10">
                      <span className="text-[11px] font-bold tracking-wider px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-300 border border-blue-500/20">
                        CONTRATANTE
                      </span>
                      <Building2 className="h-4 w-4 text-blue-500/70" />
                    </div>
                    <div className="space-y-1.5 text-xs font-sans">
                      <div>
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Razão Social: </span>
                        <span className="font-bold">{contratanteRazaoSocial}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500 dark:text-slate-400">CNPJ: </span>
                        <span>{contratanteCnpj}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Responsável: </span>
                        <span>{contratanteResponsavel}</span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500 dark:text-slate-400">Endereço: </span>
                        <span>{contratanteEndereco}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 pt-0.5">
                        <div>
                          <span className="font-semibold text-slate-500 dark:text-slate-400">Tel: </span>
                          <span>{contratanteTelefone}</span>
                        </div>
                        <div>
                          <span className="font-semibold text-slate-500 dark:text-slate-400">E-mail: </span>
                          <span>{contratanteEmail}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Parágrafo de Qualificação */}
                <p className="text-xs sm:text-sm leading-relaxed text-justify italic pt-2">
                  Por este instrumento particular, as partes acima qualificadas, doravante designadas simplesmente CONTRATADA e CONTRATANTE, celebram o presente Contrato de Prestação de Serviços, que será regido pelas cláusulas e condições a seguir expostas.
                </p>
              </div>

              {/* c) Cláusulas Seguintes (Segunda à Sexta) */}
              {subsequentClauses.map((clause, idx) => {
                const ordinal = toExtenseOrdinal(idx + 2);
                const titleUpper = clause.titulo.toUpperCase();
                const isObrigacoes = /obriga/i.test(clause.titulo);
                const isPreco = /pre[çc]o/i.test(clause.titulo);

                return (
                  <div key={clause.id || idx} className="space-y-3 pt-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-purple-500" />
                      <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider">
                        CLÁUSULA {ordinal} | {titleUpper}
                      </h3>
                    </div>

                    {isObrigacoes ? (
                      /* Formatação específica para Cláusula Terceira (Obrigações) */
                      <div className="space-y-4 pt-1 font-sans">
                        {(() => {
                          const splitContratada = clause.conteudo.split(/Compete à CONTRATADA:?/i);
                          const contratantePart = splitContratada[0]?.replace(/Compete à CONTRATANTE:?/i, "").trim() || "";
                          const contratadaPart = splitContratada[1]?.trim() || "";

                          const parseLines = (text: string) =>
                            text
                              .split("\n")
                              .map((l) => l.trim())
                              .filter(Boolean)
                              .map((l) => l.replace(/^\d+[\.\)]\s*/, ""));

                          const itemsContratante = parseLines(contratantePart);
                          const itemsContratada = parseLines(contratadaPart);

                          return (
                            <>
                              {itemsContratante.length > 0 && (
                                <div
                                  className={`p-4 rounded-xl border ${
                                    useSystemTheme ? "bg-slate-950/60 border-white/10" : "bg-slate-50/80 border-slate-200"
                                  }`}
                                >
                                  <h4 className="text-xs font-bold uppercase tracking-wider mb-2 text-blue-600 dark:text-blue-400 flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                    Compete à CONTRATANTE:
                                  </h4>
                                  <ol className="space-y-1.5 text-xs sm:text-sm list-decimal list-inside pl-1 text-slate-700 dark:text-slate-300">
                                    {itemsContratante.map((item, itemIdx) => (
                                      <li key={itemIdx} className="leading-relaxed text-justify pl-1">
                                        {renderMarkdownText(item)}
                                      </li>
                                    ))}
                                  </ol>
                                </div>
                              )}

                              {itemsContratada.length > 0 && (
                                <div
                                  className={`p-4 rounded-xl border ${
                                    useSystemTheme ? "bg-slate-950/60 border-white/10" : "bg-slate-50/80 border-slate-200"
                                  }`}
                                >
                                  <h4 className="text-xs font-bold uppercase tracking-wider mb-2 text-purple-600 dark:text-purple-400 flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                                    Compete à CONTRATADA:
                                  </h4>
                                  <ol className="space-y-1.5 text-xs sm:text-sm list-decimal list-inside pl-1 text-slate-700 dark:text-slate-300">
                                    {itemsContratada.map((item, itemIdx) => (
                                      <li key={itemIdx} className="leading-relaxed text-justify pl-1">
                                        {renderMarkdownText(item)}
                                      </li>
                                    ))}
                                  </ol>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    ) : isPreco ? (
                      /* Formatação destacada para Cláusula Quarta (Preço e Condições) */
                      <div className="space-y-2 text-xs sm:text-sm leading-relaxed text-justify">
                        {clause.conteudo
                          .split("\n\n")
                          .map((p) => p.trim())
                          .filter(Boolean)
                          .map((para, pIdx) => {
                            const isSectionTitle = /^(Compromisso do Período|COMPOSIÇÃO DO PERÍODO|Em reais|Em permuta)/i.test(para);
                            if (isSectionTitle) {
                              return (
                                <h4
                                  key={pIdx}
                                  className="font-bold text-xs uppercase tracking-wider text-purple-700 dark:text-purple-400 mt-3 pt-1"
                                >
                                  {para}
                                </h4>
                              );
                            }
                            return <p key={pIdx}>{renderMarkdownText(para)}</p>;
                          })}
                      </div>
                    ) : (
                      /* Cláusulas gerais (Segunda, Quinta, Sexta) */
                      <div className="space-y-2 text-xs sm:text-sm leading-relaxed text-justify">
                        {clause.conteudo
                          .split("\n\n")
                          .map((p) => p.trim())
                          .filter(Boolean)
                          .map((para, pIdx) => (
                            <p key={pIdx}>{renderMarkdownText(para)}</p>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* d) Área de Fechamento e Assinaturas */}
              <div className="pt-6 border-t border-slate-200 dark:border-white/10 space-y-6">
                <p className="text-xs sm:text-sm italic text-center">
                  E, por estarem assim justas e contratadas, firmam o presente contrato em 02 (duas) vias, para um só efeito.
                </p>

                <p className="text-xs sm:text-sm text-center font-bold">
                  {contratadaComarca}, {dataExtenso}.
                </p>

                {/* Assinaturas Principais (2 Colunas) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6 font-sans">
                  <div className="text-center space-y-1">
                    <div className="border-t border-slate-400 dark:border-slate-500 w-4/5 mx-auto mb-2.5" />
                    <p className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                      CONTRATADA
                    </p>
                    <p className="text-xs font-bold">{contratadaRazaoSocial}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{contratadaRepresentante}</p>
                  </div>

                  <div className="text-center space-y-1">
                    <div className="border-t border-slate-400 dark:border-slate-500 w-4/5 mx-auto mb-2.5" />
                    <p className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                      CONTRATANTE
                    </p>
                    <p className="text-xs font-bold">{contratanteRazaoSocial}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{contratanteResponsavel}</p>
                  </div>
                </div>

                {/* Assinaturas das Testemunhas */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4 font-sans text-xs">
                  <div className="space-y-1 text-slate-600 dark:text-slate-400">
                    <p className="font-bold text-slate-700 dark:text-slate-300">Testemunha 1</p>
                    <p>Nome: _____________________________________________</p>
                    <p>CPF: ______________________________________________</p>
                  </div>

                  <div className="space-y-1 text-slate-600 dark:text-slate-400">
                    <p className="font-bold text-slate-700 dark:text-slate-300">Testemunha 2</p>
                    <p>Nome: _____________________________________________</p>
                    <p>CPF: ______________________________________________</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Modo Edição de Texto Puro (Textarea) */
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-white/10 pb-3 mb-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span
                    className={`text-xs font-semibold uppercase tracking-wider ${
                      useSystemTheme ? "text-slate-300" : "text-slate-600"
                    }`}
                  >
                    Editor de Texto Cru do Contrato
                  </span>
                </div>
                <span className={`text-[11px] font-mono ${useSystemTheme ? "text-slate-400" : "text-slate-500"}`}>
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
                    ? "bg-transparent text-slate-100 placeholder:text-slate-500"
                    : "bg-white text-slate-900 placeholder:text-slate-400"
                }`}
                placeholder="Texto do contrato..."
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 px-1">
        <span>
          💡 Alterne entre <strong>Visualização Formatada</strong> e <strong>Editar Texto Puro</strong> a qualquer momento. No editor de texto puro, selecione qualquer trecho e aperte <strong>Ctrl+B</strong> (ou <strong>⌘B</strong>) para colocar em negrito.
        </span>
      </div>
    </div>
  );
}
