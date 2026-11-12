import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Archive, Loader2, Mic, Pencil, Play, Square, Upload } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import {
  AUDIO_LIBRARY_DEFAULT_LIMITS,
  formatAudioDuration,
  useArchiveLibraryAudio,
  useAudioLibrary,
  useAudioLibraryAccess,
  useFetchLibraryAudioFile,
  useUpdateLibraryAudio,
  useUploadLibraryAudio,
  type LibraryAudio,
} from "@/hooks/useAudioLibrary";

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function AudioLibraryTab() {
  const crmClient = useOptionalCrmClient();
  const clientId = crmClient?.selectedClient?.id || crmClient?.selectedClientId || undefined;

  const accessQuery = useAudioLibraryAccess(clientId);
  const canUse = accessQuery.data?.allowed === true;
  const accessDenied = accessQuery.isError || accessQuery.data?.allowed === false;
  const limits = accessQuery.data?.limits || AUDIO_LIBRARY_DEFAULT_LIMITS;

  const { data: audios = [], isLoading, isError, error } = useAudioLibrary(canUse ? clientId : undefined);
  const uploadMutation = useUploadLibraryAudio(clientId);
  const updateMutation = useUpdateLibraryAudio(clientId);
  const archiveMutation = useArchiveLibraryAudio(clientId);
  const fetchAudioFile = useFetchLibraryAudioFile();

  const maxMb = Math.round(limits.maxBytes / (1024 * 1024));
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Um áudio tocando por vez. O endereço local (blob) é liberado ao trocar de
  // áudio, ao parar e ao sair da aba.
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const playingUrlRef = useRef<string | null>(null);

  const [editing, setEditing] = useState<LibraryAudio | null>(null);
  const [editName, setEditName] = useState("");
  const [editWhenToUse, setEditWhenToUse] = useState("");
  const [archiving, setArchiving] = useState<LibraryAudio | null>(null);

  useEffect(() => {
    return () => {
      if (playingUrlRef.current) URL.revokeObjectURL(playingUrlRef.current);
    };
  }, []);

  const stopPlaying = () => {
    if (playingUrlRef.current) URL.revokeObjectURL(playingUrlRef.current);
    playingUrlRef.current = null;
    setPlaying(null);
  };

  const handlePlay = async (audio: LibraryAudio) => {
    if (playing?.id === audio.id) {
      stopPlaying();
      return;
    }
    stopPlaying();
    setLoadingAudioId(audio.id);
    try {
      const url = await fetchAudioFile(audio.id);
      playingUrlRef.current = url;
      setPlaying({ id: audio.id, url });
    } catch (err) {
      toast.error(errorText(err, "Não foi possível carregar o áudio."));
    } finally {
      setLoadingAudioId(null);
    }
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    // Atalho para não subir um arquivo que o servidor vai recusar de qualquer
    // jeito. Tipo e duração quem mede é o servidor, pelos bytes.
    if (file.size > limits.maxBytes) {
      toast.error(`O áudio tem ${formatBytes(file.size)}. O limite é ${maxMb} MB.`);
      return;
    }
    uploadMutation.mutate(file, {
      onSuccess: (audio) => {
        toast.success(`"${audio.name}" entrou na biblioteca. Diga quando ele deve ser usado.`);
        openEdit(audio);
      },
      onError: (err) => toast.error(errorText(err, "Erro ao enviar o áudio.")),
    });
  };

  const openEdit = (audio: LibraryAudio) => {
    setEditing(audio);
    setEditName(audio.name);
    setEditWhenToUse(audio.whenToUse || "");
  };

  const trimmedName = editName.trim();
  const whenToUseLength = editWhenToUse.trim().length;
  const editInvalid = !trimmedName || trimmedName.length > limits.nameMax || whenToUseLength > limits.whenToUseMax;

  const handleSaveEdit = () => {
    if (!editing || editInvalid) return;
    updateMutation.mutate(
      { id: editing.id, name: trimmedName, whenToUse: editWhenToUse.trim() || null },
      {
        onSuccess: () => {
          toast.success("Áudio salvo.");
          setEditing(null);
        },
        onError: (err) => toast.error(errorText(err, "Erro ao salvar o áudio.")),
      }
    );
  };

  const handleArchive = () => {
    if (!archiving) return;
    const target = archiving;
    archiveMutation.mutate(target.id, {
      onSuccess: () => {
        if (playing?.id === target.id) stopPlaying();
        toast.success(`"${target.name}" foi arquivado.`);
      },
      // 409 (em uso no follow-up) chega aqui com a lista de passos no texto.
      onError: (err) => toast.error(errorText(err, "Erro ao arquivar o áudio."), { duration: 9000 }),
      onSettled: () => setArchiving(null),
    });
  };

  if (accessDenied) {
    const motivo =
      accessQuery.data?.message ||
      (accessQuery.error instanceof Error ? accessQuery.error.message : "Não foi possível verificar o acesso à biblioteca de áudios.");
    return (
      <Card className="border-border dark:border-zinc-800">
        <CardContent className="flex items-start gap-3 p-6">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">Biblioteca de áudios indisponível para você</p>
            <p className="text-xs text-muted-foreground">{motivo}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const limitsText = `OGG, MP3, M4A, AAC ou WAV · até ${maxMb} MB e ${Math.round(limits.maxSeconds / 60)} minutos`;

  return (
    <div className="space-y-6 animate-in fade-in-50" data-testid="audio-library-tab">
      <Card className="border-border dark:border-zinc-800">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
                <Mic className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base font-bold">Biblioteca de áudios</CardTitle>
                <CardDescription className="text-xs">
                  Áudios gravados por você, com a sua voz, para reutilizar. Envie uma vez e escolha o áudio nos passos do
                  follow-up.
                </CardDescription>
              </div>
            </div>
            <div className="shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.ogg,.oga,.opus,.mp3,.m4a,.aac,.wav"
                onChange={handleUpload}
                disabled={!canUse || uploadMutation.isPending}
                className="hidden"
                data-testid="audio-library-file-input"
              />
              <Button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!canUse || uploadMutation.isPending}
                className="w-full sm:w-auto gap-2"
              >
                {uploadMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploadMutation.isPending ? "Enviando..." : "Enviar áudio"}
              </Button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground pt-2">{limitsText}</p>
        </CardHeader>

        <CardContent className="p-3 pt-0 space-y-2">
          {(accessQuery.isLoading || (canUse && isLoading)) && (
            <p className="text-xs text-muted-foreground text-center py-6">Carregando áudios...</p>
          )}
          {isError && (
            <p className="text-xs text-rose-500 text-center py-6">{errorText(error, "Erro ao carregar a biblioteca de áudios.")}</p>
          )}
          {canUse && !isLoading && !isError && audios.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">
              Nenhum áudio ainda. Clique em “Enviar áudio” para começar.
            </p>
          )}

          {audios.map((audio) => {
            const isPlaying = playing?.id === audio.id;
            const isLoadingFile = loadingAudioId === audio.id;
            const steps = audio.followupSteps || 0;
            return (
              <div
                key={audio.id}
                data-testid="audio-library-row"
                className="rounded-xl border border-border dark:border-zinc-800 bg-muted/20 p-3 text-xs"
              >
                <div className="flex items-start gap-3">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() => handlePlay(audio)}
                    disabled={isLoadingFile}
                    aria-label={isPlaying ? `Parar ${audio.name}` : `Ouvir ${audio.name}`}
                    className="h-9 w-9 shrink-0 rounded-full"
                  >
                    {isLoadingFile ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : isPlaying ? (
                      <Square className="w-3.5 h-3.5" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                  </Button>

                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm text-foreground break-words">{audio.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatAudioDuration(audio.durationSeconds)} · {formatBytes(audio.sizeBytes)}
                      {steps > 0 && ` · em uso em ${steps} ${steps === 1 ? "passo" : "passos"} de follow-up`}
                    </p>
                    {audio.whenToUse ? (
                      <p className="mt-1.5 text-xs text-foreground/80 break-words">
                        <span className="font-semibold">Quando usar:</span> {audio.whenToUse}
                      </p>
                    ) : (
                      <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-500">
                        Sem “quando usar”. Clique em Editar e diga em que momento este áudio serve.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-1.5 shrink-0">
                    <Button type="button" size="sm" variant="ghost" onClick={() => openEdit(audio)} className="h-8 gap-1.5 px-2">
                      <Pencil className="w-3.5 h-3.5" />
                      Editar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setArchiving(audio)}
                      className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-rose-500"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      Arquivar
                    </Button>
                  </div>
                </div>

                {isPlaying && playing && (
                  <audio
                    controls
                    autoPlay
                    src={playing.url}
                    onEnded={stopPlaying}
                    className="mt-3 w-full h-9"
                    data-testid="audio-library-player"
                  />
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar áudio</DialogTitle>
            <DialogDescription>O nome é como você encontra o áudio. “Quando usar” diz em que momento ele serve.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="audio-library-name">Nome</Label>
              <Input
                id="audio-library-name"
                value={editName}
                maxLength={limits.nameMax}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="audio-library-when">Quando usar</Label>
              <Textarea
                id="audio-library-when"
                value={editWhenToUse}
                rows={3}
                placeholder="Ex.: quando o cliente pergunta como funciona a entrega"
                onChange={(e) => setEditWhenToUse(e.target.value)}
              />
              <p
                className={`text-[11px] text-right ${whenToUseLength > limits.whenToUseMax ? "text-rose-500 font-semibold" : "text-muted-foreground"}`}
                data-testid="audio-library-when-counter"
              >
                {whenToUseLength}/{limits.whenToUseMax}
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleSaveEdit} disabled={editInvalid || updateMutation.isPending}>
              {updateMutation.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(archiving)} onOpenChange={(open) => !open && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar “{archiving?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              O áudio sai da biblioteca e não pode mais ser escolhido. Se ele estiver em uso em algum passo de follow-up, o
              sistema avisa e não arquiva.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive}>Arquivar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
