import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Sparkles,
  Bot,
  User,
  Send,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  HelpCircle,
  ExternalLink,
  RotateCcw,
  Loader2,
  Calendar,
  MessageSquare,
  FileQuestion,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { fetchApi } from "@/lib/api";
import { auth } from "@/lib/firebase";
import {
  gerarTresPerguntasSugeridas,
  PerguntaSugerida,
  EXPLICACAO_FORA_DA_BASE,
} from "@/lib/geracaoDigital/briefingSimulatorQuestions";
import {
  calculateImplementationReadiness,
  ImplementationReadinessReport,
} from "@/lib/geracaoDigital/briefingReadiness";

interface ChatMessage {
  id: string;
  sender: "user" | "bot";
  text: string;
  isForaDaBase?: boolean;
  time: string;
}

interface BriefingSimulatorAndReadinessProps {
  tenantId: string;
  clientName: string;
  segmento: string;
  cincoObjecoes: Array<{ id: number; objecao: string; resposta: string }>;
  briefingId: string | null;
  testPerformedAt?: string | null;
  testQuestionsCount?: number;
  knowledgeFilesCount?: number;
  promptContent?: string;
  onTestRecorded?: (data: { test_performed_at: string; test_questions_count: number }) => void;
  onGoToStep?: (step: number) => void;
}

