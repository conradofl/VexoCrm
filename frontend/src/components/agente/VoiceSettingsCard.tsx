import React, { useState, useRef, useEffect } from "react";
import { Volume2, Sparkles, Play, Square, Loader2, Mic } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateLeadClientN8nSettings } from "@/hooks/useLeadClients";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage } from "@/lib/api";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";

export const AVAILABLE_VOICES = [
  { id: "nova", label: "Nova (Francisca)", desc: "Feminina Expressiva - Padrão", gender: "Feminina" },
  { id: "echo", label: "Echo (Antônio)", desc: "Masculina Natural", gender: "Masculina" },
  { id: "shimmer", label: "Shimmer (Thalita)", desc: "Feminina Jovem", gender: "Feminina" },
  { id: "alloy", label: "Alloy (Manuela)", desc: "Feminina Suave", gender: "Feminina" },
  { id: "onyx", label: "Onyx (Fábio)", desc: "Masculina Corporativa", gender: "Masculina" },
  { id: "fable", label: "Fable (Donato)", desc: "Masculina Encorpada", gender: "Masculina" },
] as const;

export const VOICE_MODES = [
  {
    id: "disabled",
    label: "Desativado",
    description: "Responde apenas em mensagens de texto escritas",
  },
  {
    id: "mirror",
    label: "Espelhar o Lead",
    description: "Responde em áudio se o lead mandou áudio, ou texto se mandou texto",
    badge: "Recomendado",
  },
  {
    id: "always",
    label: "Sempre Áudio",
    description: "Todas as respostas comerciais são enviadas em notas de voz PTT",
  },
] as const;

export interface VoiceSettingsCardProps {
  clientId: string;
  clientName?: string;
  initialVoiceMode?: "disabled" | "mirror" | "always" | string;
  initialVoiceId?: string;
  initialVoiceSpeed?: number;
  canEdit?: boolean;
  className?: string;
}

