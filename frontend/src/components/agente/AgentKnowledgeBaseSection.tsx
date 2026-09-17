import { useState } from "react";
import { Database, FileText, Trash2, RefreshCw, FileUp, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import {
  useRagDocuments,
  useUploadRagDocument,
  useDeleteRagDocument,
  useReprocessRagDocument,
  type RagDocument,
} from "@/hooks/useRagDocuments";

// "Um agente por chip" — Commit 4: base de conhecimento POR AGENTE.
// rag_documents.company_id já existe e a busca (chatbot-ai-engine.js, leva
// anterior) já escopa por ele — documento amarrado a um agente só entra na
// busca daquele agente; documento sem agente (company_id null) vale pro
// tenant inteiro. Esta seção só passa companyId no upload/listagem e deixa
// explícito, por documento, qual dos dois casos é.
//
// Mesmo interruptor RAG_LIVE da aba tenant-wide (KnowledgeBaseRagTab): a
// leva de RAG continua "em breve" até o teste ponta a ponta confirmar
// GEMINI_API_KEY funcionando em produção.
const RAG_LIVE = import.meta.env.VITE_RAG_TAB_LIVE === "true";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_BADGE: Record<RagDocument["status"], { label: string; className: string; icon: React.ReactNode }> = {
  ready: { label: "Pronto", className: "text-emerald-600 border-emerald-500/30", icon: <FileText className="w-3 h-3" /> },
  pending: { label: "Na fila", className: "text-amber-600 border-amber-500/30", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  processing: { label: "Indexando", className: "text-cyan-600 border-cyan-500/30", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  failed: { label: "Falhou", className: "text-rose-600 border-rose-500/30", icon: <XCircle className="w-3 h-3" /> },
};

export function AgentKnowledgeBaseSection({ clientId, companyId }: { clientId: string | undefined; companyId: string | undefined }) {
  const { data: documents = [], isLoading } = useRagDocuments(RAG_LIVE ? clientId : undefined, companyId);
  const uploadMutation = useUploadRagDocument(clientId, companyId);
  const deleteMutation = useDeleteRagDocument(clientId);
  const reprocessMutation = useReprocessRagDocument(clientId);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    uploadMutation.mutate(file, {
      onSuccess: () => toast.success(`"${file.name}" enviado — vale só para este agente.`),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao enviar o documento."),
    });
  };

  const handleDelete = (doc: RagDocument) => {
    setDeletingId(doc.id);
    deleteMutation.mutate(doc.id, {
      onSuccess: () => toast.success(`"${doc.filename}" apagado.`),
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

  return (
    <Card className="border-border dark:border-zinc-800">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-base font-bold">Base de Conhecimento deste Agente</CardTitle>
              <CardDescription className="text-xs">
                Documentos amarrados aqui só entram nas respostas deste agente. Documentos sem agente (tenant inteiro) também aparecem, marcados abaixo.
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className={`text-xs font-bold ${RAG_LIVE ? "bg-cyan-500/10 text-cyan-600 border-cyan-500/30" : "bg-amber-500/10 text-amber-600 border-amber-500/30"}`}>
            {RAG_LIVE ? "⚡ Ativo" : "Em breve"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={`border-2 border-dashed rounded-xl p-5 text-center transition-colors bg-muted/10 relative ${
            RAG_LIVE ? "border-border dark:border-zinc-800 hover:border-cyan-500/50 cursor-pointer" : "border-border/50 dark:border-zinc-800/50 cursor-not-allowed opacity-60"
          }`}
        >
          <input
            type="file"
            accept=".pdf,.docx,.txt,.md"
            onChange={handleUpload}
            disabled={!RAG_LIVE || !companyId || uploadMutation.isPending}
            className="absolute inset-0 opacity-0 w-full h-full disabled:cursor-not-allowed"
          />
          <div className="flex flex-col items-center gap-1.5 text-xs">
            {uploadMutation.isPending ? <RefreshCw className="w-5 h-5 animate-spin text-cyan-600" /> : <FileUp className="w-5 h-5 text-cyan-600" />}
            <p className="font-semibold text-foreground">
              {RAG_LIVE ? "Clique ou arraste um arquivo para indexar SÓ para este agente" : "Disponível em breve"}
            </p>
            <p className="text-muted-foreground">PDF, DOCX, TXT ou MD — até 20 MB</p>
          </div>
        </div>

        {!RAG_LIVE && (
          <p className="text-xs text-muted-foreground text-center py-2">Esta leva ainda não está no ar.</p>
        )}

        {RAG_LIVE && isLoading && <p className="text-xs text-muted-foreground text-center py-4">Carregando...</p>}

        {RAG_LIVE && !isLoading && documents.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">Nenhum documento ainda — nem deste agente, nem do tenant.</p>
        )}

        {RAG_LIVE &&
          documents.map((doc) => {
            const statusInfo = STATUS_BADGE[doc.status];
            const doTenantInteiro = !doc.companyId;
            return (
              <div key={doc.id} className="flex items-center justify-between p-3 rounded-xl border border-border dark:border-zinc-800 bg-muted/20 text-xs gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="w-4 h-4 text-cyan-600 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{doc.filename}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatBytes(doc.sizeBytes)} · {doc.chunkCount} trecho(s) ·{" "}
                      <span className={doTenantInteiro ? "text-amber-600" : "text-emerald-600"}>
                        {doTenantInteiro ? "vale para o tenant inteiro" : "só deste agente"}
                      </span>
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
                      Reindexar
                    </Badge>
                  )}
                  {(doc.status === "failed" || doc.needsReindex) && (
                    <Button size="sm" variant="ghost" onClick={() => handleReprocess(doc)} className="h-7 w-7 p-0 text-muted-foreground hover:text-cyan-500" title="Reprocessar">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" disabled={deletingId === doc.id} className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-500" title="Apagar">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Apagar "{doc.filename}"?</AlertDialogTitle>
                        <AlertDialogDescription className="text-xs text-muted-foreground">
                          Apaga o arquivo, os trechos e o registro. {doTenantInteiro ? "Vale para o tenant inteiro — outros agentes deixam de enxergar também." : "Só este agente é afetado."} Não pode ser desfeito.
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
  );
}
