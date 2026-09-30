import React, { useState, useRef, useEffect } from "react";
import {
  FileCheck2,
  FolderOpen,
  Sparkles,
  Mic,
  MicOff,
  CheckCircle2,
  Clock,
  AlertCircle,
  HelpCircle,
  Info,
  Loader2,
  Volume2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DocumentoKitItem,
  ParObjecao,
  StatusDocumentoKit,
  SEGMENTOS_KITS,
  LISTA_SEGMENTOS,
  resolveSegmentoKey,
  countFilledObjecoes,
  getUnlockingText,
} from "@/lib/geracaoDigital/briefingSegmentKits";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/lib/api";

interface BriefingDocumentKitAndObjectionsProps {
  segmento: string;
  onSegmentoChange: (segmento: string) => void;
  documentosKit: DocumentoKitItem[];
  onDocumentosKitChange: (itens: DocumentoKitItem[]) => void;
  cincoObjecoes: ParObjecao[];
  onCincoObjecoesChange: (objecoes: ParObjecao[]) => void;
}

export function BriefingDocumentKitAndObjections({
  segmento,
  onSegmentoChange,
  documentosKit,
  onDocumentosKitChange,
  cincoObjecoes,
  onCincoObjecoesChange,
}: BriefingDocumentKitAndObjectionsProps) {
  const { getIdToken } = useAuth();
  const segmentoKey = resolveSegmentoKey(segmento);
  const segmentoDef = SEGMENTOS_KITS[segmentoKey] || SEGMENTOS_KITS.generico;

  // Estado de gravação de áudio por campo
  const [recordingTarget, setRecordingTarget] = useState<{
    id: number;
    field: "objecao" | "resposta";
  } | null>(null);
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [recordingDuration, setRecordingDuration] = useState<number>(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const speechRecognitionRef = useRef<any>(null);

  // Contador de preenchimento e mensagem de destravamento
  const filledCount = countFilledObjecoes(cincoObjecoes);
  const unlockingText = getUnlockingText(filledCount);

  // Mudança de status de um item do kit
  const handleStatusChange = (itemId: string, newStatus: StatusDocumentoKit) => {
    const updated = documentosKit.map((it) => {
      if (it.id === itemId) {
        return {
          ...it,
          status: newStatus,
          // Se mudar de nao_tem para recebido/pendente, preserva a observação ou mantém
          observacao: it.observacao,
        };
      }
      return it;
    });
    onDocumentosKitChange(updated);
  };

  // Atualização da observação quando "cliente não tem"
  const handleObservacaoChange = (itemId: string, text: string) => {
    const updated = documentosKit.map((it) => {
      if (it.id === itemId) {
        return { ...it, observacao: text };
      }
      return it;
    });
    onDocumentosKitChange(updated);
  };

  // Atualização de uma das 5 objeções
  const handleObjecaoChange = (
    id: number,
    field: "objecao" | "resposta",
    value: string
  ) => {
    const updated = cincoObjecoes.map((item) => {
      if (item.id === id) {
        return { ...item, [field]: value };
      }
      return item;
    });
    onCincoObjecoesChange(updated);
  };

  // Limpeza de recursos de áudio
  const cleanupAudio = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        // ignora erro ao parar
      }
    }
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch (e) {
        // ignora
      }
      speechRecognitionRef.current = null;
    }
    setRecordingTarget(null);
    setRecordingDuration(0);
  };

  // Iniciar / Parar gravação de áudio
  const toggleRecording = async (id: number, field: "objecao" | "resposta") => {
    // Se já está gravando este campo específico, para e transcreve
    if (
      recordingTarget &&
      recordingTarget.id === id &&
      recordingTarget.field === field
    ) {
      stopRecordingAndTranscribe();
      return;
    }

    // Se estava gravando outro campo, encerra
    if (recordingTarget) {
      cleanupAudio();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start(500);
      setRecordingTarget({ id, field });
      setRecordingDuration(0);

      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);

      // Tenta usar Web Speech API em paralelo para feedback instantâneo quando disponível
      const SpeechRecognition =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const recognizer = new SpeechRecognition();
          recognizer.lang = "pt-BR";
          recognizer.continuous = true;
          recognizer.interimResults = true;
          recognizer.onresult = (evt: any) => {
            const transcript = Array.from(evt.results)
              .map((r: any) => r[0]?.transcript || "")
              .join(" ");
            if (transcript.trim()) {
              handleObjecaoChange(id, field, transcript);
            }
          };
          recognizer.start();
          speechRecognitionRef.current = recognizer;
        } catch (e) {
          // Web Speech é opcional; prossegue com MediaRecorder
        }
      }
    } catch (err: any) {
      console.warn("Não foi possível acessar o microfone:", err);
      alert(
        "Acesso ao microfone não autorizado ou indisponível. Verifique as permissões do navegador."
      );
      cleanupAudio();
    }
  };

  const stopRecordingAndTranscribe = async () => {
    if (!recordingTarget || !mediaRecorderRef.current) {
      cleanupAudio();
      return;
    }

    const { id, field } = recordingTarget;
    setIsTranscribing(true);

    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch (e) {
        // ignora
      }
      speechRecognitionRef.current = null;
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder.state !== "inactive") {
      recorder.stop();
    }

    // Aguarda término da gravação
    await new Promise((resolve) => setTimeout(resolve, 300));

    try {
      if (audioChunksRef.current.length > 0) {
        const mimeType = audioChunksRef.current[0]
          ? (audioChunksRef.current[0] as Blob).type || "audio/webm"
          : "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: mimeType });

        if (blob.size >= 1000) {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          const token = await getIdToken().catch(() => "");
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (token) headers.Authorization = `Bearer ${token}`;

          const res = await fetch(
            `${API_BASE_URL}/api/geracao-digital/briefing/transcribe`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({ audio_base64: base64, mime_type: mimeType }),
            }
          );

          if (res.ok) {
            const data = await res.json();
            const transcribed = String(data?.texto || "").trim();
            if (transcribed) {
              handleObjecaoChange(id, field, transcribed);
            }
          }
        }
      }
    } catch (err) {
      console.warn("Falha ao enviar áudio para transcrição no servidor:", err);
    } finally {
      setIsTranscribing(false);
      setRecordingTarget(null);
      setRecordingDuration(0);
    }
  };

  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* BLOCO 1: KIT DE DOCUMENTOS POR SEGMENTO */}
      <Card className="border-indigo-100 dark:border-indigo-950/60 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <FolderOpen className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                Kit de Documentos por Segmento
              </CardTitle>
              <CardDescription className="text-xs text-slate-500 mt-1">
                A lista exata do que pedir ao cliente, com o nome das coisas que ele tem na mão — não termos genéricos.
              </CardDescription>
            </div>

            {/* SELETOR DE SEGMENTO */}
            <div className="w-full sm:w-64">
              <Label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block mb-1">
                Segmento do Cliente
              </Label>
              <Select value={segmentoKey} onValueChange={(val) => onSegmentoChange(val)}>
                <SelectTrigger className="text-xs h-9 bg-white dark:bg-slate-900 border-indigo-200 dark:border-indigo-900">
                  <SelectValue placeholder="Selecione o segmento..." />
                </SelectTrigger>
                <SelectContent>
                  {LISTA_SEGMENTOS.map((seg) => (
                    <SelectItem key={seg.id} value={seg.id} className="text-xs">
                      {seg.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-1.5 p-2.5 rounded-lg bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100/60 dark:border-indigo-900/40">
            <Info className="h-4 w-4 text-indigo-500 shrink-0" />
            <span>
              Mostrando o kit ideal para <strong>{segmentoDef.label}</strong>. Cada item deve ser marcado como <strong>Recebido</strong>, <strong>Pendente</strong> ou <strong>O cliente não tem</strong>.
            </span>
          </div>

          {/* LISTA DOS ITENS DO KIT */}
          <div className="space-y-3">
            {documentosKit.map((item, idx) => {
              const isRecebido = item.status === "recebido";
              const isPendente = item.status === "pendente";
              const isNaoTem = item.status === "nao_tem";

              return (
                <div
                  key={item.id || idx}
                  className={`p-3.5 rounded-xl border transition-all ${
                    isRecebido
                      ? "bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50"
                      : isNaoTem
                      ? "bg-rose-50/40 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50"
                      : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileCheck2
                        className={`h-4 w-4 shrink-0 ${
                          isRecebido
                            ? "text-emerald-600"
                            : isNaoTem
                            ? "text-rose-500"
                            : "text-amber-500"
                        }`}
                      />
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        {item.titulo}
                      </span>
                    </div>

                    {/* GRUPO DE 3 ESTADOS */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        variant={isRecebido ? "default" : "outline"}
                        onClick={() => handleStatusChange(item.id, "recebido")}
                        className={`text-[11px] h-7 px-2.5 rounded-lg ${
                          isRecebido
                            ? "bg-emerald-600 hover:bg-emerald-700 text-white border-transparent"
                            : "text-slate-600 hover:text-emerald-700 hover:border-emerald-300"
                        }`}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Recebido
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant={isPendente ? "default" : "outline"}
                        onClick={() => handleStatusChange(item.id, "pendente")}
                        className={`text-[11px] h-7 px-2.5 rounded-lg ${
                          isPendente
                            ? "bg-amber-500 hover:bg-amber-600 text-white border-transparent"
                            : "text-slate-600 hover:text-amber-600 hover:border-amber-300"
                        }`}
                      >
                        <Clock className="h-3 w-3 mr-1" />
                        Pendente
                      </Button>

                      <Button
                        type="button"
                        size="sm"
                        variant={isNaoTem ? "destructive" : "outline"}
                        onClick={() => handleStatusChange(item.id, "nao_tem")}
                        className={`text-[11px] h-7 px-2.5 rounded-lg ${
                          isNaoTem
                            ? "bg-rose-600 hover:bg-rose-700 text-white border-transparent"
                            : "text-rose-600 hover:text-rose-700 hover:border-rose-300"
                        }`}
                      >
                        <AlertCircle className="h-3 w-3 mr-1" />
                        O cliente não tem
                      </Button>
                    </div>
                  </div>

                  {/* CAMPO DE OBSERVAÇÃO QUANDO O CLIENTE NÃO TEM */}
                  {isNaoTem && (
                    <div className="mt-3 pt-3 border-t border-rose-200/60 dark:border-rose-900/40 space-y-1.5">
                      <Label className="text-[11px] font-bold text-rose-900 dark:text-rose-300 flex items-center gap-1.5">
                        <AlertCircle className="h-3.5 w-3.5 text-rose-600" />
                        O que o cliente falou (vira conhecimento imediato do robô):
                      </Label>
                      <Textarea
                        placeholder="Escreva aqui o que o cliente explicou verbalmente sobre este item (ex: cobra taxa fixa de R$ 15 até 5km, entrega em até 40 min, não tem taxa de serviço...)"
                        value={item.observacao || ""}
                        onChange={(e) => handleObservacaoChange(item.id, e.target.value)}
                        className="text-xs min-h-[60px] bg-white dark:bg-slate-900 border-rose-300 dark:border-rose-900/60 focus-visible:ring-rose-400"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* BLOCO 2: AS CINCO OBJEÇÕES */}
      <Card className="border-indigo-100 dark:border-indigo-950/60 shadow-sm">
        <CardHeader className="pb-3">
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <CardTitle className="text-base font-bold flex items-center gap-2 text-slate-900 dark:text-slate-100">
                <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                As Cinco Objeções Reais do Cliente
              </CardTitle>

              {/* BADGE DE PROGRESSO */}
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={`text-xs px-2.5 py-0.5 font-bold ${
                    filledCount === 5
                      ? "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/30 dark:text-emerald-300"
                      : filledCount > 0
                      ? "bg-indigo-50 text-indigo-700 border-indigo-300 dark:bg-indigo-950/30 dark:text-indigo-300"
                      : "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-400"
                  }`}
                >
                  {filledCount} de 5 preenchidas
                </Badge>
              </div>
            </div>

            <CardDescription className="text-xs text-slate-600 dark:text-slate-400 font-medium">
              Quais são as cinco coisas que o cliente mais reclama ou questiona antes de fechar? E, para cada uma: o que vocês respondem quando isso acontece?
            </CardDescription>

            {/* O QUE CADA UMA DESTRAVA */}
            <div className="p-3 rounded-xl bg-gradient-to-r from-indigo-50/70 via-purple-50/50 to-indigo-50/70 dark:from-indigo-950/40 dark:via-purple-950/20 dark:to-indigo-950/40 border border-indigo-100 dark:border-indigo-900/50 flex items-center gap-2.5">
              <Volume2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <p className="text-xs font-semibold text-indigo-950 dark:text-indigo-200">
                <span className="font-extrabold uppercase tracking-wider text-[10px] text-indigo-600 dark:text-indigo-400 mr-1.5">
                  Impacto no Robô:
                </span>
                {unlockingText}
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {cincoObjecoes.map((item, idx) => {
            const exemplo = segmentoDef.objecoesExemplos[idx];
            const isRecordingObjecao =
              recordingTarget?.id === item.id &&
              recordingTarget?.field === "objecao";
            const isRecordingResposta =
              recordingTarget?.id === item.id &&
              recordingTarget?.field === "resposta";

            return (
              <div
                key={item.id}
                className="p-4 rounded-2xl bg-slate-50/70 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-black">
                      {item.id}
                    </span>
                    <h5 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      Objeção {item.id}
                    </h5>
                  </div>

                  {item.objecao.trim() && item.resposta.trim() ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 font-bold"
                    >
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Pronta
                    </Badge>
                  ) : item.objecao.trim() || item.resposta.trim() ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] text-amber-700 bg-amber-50 dark:bg-amber-950/40 border-amber-300 font-bold"
                    >
                      Parcial
                    </Badge>
                  ) : null}
                </div>

                {/* SUGESTÃO VISUAL DO SEGMENTO (NUNCA PREENCHIDA NO VALOR) */}
                {exemplo && (
                  <div className="p-2.5 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 text-xs text-indigo-900 dark:text-indigo-200 space-y-1">
                    <div className="font-semibold text-[11px] flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                      Exemplo comum no segmento ({segmentoDef.label}) — apenas referência visual:
                    </div>
                    <div className="text-[11px] pl-5 space-y-0.5 text-slate-600 dark:text-slate-300">
                      <div>
                        <strong className="text-slate-800 dark:text-slate-200">Reclamação/Pergunta:</strong> &ldquo;{exemplo.objecao}&rdquo;
                      </div>
                      <div>
                        <strong className="text-slate-800 dark:text-slate-200">Resposta da empresa:</strong> &ldquo;{exemplo.resposta}&rdquo;
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                  {/* CAMPO: A OBJEÇÃO DO CLIENTE */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
                        O que o cliente reclama ou pergunta?
                      </Label>
                      <Button
                        type="button"
                        size="sm"
                        variant={isRecordingObjecao ? "destructive" : "ghost"}
                        onClick={() => toggleRecording(item.id, "objecao")}
                        className={`h-6 text-[10px] px-2 gap-1 rounded-md ${
                          isRecordingObjecao
                            ? "animate-pulse"
                            : "text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                        }`}
                      >
                        {isRecordingObjecao ? (
                          <>
                            <MicOff className="h-3 w-3" />
                            Gravando ({recordingDuration}s)... Parar
                          </>
                        ) : isTranscribing && recordingTarget?.id === item.id && recordingTarget?.field === "objecao" ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Transcrevendo...
                          </>
                        ) : (
                          <>
                            <Mic className="h-3 w-3 text-indigo-600" />
                            Gravar voz
                          </>
                        )}
                      </Button>
                    </div>
                    <Input
                      placeholder="Ex: 'Achei a taxa de entrega cara' ou 'Vou pensar e te chamo'..."
                      value={item.objecao}
                      onChange={(e) =>
                        handleObjecaoChange(item.id, "objecao", e.target.value)
                      }
                      className="text-xs h-9 bg-white dark:bg-slate-900"
                    />
                  </div>

                  {/* CAMPO: A RESPOSTA REAL DA EMPRESA */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
                        O que vocês respondem quando isso acontece?
                      </Label>
                      <Button
                        type="button"
                        size="sm"
                        variant={isRecordingResposta ? "destructive" : "ghost"}
                        onClick={() => toggleRecording(item.id, "resposta")}
                        className={`h-6 text-[10px] px-2 gap-1 rounded-md ${
                          isRecordingResposta
                            ? "animate-pulse"
                            : "text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                        }`}
                      >
                        {isRecordingResposta ? (
                          <>
                            <MicOff className="h-3 w-3" />
                            Gravando ({recordingDuration}s)... Parar
                          </>
                        ) : isTranscribing && recordingTarget?.id === item.id && recordingTarget?.field === "resposta" ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Transcrevendo...
                          </>
                        ) : (
                          <>
                            <Mic className="h-3 w-3 text-indigo-600" />
                            Gravar voz
                          </>
                        )}
                      </Button>
                    </div>
                    <Textarea
                      placeholder="Ex: 'Explicamos que usamos motoboy próprio para a comida chegar quente em até 30min...' (palavras reais da equipe)"
                      value={item.resposta}
                      onChange={(e) =>
                        handleObjecaoChange(item.id, "resposta", e.target.value)
                      }
                      className="text-xs min-h-[60px] bg-white dark:bg-slate-900"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