export function VoiceSettingsCard({
  clientId,
  clientName,
  initialVoiceMode = "disabled",
  initialVoiceId = "nova",
  initialVoiceSpeed = 1.0,
  canEdit = true,
  className,
}: VoiceSettingsCardProps) {
  const { getIdToken } = useAuth();
  const updateSettings = useUpdateLeadClientN8nSettings();

  const [voiceMode, setVoiceMode] = useState<string>(initialVoiceMode || "disabled");
  const [voiceId, setVoiceId] = useState<string>(initialVoiceId || "nova");
  const [voiceSpeed, setVoiceSpeed] = useState<number>(Number(initialVoiceSpeed) || 1.0);

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Sincroniza estado inicial caso props mudem após carregamento
  useEffect(() => {
    if (initialVoiceMode) setVoiceMode(initialVoiceMode);
  }, [initialVoiceMode]);

  useEffect(() => {
    if (initialVoiceId) setVoiceId(initialVoiceId);
  }, [initialVoiceId]);

  useEffect(() => {
    if (typeof initialVoiceSpeed === "number") setVoiceSpeed(initialVoiceSpeed);
  }, [initialVoiceSpeed]);

  // Limpa áudio ao desmontar
  useEffect(() => {
    return () => {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
        audioPlayerRef.current = null;
      }
    };
  }, []);

  const handleModeChange = async (newMode: string) => {
    if (!canEdit || updateSettings.isPending) return;
    const prevMode = voiceMode;
    setVoiceMode(newMode);
    try {
      await updateSettings.mutateAsync({
        tenantId: clientId,
        chatbotVoiceMode: newMode,
      });
      const modeObj = VOICE_MODES.find((m) => m.id === newMode);
      toast({
        title: "Modo de voz atualizado",
        description: `Modo alterado para: ${modeObj?.label || newMode}`,
      });
    } catch (err) {
      setVoiceMode(prevMode);
      toast({
        title: "Erro ao salvar modo de voz",
        description: err instanceof Error ? err.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  };

  const handleVoiceChange = async (newVoice: string) => {
    if (!canEdit || updateSettings.isPending) return;
    const prevVoice = voiceId;
    setVoiceId(newVoice);
    try {
      await updateSettings.mutateAsync({
        tenantId: clientId,
        chatbotVoiceId: newVoice,
      });
      const voiceObj = AVAILABLE_VOICES.find((v) => v.id === newVoice);
      toast({
        title: "Voz da IA atualizada",
        description: `Nova voz: ${voiceObj?.label || newVoice}`,
      });
    } catch (err) {
      setVoiceId(prevVoice);
      toast({
        title: "Erro ao salvar voz da IA",
        description: err instanceof Error ? err.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  };

  const handleSpeedCommit = async (values: number[]) => {
    if (!canEdit || updateSettings.isPending) return;
    const newSpeed = values[0] || 1.0;
    try {
      await updateSettings.mutateAsync({
        tenantId: clientId,
        chatbotVoiceSpeed: newSpeed,
      });
      toast({
        title: "Velocidade da voz salva",
        description: `Velocidade ajustada para ${newSpeed.toFixed(2)}x`,
      });
    } catch (err) {
      toast({
        title: "Erro ao salvar velocidade",
        description: err instanceof Error ? err.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  };

  const handlePlayPreview = async () => {
    if (isPlaying && audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current = null;
      setIsPlaying(false);
      return;
    }

    setLoadingPreview(true);
    try {
      const token = await getIdToken();
      const res = await fetchApi("/api/chatbot/voice-preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          voice: voiceId,
          speed: voiceSpeed,
          text: `Olá! Sou o assistente virtual da ${clientName || "sua empresa"}. Como posso te ajudar hoje?`,
        }),
      });

      if (!res.ok) {
        const errorMsg = await readApiErrorMessage(res, "Falha ao gerar prévia de voz");
        toast({
          title: "Não foi possível gerar a prévia",
          description: errorMsg,
          variant: "destructive",
        });
        return;
      }

      const data = await res.json();
      if (!data?.audioBase64) {
        throw new Error("Resposta de áudio vazia do servidor");
      }

      const audioSrc = `data:${data.mimetype || "audio/mpeg"};base64,${data.audioBase64}`;
      const audio = new Audio(audioSrc);
      audioPlayerRef.current = audio;

      audio.onplay = () => setIsPlaying(true);
      audio.onended = () => {
        setIsPlaying(false);
        audioPlayerRef.current = null;
      };
      audio.onerror = () => {
        setIsPlaying(false);
        audioPlayerRef.current = null;
        toast({
          title: "Erro de reprodução",
          description: "O navegador não conseguiu reproduzir o formato de áudio.",
          variant: "destructive",
        });
      };

      await audio.play();
    } catch (err) {
      toast({
        title: "Erro na prévia de voz",
        description: err instanceof Error ? err.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setLoadingPreview(false);
    }
  };

  return (
    <Card className={cn("border-slate-200 dark:border-white/10 shadow-xs", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-violet-500" />
              <span>Voz da IA & Respostas em Áudio</span>
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            </CardTitle>
            <CardDescription className="text-xs">
              Responda leads no WhatsApp com notas de voz humanizadas e naturais (Microsoft Neural TTS Gratuito).
            </CardDescription>
          </div>
          <Badge
            variant={voiceMode === "disabled" ? "outline" : "default"}
            className={cn(
              "text-[10px] shrink-0 font-normal uppercase tracking-wider",
              voiceMode === "disabled"
                ? "text-slate-500 border-slate-300"
                : "bg-emerald-600 hover:bg-emerald-700 text-white"
            )}
          >
            {voiceMode === "disabled" ? "Voz Inativa" : "Voz Ativa"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Seletor de Modo de Voz (Radio Cards) */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Comportamento de Resposta
          </Label>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Comportamento de Resposta">
            {VOICE_MODES.map((mode) => {
              const isSelected = voiceMode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  disabled={!canEdit || updateSettings.isPending}
                  onClick={() => handleModeChange(mode.id)}
                  className={cn(
                    "relative flex flex-col text-left rounded-lg border p-3 transition-all cursor-pointer",
                    "focus:outline-hidden focus:ring-2 focus:ring-violet-500/30",
                    isSelected
                      ? "border-violet-600 bg-violet-50/70 dark:bg-violet-950/20 dark:border-violet-500 shadow-xs"
                      : "border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 bg-background"
                  )}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span
                      className={cn(
                        "text-xs font-medium",
                        isSelected ? "text-violet-700 dark:text-violet-300 font-semibold" : "text-foreground"
                      )}
                    >
                      {mode.label}
                    </span>
                    {"badge" in mode && mode.badge && (
                      <Badge
                        variant="secondary"
                        className="text-[9px] px-1.5 py-0 bg-violet-200/70 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200 border-transparent font-normal"
                      >
                        {mode.badge}
                      </Badge>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground leading-snug">
                    {mode.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Configurações de Voz (visíveis mesmo quando desativado para permitir setup prévio) */}
        <div className={cn("grid gap-4 sm:grid-cols-2 pt-2 border-t border-slate-100 dark:border-white/5", voiceMode === "disabled" && "opacity-80")}>
          {/* Seletor da Voz */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Mic className="h-3 w-3 text-slate-400" />
              <span>Voz do Agente</span>
            </Label>
            <Select
              value={voiceId}
              onValueChange={handleVoiceChange}
              disabled={!canEdit || updateSettings.isPending}
            >
              <SelectTrigger className="h-9 text-xs" aria-label="Selecione a voz">
                <SelectValue placeholder="Selecione a voz" />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_VOICES.map((v) => (
                  <SelectItem key={v.id} value={v.id} className="text-xs">
                    <div className="flex items-center justify-between w-full gap-2">
                      <span className="font-medium">{v.label}</span>
                      <span className="text-[11px] text-muted-foreground">({v.desc})</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Slider de Velocidade */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Velocidade da Fala
              </Label>
              <span className="font-mono text-xs font-semibold text-violet-600 dark:text-violet-400 tabular-nums">
                {voiceSpeed.toFixed(2)}x
              </span>
            </div>
            <div className="pt-2">
              <Slider
                value={[voiceSpeed]}
                min={0.8}
                max={1.2}
                step={0.05}
                disabled={!canEdit || updateSettings.isPending}
                onValueChange={(val) => setVoiceSpeed(val[0])}
                onValueCommit={handleSpeedCommit}
                aria-label="Velocidade da fala"
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground pt-1">
              <span>0.80x (Mais calma)</span>
              <span>1.00x (Natural)</span>
              <span>1.20x (Mais rápida)</span>
            </div>
          </div>
        </div>

        {/* Botão de Teste / Prévia */}
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3 border border-slate-200/60 dark:border-white/5">
          <div className="text-xs text-muted-foreground text-center sm:text-left">
            <span>Ouça uma demonstração instantânea com a voz </span>
            <strong className="text-foreground">{AVAILABLE_VOICES.find((v) => v.id === voiceId)?.label || voiceId}</strong>
            <span> a {voiceSpeed.toFixed(2)}x</span>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handlePlayPreview}
            disabled={loadingPreview}
            className={cn(
              "shrink-0 h-8 text-xs gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-950/40",
              isPlaying && "bg-violet-100 text-violet-800 dark:bg-violet-900/50"
            )}
            aria-label="Ouvir prévia da voz"
          >
            {loadingPreview ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Gerando áudio...</span>
              </>
            ) : isPlaying ? (
              <>
                <Square className="h-3 w-3 fill-current" />
                <span>Parar</span>
              </>
            ) : (
              <>
                <Play className="h-3 w-3 fill-current ml-0.5" />
                <span>Ouvir prévia da voz</span>
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
