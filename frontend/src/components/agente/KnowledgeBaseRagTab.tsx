import { useState } from "react";
import { Database, FileText, Trash2, Search, CheckCircle2, RefreshCw, FileUp, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import {
  useRagDocuments,
  useUploadRagDocument,
  useDeleteRagDocument,
  useReprocessRagDocument,
  useRagSearchTest,
  type RagDocument,
} from "@/hooks/useRagDocuments";

// Leva 2 (Commit 4): o código abaixo já fala com a API real. Fica atrás de um
// interruptor porque o backend de produção não tem GEMINI_API_KEY configurada
// hoje (medido via /api/chatbot-llm-models) — um upload real falharia na
// primeira chamada de embedding. Enquanto isso não for resolvido e testado
// ponta a ponta, a aba mostra "Em breve", inclusive pra quem já paga pelo
// módulo: uma maquete que finge funcionar é pior do que avisar que não chegou.
const RAG_LIVE = import.meta.env.VITE_RAG_TAB_LIVE === "true";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_BADGE: Record<RagDocument["status"], { label: string; className: string; icon: React.ReactNode }> = {
  ready: { label: "Pronto", className: "text-emerald-600 border-emerald-500/30", icon: <CheckCircle2 className="w-3 h-3" /> },
  pending: { label: "Na fila", className: "text-amber-600 border-amber-500/30", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  processing: { label: "Indexando", className: "text-cyan-600 border-cyan-500/30", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  failed: { label: "Falhou", className: "text-rose-600 border-rose-500/30", icon: <XCircle className="w-3 h-3" /> },
};

export function KnowledgeBaseRagTab() {
  const crmClient = useOptionalCrmClient();
  const clientId = crmClient?.selectedClient?.id || crmClient?.selectedClientId || undefined;

  const { data: documents = [], isLoading } = useRagDocuments(RAG_LIVE ? clientId : undefined);
  const uploadMutation = useUploadRagDocument(clientId);
  const deleteMutation = useDeleteRagDocument(clientId);
  const reprocessMutation = useReprocessRagDocument(clientId);
  const searchTestMutation = useRagSearchTest(clientId);

  const [searchTest, setSearchTest] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    uploadMutation.mutate(file, {
      onSuccess: () => toast.success(`"${file.name}" enviado. Entrou na fila de indexação.`),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao enviar o documento."),
    });
  };

  const handleDelete = (doc: RagDocument) => {
    setDeletingId(doc.id);
    deleteMutation.mutate(doc.id, {
      onSuccess: () => toast.success(`"${doc.filename}" apagado da base de conhecimento.`),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao apagar o documento."),
      onSettled: () => setDeletingId(null),
    });
  };

  const handleReprocess = (doc: RagDocument) => {
    reprocessMutation.mutate(doc.id, {
      onSuccess: () => toast.success(`Reprocessando "${doc.filename}".`),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao reprocessar o documento."),
    });
  };

  const handleTestSearch = () => {
    if (!searchTest.trim()) return;
    searchTestMutation.mutate(searchTest, {
      onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao testar a busca."),
    });
  };

  const testResult = searchTestMutation.data;

  return (
    <div className="space-y-6 animate-in fade-in-50">
      {/* Upload Zone */}
      <Card className="border-border dark:border-zinc-800">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-base font-bold">Base de Conhecimento Vetorial RAG</CardTitle>
                <CardDescription className="text-xs">
                  Faça upload de catálogos, tabelas de preços, manuais técnicos e políticas da empresa em PDF ou DOCX para o Agente IA consultar em tempo real sem alucinações.
                </CardDescription>
              </div>
            </div>
            {RAG_LIVE ? (
              <Badge variant="outline" className="bg-cyan-500/10 text-cyan-600 border-cyan-500/30 text-xs font-bold">
                ⚡ Vector Search (RAG)
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-xs font-bold">
                Em breve
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors bg-muted/10 relative ${
              RAG_LIVE
                ? "border-border dark:border-zinc-800 hover:border-cyan-500/50 cursor-pointer"
                : "border-border/50 dark:border-zinc-800/50 cursor-not-allowed opacity-60"
            }`}
          >
            <input
              type="file"
              accept=".pdf,.docx,.txt,.md"
              onChange={handleUpload}
              disabled={!RAG_LIVE || uploadMutation.isPending}
              className="absolute inset-0 opacity-0 w-full h-full disabled:cursor-not-allowed"
            />
            <div className="flex flex-col items-center gap-2">
              <div className="p-3 rounded-full bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
                {uploadMutation.isPending ? <RefreshCw className="w-6 h-6 animate-spin" /> : <FileUp className="w-6 h-6" />}
              </div>
              <p className="text-sm font-semibold text-foreground">
                {RAG_LIVE
                  ? uploadMutation.isPending
                    ? "Enviando..."
                    : "Clique ou arraste seus arquivos aqui para indexar no RAG"
                  : "Upload de documentos disponível em breve"}
              </p>
              <p className="text-xs text-muted-foreground">Formatos suportados: PDF, DOCX, TXT, MD (até 20 MB por arquivo)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Documentos Indexados */}
      <Card className="border-border dark:border-zinc-800">
        <CardHeader className="p-4 pb-2 border-b border-border dark:border-zinc-800">
          <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-cyan-500" />
            Documentos Indexados na Base ({RAG_LIVE ? documents.length : 0})
          </span>
        </CardHeader>
        <CardContent className="p-3 space-y-2">
          {!RAG_LIVE && (
            <p className="text-xs text-muted-foreground text-center py-6">
              Esta leva ainda não está no ar. Assim que publicada, os documentos enviados aparecem aqui.
            </p>
          )}
          {RAG_LIVE && isLoading && <p className="text-xs text-muted-foreground text-center py-6">Carregando documentos...</p>}
          {RAG_LIVE && !isLoading && documents.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">
              Nenhum documento na base ainda. Envie um PDF, DOCX, TXT ou MD acima.
            </p>
          )}
          {RAG_LIVE &&
            documents.map((doc) => {
              const statusInfo = STATUS_BADGE[doc.status];
              return (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-3 rounded-xl border border-border dark:border-zinc-800 bg-muted/20 text-xs gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-600 shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">{doc.filename}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatBytes(doc.sizeBytes)} • {doc.chunkCount} {doc.chunkCount === 1 ? "trecho" : "trechos"} • Adicionado{" "}
                        {formatDate(doc.createdAt)}
                      </p>
                      {doc.status === "failed" && doc.errorLog && <p className="text-[11px] text-rose-500 mt-0.5">{doc.errorLog}</p>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className={`text-[10px] gap-1 ${statusInfo.className}`}>
                      {statusInfo.icon}
                      {statusInfo.label}
                    </Badge>

                    {doc.needsReindex && (
                      <Badge variant="outline" className="text-[10px] gap-1 text-amber-600 border-amber-500/30">
                        <AlertTriangle className="w-3 h-3" />
                        Precisa reindexar
                      </Badge>
                    )}

                    {(doc.status === "failed" || doc.needsReindex) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleReprocess(doc)}
                        disabled={reprocessMutation.isPending}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-cyan-500"
                        title="Reprocessar"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </Button>
                    )}

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={deletingId === doc.id}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-500"
                          title="Apagar"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Apagar "{doc.filename}"?</AlertDialogTitle>
                          <AlertDialogDescription className="text-xs text-muted-foreground">
                            Isso apaga o arquivo, todos os {doc.chunkCount} trechos indexados e o registro da base de conhecimento. O
                            Agente IA deixa de enxergar este documento imediatamente. Não pode ser desfeito.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="h-8 text-xs">Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(doc)} className="h-8 text-xs bg-rose-600 hover:bg-rose-700 text-white">
                            Apagar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              );
            })}
        </CardContent>
      </Card>

      {/* Teste de Recuperação Vetorial */}
      <Card className="border-border dark:border-zinc-800">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-xs font-bold flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-cyan-500" />
            Simulador de Busca Semântica RAG
          </CardTitle>
          <CardDescription className="text-[11px]">
            Faça uma pergunta como se fosse o cliente pra ver os trechos recuperados e a semelhança de cada um — é assim que dá pra
            calibrar o limiar sem chutar.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-2 space-y-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Ex.: Quais os diferenciais e preços do Plano Avançado?"
              value={searchTest}
              onChange={(e) => setSearchTest(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleTestSearch()}
              disabled={!RAG_LIVE || searchTestMutation.isPending}
              className="text-xs"
            />
            <Button
              size="sm"
              onClick={handleTestSearch}
              disabled={!RAG_LIVE || searchTestMutation.isPending || !searchTest.trim()}
              className="text-xs bg-cyan-600 hover:bg-cyan-700 text-white gap-1.5"
            >
              {searchTestMutation.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
              Testar RAG
            </Button>
          </div>

          {!RAG_LIVE && <p className="text-[11px] text-muted-foreground">Disponível em breve, junto com o restante desta leva.</p>}

          {RAG_LIVE && testResult && (
            <div className="space-y-2">
              {!testResult.applies && (
                <p className="text-xs text-muted-foreground p-3 rounded-xl bg-muted/20 border border-border dark:border-zinc-800">
                  Nenhum documento pronto para este cliente ainda.
                </p>
              )}
              {testResult.applies && testResult.chunks.length === 0 && (
                <p className="text-xs text-muted-foreground p-3 rounded-xl bg-muted/20 border border-border dark:border-zinc-800">
                  Nenhum trecho candidato encontrado.
                </p>
              )}
              {testResult.chunks.map((chunk, i) => (
                <div
                  key={`${chunk.documentId}-${i}`}
                  className={`p-3 rounded-xl border text-xs space-y-1 ${
                    chunk.passesThreshold ? "bg-cyan-500/5 border-cyan-500/20" : "bg-muted/10 border-border dark:border-zinc-800 opacity-70"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 font-sans">
                    <span className="text-[11px] font-bold text-cyan-600 dark:text-cyan-400 truncate">{chunk.filename || "Documento"}</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] shrink-0 ${
                        chunk.passesThreshold ? "text-emerald-600 border-emerald-500/30" : "text-muted-foreground border-border"
                      }`}
                    >
                      Similaridade {(chunk.similarity * 100).toFixed(1)}%{chunk.passesThreshold ? " • passa no limiar" : " • abaixo do limiar"}
                    </Badge>
                  </div>
                  <p className="whitespace-pre-line leading-relaxed text-foreground font-mono">{chunk.content}</p>
                </div>
              ))}
              {testResult.needsReindexDocumentIds.length > 0 && (
                <p className="text-[11px] text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {testResult.needsReindexDocumentIds.length} documento(s) precisam reindexar antes de entrar nesta busca.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
