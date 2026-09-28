import React, { useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  Instagram,
  Loader2,
  Phone,
  User,
  Users,
  X,
  FileArchive,
  FileText,
  Filter,
  Sparkles,
  Info,
  CheckSquare,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  parseInstagramExport,
  buildInstagramImportPayload,
  isInstagramMessageJsonPath,
  isInstagramMessageHtmlPath,
  type RawExportFile,
  type InstagramParseResult,
  type ParsedInstagramContact,
} from "@/lib/leadImports/instagramExport";
import { useImportInstagram } from "@/hooks/useContactsWithoutChannel";

interface InstagramImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  onSuccess?: () => void;
}

export function InstagramImportModal({
  open,
  onOpenChange,
  clientId,
  onSuccess,
}: InstagramImportModalProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const jsonFileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const [isReading, setIsReading] = useState(false);
  const [parseResult, setParseResult] = useState<InstagramParseResult | null>(null);
  const [activeGroupTab, setActiveGroupTab] = useState<"with_phone" | "without_phone">("with_phone");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "lead" | "personal">("lead");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const importMutation = useImportInstagram();

  const resetState = () => {
    setParseResult(null);
    setIsReading(false);
    setActiveGroupTab("with_phone");
    setCategoryFilter("lead");
    setSelectedKeys(new Set());
    if (folderInputRef.current) folderInputRef.current.value = "";
    if (jsonFileInputRef.current) jsonFileInputRef.current.value = "";
    if (zipInputRef.current) zipInputRef.current.value = "";
  };

  const handleClose = () => {
    if (importMutation.isPending) return;
    onOpenChange(false);
    resetState();
  };

  const getContactKey = (c: ParsedInstagramContact) => c.perfil || c.name;

  const handleFiles = async (files: FileList | File[]) => {
    setIsReading(true);
    try {
      const fileArray = Array.from(files);

      // 1. Detect if any file is .zip
      const hasZip = fileArray.some(
        (f) => /\.zip$/i.test(f.name) || /\.zip$/i.test((f as any).webkitRelativePath || "")
      );
      if (hasZip) {
        const result = parseInstagramExport([{ path: "export.zip", text: "" }]);
        setParseResult(result);
        return;
      }

      // 2. Read only message JSON and HTML files (avoid reading huge binary images/videos)
      const rawFiles: RawExportFile[] = [];
      for (const file of fileArray) {
        const relPath = (file as any).webkitRelativePath || file.name;
        if (isInstagramMessageJsonPath(relPath)) {
          const text = await file.text();
          rawFiles.push({ path: relPath, text });
        } else if (isInstagramMessageHtmlPath(relPath)) {
          rawFiles.push({ path: relPath, text: "" });
        }
      }

      // 3. Fallback path if no message files found
      if (rawFiles.length === 0) {
        const first = fileArray[0];
        const samplePath = first ? ((first as any).webkitRelativePath || first.name) : "pasta_vazia";
        rawFiles.push({ path: samplePath, text: "" });
      }

      const result = parseInstagramExport(rawFiles);
      setParseResult(result);

      const all = [...result.withPhone, ...result.withoutPhone];
      const leadKeys = new Set(
        all.filter((c) => c.category === "lead").map(getContactKey)
      );

      // Pré-seleciona apenas os leads comerciais se houver algum, evitando poluir com contatos pessoais
      if (leadKeys.size > 0) {
        setSelectedKeys(leadKeys);
        setCategoryFilter("lead");
      } else {
        setSelectedKeys(new Set(all.map(getContactKey)));
        setCategoryFilter("all");
      }

      if (result.withPhone.length > 0) {
        setActiveGroupTab("with_phone");
      } else if (result.withoutPhone.length > 0) {
        setActiveGroupTab("without_phone");
      }
    } catch (err: any) {
      toast.error("Erro ao processar arquivos", {
        description: err?.message || "Não foi possível ler os arquivos da pasta.",
      });
    } finally {
      setIsReading(false);
    }
  };

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  const handleJsonFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  const handleZipChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  const toggleSelect = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectOnlyLeads = () => {
    if (!parseResult) return;
    const all = [...parseResult.withPhone, ...parseResult.withoutPhone];
    const leads = all.filter((c) => c.category === "lead").map(getContactKey);
    setSelectedKeys(new Set(leads));
    toast.info(`${leads.length} possíveis clientes selecionados.`);
  };

  const selectAll = () => {
    if (!parseResult) return;
    const all = [...parseResult.withPhone, ...parseResult.withoutPhone];
    setSelectedKeys(new Set(all.map(getContactKey)));
  };

  const deselectAll = () => {
    setSelectedKeys(new Set());
  };

  const handleConfirmImport = async () => {
    if (!parseResult || !clientId) return;

    const allContacts = [...parseResult.withPhone, ...parseResult.withoutPhone];
    const selectedContacts = allContacts.filter((c) => selectedKeys.has(getContactKey(c)));

    if (selectedContacts.length === 0) {
      toast.warning("Selecione pelo menos um contato para importar.");
      return;
    }

    const payload = buildInstagramImportPayload(selectedContacts);

    try {
      const res = await importMutation.mutateAsync({
        clientId,
        contacts: payload.contacts,
      });

      toast.success("Importação do Instagram concluída!", {
        description: `${res.leadsCreated} leads criados no CRM e ${res.contactsWithoutChannelCreated} contatos salvos na lista manual.`,
      });

      handleClose();
      onSuccess?.();
    } catch (err: any) {
      toast.error("Falha na importação", {
        description: err?.message || "Ocorreu um erro ao salvar os contatos.",
      });
    }
  };

  const currentGroupList =
    parseResult == null
      ? []
      : activeGroupTab === "with_phone"
      ? parseResult.withPhone
      : parseResult.withoutPhone;

  const currentFilteredList = currentGroupList.filter((c) => {
    if (categoryFilter === "lead") return c.category === "lead";
    if (categoryFilter === "personal") return c.category === "personal";
    return true;
  });

  const totalLeadsInGroup = currentGroupList.filter((c) => c.category === "lead").length;
  const totalPersonalInGroup = currentGroupList.filter((c) => c.category === "personal").length;
  const selectedCountInTotal = selectedKeys.size;

  const hasContacts =
    parseResult && (parseResult.withPhone.length > 0 || parseResult.withoutPhone.length > 0);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-pink-500/10 text-pink-600 dark:text-pink-400">
              <Instagram className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">
                Importar Conversas do Instagram
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Selecione a pasta descompactada ou os arquivos .json da exportação do Instagram.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Hidden File Inputs */}
        <input
          ref={folderInputRef}
          type="file"
          // @ts-ignore
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          data-testid="instagram-folder-input"
          onChange={handleFolderChange}
        />
        <input
          ref={jsonFileInputRef}
          type="file"
          accept=".json,application/json"
          multiple
          className="hidden"
          data-testid="instagram-json-input"
          onChange={handleJsonFilesChange}
        />
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          data-testid="instagram-zip-input"
          onChange={handleZipChange}
        />

        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {/* Seletor Inicial (quando nenhum resultado ou arquivo estiver carregado) */}
          {!parseResult && !isReading && (
            <div className="space-y-4">
              <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-border rounded-xl bg-muted/20 text-center space-y-4">
                <div className="p-3 bg-pink-500/10 text-pink-600 rounded-full">
                  <FolderOpen className="w-8 h-8" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    Como deseja selecionar as mensagens?
                  </p>
                  <p className="text-xs text-muted-foreground max-w-md">
                    O Instagram gera pastas com arquivos <code>message_1.json</code>. Você pode selecionar a pasta inteira ou escolher os arquivos JSON diretamente.
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                  <Button
                    type="button"
                    onClick={() => folderInputRef.current?.click()}
                    className="bg-pink-600 hover:bg-pink-700 text-white text-xs gap-2 font-medium"
                  >
                    <FolderOpen className="w-4 h-4" />
                    Selecionar Pasta Completa
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => jsonFileInputRef.current?.click()}
                    className="text-xs gap-2 text-foreground font-medium"
                  >
                    <FileText className="w-4 h-4 text-pink-600" />
                    Selecionar Arquivos .json
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => zipInputRef.current?.click()}
                    className="text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                  >
                    <FileArchive className="w-3.5 h-3.5" />
                    Tentei enviar .zip
                  </Button>
                </div>
              </div>

              {/* Explicação útil sobre o Finder / arquivos apagados */}
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-blue-800 dark:text-blue-300">
                    💡 Por que os arquivos .json aparecem cinzas/apagados no Mac/Windows?
                  </p>
                  <p className="text-blue-700/90 dark:text-blue-300/90 leading-relaxed text-[11.5px]">
                    Ao usar <strong>"Selecionar Pasta Completa"</strong>, o sistema operacional espera que você escolha a <strong>pasta</strong> (ex: pasta <code>messages</code> ou <code>your_instagram_activity</code>) e clique no botão azul <strong>"Fazer upload"</strong> no canto do Finder. Os arquivos individuais dentro dela ficam apagados apenas porque o sistema está em modo pasta.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Loading State ao ler arquivos */}
          {isReading && (
            <div className="flex flex-col items-center justify-center p-12 space-y-3">
              <Loader2 className="w-8 h-8 text-pink-600 animate-spin" />
              <p className="text-sm font-medium text-foreground">Lendo mensagens no navegador...</p>
              <p className="text-xs text-muted-foreground">Nenhum dado sai do seu computador sem sua confirmação.</p>
            </div>
          )}

          {/* Avisos Bloqueantes/Informativos */}
          {parseResult?.warning === "needs_unzip" && (
            <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <AlertTitle className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                Arquivo compactado (.zip) selecionado
              </AlertTitle>
              <AlertDescription className="text-xs text-amber-700 dark:text-amber-300/90 mt-1">
                O navegador não consegue ler os arquivos diretamente de dentro de um arquivo compactado.
                Por favor, <strong>descompacte o arquivo .zip</strong> no seu computador e selecione a pasta descompactada resultante.
              </AlertDescription>
            </Alert>
          )}

          {parseResult?.warning === "needs_json_export" && (
            <Alert variant="destructive" className="border-rose-500/50 bg-rose-500/10 text-rose-900 dark:text-rose-200">
              <AlertCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              <AlertTitle className="text-xs font-semibold text-rose-800 dark:text-rose-300">
                Exportação em formato HTML detectada
              </AlertTitle>
              <AlertDescription className="text-xs text-rose-700 dark:text-rose-300/90 mt-1">
                Esta exportação foi gerada no formato HTML. Para que as mensagens sejam lidas com precisão, a exportação precisa ser solicitada no Instagram com o <strong>formato JSON</strong> selecionado.
              </AlertDescription>
            </Alert>
          )}

          {parseResult?.warning === "no_conversations_found" && (
            <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <AlertTitle className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                Nenhuma conversa encontrada
              </AlertTitle>
              <AlertDescription className="text-xs text-amber-700 dark:text-amber-300/90 mt-1">
                A pasta selecionada não contém a pasta <strong>'messages/inbox'</strong> com arquivos message_*.json. Certifique-se de selecionar a pasta raiz gerada pela exportação do Instagram.
              </AlertDescription>
            </Alert>
          )}

          {/* Prévia dos Dois Grupos (quando há resultado sem warning impeditivo) */}
          {parseResult && !parseResult.warning && (
            <div className="space-y-3">
              {/* Botões das duas abas principais / contadores */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="tab-with-phone"
                  onClick={() => setActiveGroupTab("with_phone")}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    activeGroupTab === "with_phone"
                      ? "border-emerald-500 bg-emerald-500/10 shadow-sm ring-1 ring-emerald-500"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      Com WhatsApp
                    </span>
                    <Badge className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 font-bold">
                      {parseResult.withPhone.length}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Telefone identificado na conversa
                  </p>
                </button>

                <button
                  type="button"
                  data-testid="tab-without-phone"
                  onClick={() => setActiveGroupTab("without_phone")}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    activeGroupTab === "without_phone"
                      ? "border-amber-500 bg-amber-500/10 shadow-sm ring-1 ring-amber-500"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <Instagram className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      Sem WhatsApp
                    </span>
                    <Badge variant="outline" className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 font-bold">
                      {parseResult.withoutPhone.length}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Trabalho manual via Direct
                  </p>
                </button>
              </div>

              {/* Banner contextual da aba */}
              {activeGroupTab === "with_phone" ? (
                <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span>Estes contatos entrarão diretamente no CRM como leads mornos.</span>
                </div>
              ) : (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                  <Users className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  <span>Estes contatos irão para a sua Lista de Trabalho Manual para solicitar o WhatsApp via Direct.</span>
                </div>
              )}

              {/* Sub-filtros e Ações de Seleção (Possíveis Clientes vs Conversas Pessoais) */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-border">
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant={categoryFilter === "lead" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setCategoryFilter("lead")}
                    className={`h-7 px-2.5 text-xs rounded-full gap-1.5 ${
                      categoryFilter === "lead"
                        ? "bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Sparkles className="w-3 h-3" />
                    Possíveis Clientes ({totalLeadsInGroup})
                  </Button>

                  <Button
                    type="button"
                    variant={categoryFilter === "personal" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setCategoryFilter("personal")}
                    className={`h-7 px-2.5 text-xs rounded-full gap-1.5 ${
                      categoryFilter === "personal"
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Users className="w-3 h-3" />
                    Conversas Pessoais ({totalPersonalInGroup})
                  </Button>

                  <Button
                    type="button"
                    variant={categoryFilter === "all" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setCategoryFilter("all")}
                    className={`h-7 px-2 text-xs rounded-full ${
                      categoryFilter === "all"
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Todos ({currentGroupList.length})
                  </Button>
                </div>

                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {totalLeadsInGroup > 0 && (
                    <button
                      type="button"
                      onClick={selectOnlyLeads}
                      className="text-pink-600 dark:text-pink-400 hover:underline font-medium"
                    >
                      Selecionar Apenas Clientes
                    </button>
                  )}
                  <span>•</span>
                  <button
                    type="button"
                    onClick={selectAll}
                    className="hover:underline"
                  >
                    Todos
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={deselectAll}
                    className="hover:underline"
                  >
                    Nenhum
                  </button>
                </div>
              </div>

              {/* Lista dos Contatos do Grupo Atual */}
              {currentFilteredList.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground border border-dashed border-border rounded-lg bg-muted/10">
                  {categoryFilter === "lead"
                    ? "Nenhum possível cliente identificado com dúvidas ou interesse comercial nesta aba."
                    : categoryFilter === "personal"
                    ? "Nenhuma conversa pessoal identificada nesta aba."
                    : "Nenhum contato encontrado nesta exportação."}
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto border border-border rounded-lg divide-y divide-border text-xs">
                  {currentFilteredList.map((c, i) => {
                    const key = getContactKey(c);
                    const isSelected = selectedKeys.has(key);
                    const cleanResumo = c.resumo
                      ? c.resumo.replace(/^🚫\s*(?:Conversa\s+pessoal|Conversa\s+casual|Pessoal)?[:\s-]*/i, "").replace(/^["']|["']$/g, "")
                      : "";

                    return (
                      <div
                        key={i}
                        onClick={() => toggleSelect(key)}
                        className={`p-2.5 flex items-start gap-2.5 transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-pink-500/[0.04] hover:bg-pink-500/[0.07]"
                            : "hover:bg-muted/30 opacity-70"
                        }`}
                      >
                        <Checkbox
                          id={`select-${key}`}
                          checked={isSelected}
                          onCheckedChange={() => toggleSelect(key)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-0.5"
                        />

                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                              <span className="font-semibold text-foreground flex items-center gap-1">
                                <User className="w-3 h-3 text-muted-foreground" />
                                {c.name}
                              </span>

                              {c.category === "lead" ? (
                                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 text-[10px] py-0 px-1.5 font-medium flex items-center gap-1">
                                  <Sparkles className="w-2.5 h-2.5 text-emerald-600" />
                                  Possível Cliente
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="bg-muted text-muted-foreground border-border text-[10px] py-0 px-1.5">
                                  Conversa Pessoal
                                </Badge>
                              )}

                              {c.intentLabel && c.category === "lead" && (
                                <Badge variant="secondary" className="text-[10px] py-0 px-1.5 font-normal">
                                  {c.intentLabel}
                                </Badge>
                              )}
                            </div>

                            {c.phone ? (
                              <Badge
                                variant="outline"
                                className="font-mono text-[11px] bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 flex-shrink-0"
                              >
                                {c.phone}
                              </Badge>
                            ) : (
                              <span className="text-[11px] text-muted-foreground font-mono flex-shrink-0">
                                {c.perfil}
                              </span>
                            )}
                          </div>

                          {cleanResumo && (
                            <p
                              className={`text-[11px] line-clamp-2 italic ${
                                c.category === "lead"
                                  ? "text-foreground font-medium"
                                  : "text-muted-foreground"
                              }`}
                            >
                              "{cleanResumo}"
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="pt-3 border-t border-border flex items-center justify-between gap-2">
          {parseResult ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetState}
              className="text-xs"
              disabled={importMutation.isPending}
            >
              Trocar Pasta / Arquivos
            </Button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClose}
              className="text-xs"
              disabled={importMutation.isPending}
            >
              Cancelar
            </Button>

            <Button
              type="button"
              size="sm"
              disabled={
                !hasContacts ||
                parseResult?.warning != null ||
                selectedCountInTotal === 0 ||
                importMutation.isPending ||
                isReading
              }
              onClick={handleConfirmImport}
              className="bg-pink-600 hover:bg-pink-700 text-white text-xs gap-2 font-medium"
            >
              {importMutation.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Importando...
                </>
              ) : selectedCountInTotal > 0 ? (
                `Confirmar Importação (${selectedCountInTotal})`
              ) : (
                "Confirmar Importação"
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