export function BriefingSimulatorAndReadiness({
  tenantId,
  clientName,
  segmento,
  cincoObjecoes,
  briefingId,
  testPerformedAt: initialTestPerformedAt,
  testQuestionsCount: initialTestQuestionsCount = 0,
  knowledgeFilesCount = 0,
  promptContent = "",
  onTestRecorded,
  onGoToStep,
}: BriefingSimulatorAndReadinessProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [inputQuestion, setInputQuestion] = useState("");
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [localTestDate, setLocalTestDate] = useState<string | null>(initialTestPerformedAt || null);
  const [localTestCount, setLocalTestCount] = useState<number>(initialTestQuestionsCount || 0);

  // Gera as 3 perguntas sugeridas dinamicamente
  const perguntasSugeridas: PerguntaSugerida[] = gerarTresPerguntasSugeridas({
    segmento,
    cincoObjecoes,
  });

  // Busca prontidão real da implantação do backend
  const { data: readinessData, isLoading: isLoadingReadiness, refetch: refetchReadiness } = useQuery<{
    success: boolean;
    data: ImplementationReadinessReport;
  }>({
    queryKey: ["implementation-readiness", tenantId],
    queryFn: async () => {
      if (!tenantId) {
        return {
          success: true,
          data: calculateImplementationReadiness({
            activeChipsCount: 0,
            documentsCount: knowledgeFilesCount,
            promptContent,
          }),
        };
      }
      try {
        const token = await auth.currentUser?.getIdToken();
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const res = await fetchApi(`/api/gd/implementation-readiness/${tenantId}`, { headers });
        if (!res.ok) {
          throw new Error("Falha ao buscar prontidão");
        }
        return await res.json();
      } catch {
        // Fallback defensivo usando pure calculation
        return {
          success: true,
          data: calculateImplementationReadiness({
            activeChipsCount: 0,
            documentsCount: knowledgeFilesCount,
            promptContent,
          }),
        };
      }
    },
    enabled: Boolean(tenantId),
    staleTime: 1000 * 30, // 30s
  });

  const readinessReport = readinessData?.data || calculateImplementationReadiness({
    activeChipsCount: 0,
    documentsCount: knowledgeFilesCount,
    promptContent,
  });

  // Mutação para registrar que o teste aconteceu (apenas data e contador)
  const recordTestMutation = useMutation({
    mutationFn: async () => {
      if (!briefingId) return null;
      const token = await auth.currentUser?.getIdToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetchApi(`/api/gd/implementation-briefings/${briefingId}/record-test`, {
        method: "POST",
        headers,
        body: JSON.stringify({ test_questions_count: 1 }),
      });
      if (!res.ok) throw new Error("Erro ao registrar teste");
      return await res.json();
    },
    onSuccess: (data) => {
      if (data) {
        setLocalTestDate(data.test_performed_at);
        setLocalTestCount(data.test_questions_count);
        onTestRecorded?.({
          test_performed_at: data.test_performed_at,
          test_questions_count: data.test_questions_count,
        });
        queryClient.invalidateQueries({ queryKey: ["gd-implementation-briefings"] });
      }
    },
  });

  // Mutação para simular pergunta usando a rota oficial /api/chatbot-test
  const simulateMutation = useMutation({
    mutationFn: async (perguntaTexto: string) => {
      const token = await auth.currentUser?.getIdToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetchApi("/api/chatbot-test", {
        method: "POST",
        headers,
        body: JSON.stringify({
          clientId: tenantId || "geracao-digital",
          client_id: tenantId || "geracao-digital",
          message: perguntaTexto,
          phone: "5500000000000",
          isSimulation: true,
          noPersist: true,
          simulation: true,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.reason || errJson?.error || "Erro ao simular resposta do modelo");
      }
      return await res.json();
    },
    onSuccess: (data, perguntaTexto) => {
      const nowStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const botResponse = data.response || "O agente gerou a resposta sem texto explícito.";

      // Adiciona ao histórico visual local (em memória apenas, nada vai pro banco)
      setChatMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          sender: "bot",
          text: botResponse,
          time: nowStr,
        },
      ]);

      // Incrementa métricas de teste
      const newCount = localTestCount + 1;
      const nowDateIso = new Date().toISOString();
      setLocalTestCount(newCount);
      setLocalTestDate(nowDateIso);

      if (briefingId) {
        recordTestMutation.mutate();
      } else {
        onTestRecorded?.({
          test_performed_at: nowDateIso,
          test_questions_count: newCount,
        });
      }

      toast({
        title: "Resposta Simulada",
        description: "O modelo respondeu com base nas regras configuradas no briefing.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Simulação não concluída",
        description: err.message || "Não foi possível conectar ao motor do agente.",
        variant: "destructive",
      });
    },
  });

  const handleSelectQuestion = (item: PerguntaSugerida) => {
    setSelectedQuestionId(item.id);
    setInputQuestion(item.pergunta);
  };

  const handleSendQuestion = (overrideQuestion?: string) => {
    const questionToSend = (overrideQuestion || inputQuestion).trim();
    if (!questionToSend) return;

    const nowStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const isOutOfBase = selectedQuestionId === "pergunta_3_fora_da_base" || questionToSend.toLowerCase().includes("casamento fechado") || questionToSend.toLowerCase().includes("tailândia");

    setChatMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        sender: "user",
        text: questionToSend,
        isForaDaBase: isOutOfBase,
        time: nowStr,
      },
    ]);

    setInputQuestion("");
    simulateMutation.mutate(questionToSend);
  };

  const handleClearChat = () => {
    setChatMessages([]);
  };

  return (
    <div className="space-y-8">
      {/* 1. CARD PRINCIPAL: O SIMULADOR NO FIM DA IMPLANTAÇÃO */}
      <Card className="border-indigo-200 dark:border-indigo-900/50 bg-gradient-to-br from-indigo-50/30 via-white to-slate-50 dark:from-slate-900 dark:to-indigo-950/20 shadow-sm overflow-hidden">
        <CardHeader className="border-b border-indigo-100/60 dark:border-slate-800 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-indigo-600 text-white shadow-sm">
                  <Bot className="h-5 w-5" />
                </div>
                <CardTitle className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                  Simulação de Conclusão & Demonstração ao Cliente
                </CardTitle>
                <Badge className="bg-indigo-600 text-white font-bold text-[10px]">
                  Ao Vivo na Reunião
                </Badge>
              </div>
              <CardDescription className="text-xs text-slate-600 dark:text-slate-400">
                A reunião termina com o cliente vendo o robô responder com as palavras que ele mesmo deu, três telas atrás.
              </CardDescription>
            </div>

            {/* STATUS DO REGISTRO DE TESTE */}
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 bg-indigo-50/70 dark:bg-slate-800/80 px-3 py-1.5 rounded-lg border border-indigo-100 dark:border-slate-700">
              <Calendar className="h-4 w-4 text-indigo-500" />
              {localTestDate ? (
                <div>
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    Testado em: {new Date(localTestDate).toLocaleDateString("pt-BR")} às{" "}
                    {new Date(localTestDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="mx-1.5">•</span>
                  <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                    {localTestCount} pergunta(s)
                  </span>
                </div>
              ) : (
                <span className="italic text-slate-500">Nenhum teste registrado ainda</span>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-5 sm:p-6 space-y-6">
          {/* AVISO INEQUÍVOCO DE SIMULAÇÃO */}
          <div className="flex items-start gap-3 p-3.5 bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 rounded-xl text-xs text-blue-900 dark:text-blue-200">
            <ShieldCheck className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold">
                Ambiente de Simulação Isolado (Zero Impacto em Produção)
              </p>
              <p className="text-[11px] leading-relaxed text-blue-800 dark:text-blue-300">
                Nada é enviado para ninguém e nenhum número recebe mensagem pelo WhatsApp. Esta simulação não cria lead, não cria conversa e não grava mensagens no Banco de Dados nem nas Conversas.
              </p>
            </div>
          </div>

          {/* TRÊS PERGUNTAS SUGERIDAS */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-amber-500" />
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Três Perguntas Sugeridas para a Reunião
                </h4>
              </div>
              <span className="text-[11px] text-slate-500 italic">
                Clique para carregar ou testar direto
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {perguntasSugeridas.map((item, idx) => {
                const isSelected = selectedQuestionId === item.id;
                return (
                  <div
                    key={item.id}
                    onClick={() => handleSelectQuestion(item)}
                    className={`group relative p-3.5 rounded-xl border text-left cursor-pointer transition-all duration-150 flex flex-col justify-between ${
                      isSelected
                        ? "border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 shadow-sm ring-1 ring-indigo-500"
                        : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-indigo-300 dark:hover:border-slate-700 hover:shadow-sm"
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-1">
                        {item.isForaDaBase ? (
                          <Badge
                            variant="outline"
                            className="bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800 font-black text-[10px] uppercase tracking-wide gap-1"
                          >
                            <AlertCircle className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                            Fora da base
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="text-[10px] font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800"
                          >
                            {item.tituloBadge}
                          </Badge>
                        )}
                        <span className="text-[10px] text-slate-400 font-mono">#{idx + 1}</span>
                      </div>

                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 leading-snug line-clamp-3">
                        "{item.pergunta}"
                      </p>

                      {/* EXPLICAÇÃO CRÍTICA NA TELA */}
                      {item.explicacao && (
                        <p
                          className={`text-[11px] leading-tight pt-1 ${
                            item.isForaDaBase
                              ? "text-amber-700 dark:text-amber-300/90 font-medium italic bg-amber-50/50 dark:bg-amber-950/20 p-1.5 rounded"
                              : "text-slate-500 dark:text-slate-400 text-[10px]"
                          }`}
                        >
                          {item.explicacao}
                        </p>
                      )}
                    </div>

                    <div className="pt-3 mt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px]">
                      <span className="font-bold text-indigo-600 dark:text-indigo-400 group-hover:underline">
                        Usar pergunta
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedQuestionId(item.id);
                          handleSendQuestion(item.pergunta);
                        }}
                        disabled={simulateMutation.isPending}
                        className="h-7 px-2 text-[10px] font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-slate-800 dark:hover:bg-slate-700"
                      >
                        Simular
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ÁREA DO CHAT DA SIMULAÇÃO */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <MessageSquare className="h-4 w-4 text-slate-500" />
                Diálogo Simulado (Visível para o Cliente)
              </span>
              {chatMessages.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleClearChat}
                  className="h-7 text-[11px] text-slate-500 hover:text-slate-700 gap-1"
                >
                  <RotateCcw className="h-3 w-3" />
                  Limpar tela
                </Button>
              )}
            </div>

            <div className="min-h-[160px] max-h-[320px] overflow-y-auto p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 space-y-3">
              {chatMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-center text-slate-400 text-xs space-y-2">
                  <FileQuestion className="h-8 w-8 text-slate-300 dark:text-slate-600" />
                  <p>Nenhuma mensagem enviada ainda.</p>
                  <p className="text-[11px] text-slate-400 max-w-sm">
                    Escolha uma das três perguntas sugeridas acima ou digite uma dúvida abaixo para testar o agente na frente do cliente.
                  </p>
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex items-start gap-2.5 ${
                      msg.sender === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    {msg.sender === "bot" && (
                      <div className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs shrink-0 mt-0.5 shadow-sm">
                        <Bot className="h-4 w-4" />
                      </div>
                    )}
                    <div
                      className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-2.5 text-xs shadow-xs space-y-1 ${
                        msg.sender === "user"
                          ? "bg-indigo-600 text-white rounded-tr-xs"
                          : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-tl-xs"
                      }`}
                    >
                      {msg.isForaDaBase && msg.sender === "user" && (
                        <div className="text-[10px] text-indigo-100 font-semibold uppercase tracking-wide flex items-center gap-1 border-b border-indigo-500/50 pb-1 mb-1">
                          <AlertCircle className="h-3 w-3" />
                          Pergunta fora da base
                        </div>
                      )}
                      <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                      <div
                        className={`text-[9px] text-right ${
                          msg.sender === "user" ? "text-indigo-200" : "text-slate-400"
                        }`}
                      >
                        {msg.time}
                      </div>
                    </div>
                    {msg.sender === "user" && (
                      <div className="w-7 h-7 rounded-full bg-slate-300 dark:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center text-xs shrink-0 mt-0.5">
                        <User className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                ))
              )}

              {simulateMutation.isPending && (
                <div className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400 p-2 italic animate-pulse">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  O agente de atendimento está pensando e formulando a resposta...
                </div>
              )}
            </div>

            {/* INPUT DE PERGUNTA EDITÁVEL */}
            <div className="flex items-center gap-2 pt-1">
              <Input
                placeholder="Edite a pergunta ou digite uma dúvida personalizada..."
                value={inputQuestion}
                onChange={(e) => setInputQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendQuestion();
                  }
                }}
                disabled={simulateMutation.isPending}
                className="h-10 text-xs bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700"
              />
              <Button
                type="button"
                onClick={() => handleSendQuestion()}
                disabled={simulateMutation.isPending || !inputQuestion.trim()}
                className="h-10 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs gap-1.5 shrink-0 shadow-sm"
              >
                {simulateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Simular Pergunta
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. CARD DO QUE FALTA PARA SOLTAR (READINESS CHECKLIST) */}
      <Card className="border-slate-200 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-900">
        <CardHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-black text-slate-900 dark:text-white">
                  O que falta para soltar o agente
                </CardTitle>
                <Badge
                  variant={readinessReport.prontoParaSoltar ? "default" : "outline"}
                  className={
                    readinessReport.prontoParaSoltar
                      ? "bg-emerald-600 text-white font-bold"
                      : "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 font-bold"
                  }
                >
                  {readinessReport.itensProntos} de {readinessReport.totalItens} prontos
                </Badge>
              </div>
              <CardDescription className="text-xs text-slate-600 dark:text-slate-400">
                Itens necessários para colocar o agente em atendimento oficial com o cliente. Este painel reflete o estado real do sistema.
              </CardDescription>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => refetchReadiness()}
              disabled={isLoadingReadiness}
              className="h-8 text-xs font-bold gap-1 self-start sm:self-auto"
            >
              <RotateCcw className={`h-3.5 w-3.5 ${isLoadingReadiness ? "animate-spin" : ""}`} />
              Atualizar Estado
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-5 divide-y divide-slate-100 dark:divide-slate-800">
          {readinessReport.itens.map((item) => (
            <div
              key={item.id}
              className="py-3.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  {item.pronto ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <XCircle className="h-5 w-5 text-amber-500" />
                  )}
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {item.nome}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[9px] px-1.5 py-0 font-bold uppercase tracking-wider ${
                        item.pronto
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400"
                          : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400"
                      }`}
                    >
                      {item.pronto ? "Pronto" : "Pendente"}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {item.descricao}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 pl-8 sm:pl-0">
                {item.id === "base_conhecimento" && onGoToStep ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onGoToStep(3)}
                    className="h-8 text-xs font-bold gap-1.5 border-slate-200 text-slate-700 hover:bg-slate-50"
                  >
                    Passo 3 (Briefing)
                  </Button>
                ) : null}

                <Link to={item.link} target="_blank" rel="noopener noreferrer">
                  <Button
                    type="button"
                    size="sm"
                    variant={item.pronto ? "ghost" : "outline"}
                    className={`h-8 text-xs font-bold gap-1.5 ${
                      item.pronto
                        ? "text-slate-600 hover:text-slate-900"
                        : "border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300"
                    }`}
                  >
                    <span>{item.linkTexto}</span>
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
