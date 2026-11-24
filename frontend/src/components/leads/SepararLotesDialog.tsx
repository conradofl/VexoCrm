import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, Layers, Loader2, PhoneOff, ShieldCheck, Square, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL, readApiErrorMessage } from "@/lib/api";

// Separar a base em lotes para campanha, direto do Banco de Dados (backend: services/leadBatchSeparation.js).
// Substitui o caminho manual: exportar Excel, tirar fixo e quem não tem WhatsApp, partir em planilhas, importar de novo.

export interface PreviaLotes {
  total: number;
  celular: number;
  fixo: number;
  invalido: number;
  whatsapp_confirmado: number;
  sem_whatsapp: number;
  nao_conferido: number;
  opt_out: number;
  ja_recebeu: number;
  ja_separado: number;
  disponivel_confirmado: number;
  disponivel_sem_conferir: number;
  inutil_sem_whatsapp?: number;
  inutil_fixo_nao_conferido?: number;
  inutil_invalido?: number;
}

/** Prévia da exclusão em massa com o critério "inutilizaveis" (backend: services/leadMassDelete.js). */
interface PreviaLimpeza {
  willDelete: number;
  kept: number;
  keptReasons?: { withMessages?: number };
  confirmation?: { typedRequired?: boolean; threshold?: number };
}

const CRITERIO_LIMPEZA = { type: "inutilizaveis" } as const;

export interface ConferenciaStatus {
  rodando: boolean;
  chipNome?: string | null;
  totalNaFila?: number;
  conferidos?: number;
  comWhatsapp?: number;
  semWhatsapp?: number;
  ultimoErro?: string | null;
  motivoFim?: string | null;
}

interface PlanilhaCriada {
  id: string;
  nome: string;
  numero: number;
  leads: number;
}

interface ChipOption {
  id: string;
  name?: string | null;
  connection_state?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  chips: ChipOption[];
  onSeparated?: () => void;
}

const MOTIVO_FIM: Record<string, string> = {
  concluida: "Conferência concluída.",
  parada_pelo_usuario: "Conferência parada.",
  falhas_seguidas: "Conferência parou sozinha: o chip não respondeu duas vezes seguidas.",
  nada_a_conferir: "Nada a conferir: todos os números já foram conferidos.",
  erro: "A conferência parou por erro.",
};

const fmt = (n: number | undefined | null) => Number(n || 0).toLocaleString("pt-BR");

/** Horas estimadas para conferir `n` números: 25 por vez, uma pausa de cerca de 2 minutos entre as vezes. */
export function estimarHorasConferencia(n: number): number {
  const vezes = Math.ceil(Math.max(0, n) / 25);
  return Math.max(0, Math.round(((vezes * 2.25) / 60) * 10) / 10);
}

function Numero({ rotulo, valor, destaque, testId }: { rotulo: string; valor: number; destaque?: boolean; testId: string }) {
  return (
    <div
      data-testid={testId}
      className={
        destaque
          ? "rounded-lg border border-emerald-500/50 bg-emerald-500/[0.06] p-2.5"
          : "rounded-lg border border-border bg-card p-2.5"
      }
    >
      <div className="text-[11px] font-medium text-muted-foreground">{rotulo}</div>
      <div className={destaque ? "text-lg font-bold text-emerald-700 dark:text-emerald-400" : "text-lg font-bold text-foreground"}>
        {fmt(valor)}
      </div>
    </div>
  );
}

export function SepararLotesDialog({ open, onOpenChange, clientId, chips, onSeparated }: Props) {
  const { getIdToken } = useAuth();
  const [previa, setPrevia] = useState<PreviaLotes | null>(null);
  const [conferencia, setConferencia] = useState<ConferenciaStatus>({ rodando: false });
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [chipId, setChipId] = useState<string>("");
  const [tamanho, setTamanho] = useState("50");
  const [quantidade, setQuantidade] = useState("1");
  const [nomeBase, setNomeBase] = useState("");
  const [exigirWhatsapp, setExigirWhatsapp] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [criadas, setCriadas] = useState<PlanilhaCriada[] | null>(null);
  const [limpeza, setLimpeza] = useState<PreviaLimpeza | null>(null);
  const [confirmandoLimpeza, setConfirmandoLimpeza] = useState(false);
  const [numeroDigitado, setNumeroDigitado] = useState("");
  const [apagando, setApagando] = useState(false);
  const [apagados, setApagados] = useState<number | null>(null);

  const chipsConectados = useMemo(
    () => chips.filter((c) => !c.connection_state || c.connection_state === "open"),
    [chips]
  );

  const chamar = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Não foi possível concluir"));
      return res.json();
    },
    [getIdToken]
  );

  const carregar = useCallback(async () => {
    if (!clientId) return;
    setCarregando(true);
    setErro(null);
    try {
      const dados = await chamar(`/api/leads/lotes/previa?clientId=${encodeURIComponent(clientId)}`);
      setPrevia(dados.previa);
      setConferencia(dados.conferencia || { rodando: false });
      try {
        const vista = await chamar("/api/leads/mass-delete/preview", {
          method: "POST",
          body: JSON.stringify({ clientId, criterion: CRITERIO_LIMPEZA, options: {} }),
        });
        setLimpeza(vista.preview || null);
      } catch {
        setLimpeza(null);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar a base");
    } finally {
      setCarregando(false);
    }
  }, [chamar, clientId]);

  useEffect(() => {
    if (!open) return;
    setCriadas(null);
    setConfirmandoLimpeza(false);
    setNumeroDigitado("");
    setApagados(null);
    void carregar();
  }, [open, carregar]);

  useEffect(() => {
    if (!chipId && chipsConectados.length > 0) setChipId(chipsConectados[0].id);
  }, [chipId, chipsConectados]);

  // Enquanto confere, atualiza os números a cada 15 s.
  useEffect(() => {
    if (!open || !conferencia.rodando) return;
    const t = setInterval(() => void carregar(), 15_000);
    return () => clearInterval(t);
  }, [open, conferencia.rodando, carregar]);

  const iniciarConferencia = async () => {
    setErro(null);
    try {
      const dados = await chamar("/api/leads/conferencia-whatsapp", {
        method: "POST",
        body: JSON.stringify({ clientId, chipId }),
      });
      setConferencia(dados.conferencia);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao iniciar a conferência");
    }
  };

  const pararConferencia = async () => {
    try {
      const dados = await chamar(`/api/leads/conferencia-whatsapp?clientId=${encodeURIComponent(clientId)}`, { method: "DELETE" });
      setConferencia(dados.conferencia);
      void carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao parar a conferência");
    }
  };

  const disponiveis = exigirWhatsapp ? previa?.disponivel_confirmado ?? 0 : previa?.disponivel_sem_conferir ?? 0;
  const t = Number.parseInt(tamanho, 10);
  const q = Number.parseInt(quantidade, 10);
  const pedidoValido = Number.isInteger(t) && t >= 1 && t <= 500 && Number.isInteger(q) && q >= 1 && q <= 50;
  const vaiSeparar = pedidoValido ? Math.min(disponiveis, t * q) : 0;

  const separar = async () => {
    setErro(null);
    setEnviando(true);
    try {
      const dados = await chamar("/api/leads/lotes", {
        method: "POST",
        body: JSON.stringify({ clientId, tamanho: t, quantidade: q, nomeBase: nomeBase.trim() || undefined, exigirWhatsapp }),
      });
      setCriadas(dados.planilhas || []);
      onSeparated?.();
      void carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao separar os lotes");
    } finally {
      setEnviando(false);
    }
  };

  const baixarListaLimpeza = async () => {
    setErro(null);
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/leads/mass-delete/export`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, criterion: CRITERIO_LIMPEZA, options: {} }),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Não foi possível baixar a lista"));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `numeros-que-nao-servem-${clientId}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao baixar a lista");
    }
  };

  const apagarInutilizaveis = async () => {
    if (!limpeza) return;
    setErro(null);
    setApagando(true);
    try {
      const dados = await chamar("/api/leads/mass-delete/execute", {
        method: "POST",
        body: JSON.stringify({
          clientId,
          criterion: CRITERIO_LIMPEZA,
          options: {},
          expectedCount: limpeza.willDelete,
          confirmation: numeroDigitado || undefined,
        }),
      });
      setApagados(Number(dados?.report?.deleted ?? 0));
      setConfirmandoLimpeza(false);
      setNumeroDigitado("");
      onSeparated?.();
      void carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao apagar");
    } finally {
      setApagando(false);
    }
  };

  const fila = conferencia.totalNaFila || 0;
  const progresso = fila > 0 ? Math.round(((conferencia.conferidos || 0) / fila) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto" data-testid="separar-lotes-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            Separar lotes para campanha
          </DialogTitle>
          <DialogDescription>
            O sistema tira fixo sem WhatsApp, número sem WhatsApp, quem já recebeu campanha e quem já está em outro lote.
            Cada lote vira uma planilha pronta para usar no Novo Disparo.
          </DialogDescription>
        </DialogHeader>

        {erro && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {erro}
          </div>
        )}

        {carregando && !previa ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lendo a base…
          </div>
        ) : previa ? (
          <div className="space-y-5">
            <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Numero testId="previa-total" rotulo="Leads na base" valor={previa.total} />
              <Numero testId="previa-confirmado" rotulo="WhatsApp confirmado" valor={previa.whatsapp_confirmado} />
              <Numero testId="previa-nao-conferido" rotulo="Ainda não conferidos" valor={previa.nao_conferido} />
              <Numero testId="previa-sem-whatsapp" rotulo="Sem WhatsApp" valor={previa.sem_whatsapp} />
              <Numero testId="previa-fixo" rotulo="Telefone fixo" valor={previa.fixo} />
              <Numero testId="previa-recebeu" rotulo="Já receberam campanha" valor={previa.ja_recebeu} />
              <Numero testId="previa-separado" rotulo="Já estão em lote" valor={previa.ja_separado} />
              <Numero testId="previa-disponivel" rotulo="Disponíveis agora" valor={disponiveis} destaque />
            </section>

            <section className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Conferir quem tem WhatsApp
              </div>
              <p className="text-xs text-muted-foreground">
                Pergunta ao WhatsApp, devagar, quais números existem. Não manda mensagem. Número inexistente é o que mais
                restringe chip, então vale conferir antes de disparar.
              </p>
              {conferencia.rodando ? (
                <div className="space-y-2" data-testid="conferencia-rodando">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span>
                      Conferindo pelo chip <strong>{conferencia.chipNome || "selecionado"}</strong>: {fmt(conferencia.conferidos)} de{" "}
                      {fmt(fila)} ({fmt(conferencia.comWhatsapp)} com WhatsApp, {fmt(conferencia.semWhatsapp)} sem)
                    </span>
                    <Button size="sm" variant="outline" onClick={pararConferencia} className="h-7 gap-1 text-xs">
                      <Square className="h-3 w-3" /> Parar
                    </Button>
                  </div>
                  <Progress value={progresso} />
                </div>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[12rem] flex-1 space-y-1">
                    <Label className="text-xs">Chip que confere</Label>
                    <Select value={chipId} onValueChange={setChipId} disabled={chipsConectados.length === 0}>
                      <SelectTrigger className="h-9 text-xs" data-testid="conferencia-chip">
                        <SelectValue placeholder={chipsConectados.length === 0 ? "Nenhum chip conectado" : "Escolha o chip"} />
                      </SelectTrigger>
                      <SelectContent>
                        {chipsConectados.map((c) => (
                          <SelectItem key={c.id} value={c.id} className="text-xs">
                            {c.name || c.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    onClick={iniciarConferencia}
                    disabled={!chipId || previa.nao_conferido === 0}
                    className="h-9 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                    data-testid="btn-conferir"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Conferir {fmt(previa.nao_conferido)} números
                    {previa.nao_conferido > 0 ? ` (cerca de ${estimarHorasConferencia(previa.nao_conferido).toLocaleString("pt-BR")} h)` : ""}
                  </Button>
                </div>
              )}
              {!conferencia.rodando && conferencia.motivoFim && (
                <p className="text-xs text-muted-foreground" data-testid="conferencia-fim">
                  {MOTIVO_FIM[conferencia.motivoFim] || "Conferência encerrada."}
                  {conferencia.ultimoErro && conferencia.motivoFim !== "concluida" ? ` (${conferencia.ultimoErro})` : ""}
                </p>
              )}
            </section>

            <section className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Users className="h-4 w-4 text-primary" />
                Separar os lotes
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="lote-tamanho" className="text-xs">Leads por lote</Label>
                  <Input id="lote-tamanho" inputMode="numeric" value={tamanho} onChange={(e) => setTamanho(e.target.value.replace(/\D/g, ""))} className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="lote-quantidade" className="text-xs">Quantos lotes</Label>
                  <Input id="lote-quantidade" inputMode="numeric" value={quantidade} onChange={(e) => setQuantidade(e.target.value.replace(/\D/g, ""))} className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="lote-nome" className="text-xs">Nome (opcional)</Label>
                  <Input id="lote-nome" placeholder="Ex.: Natal" value={nomeBase} maxLength={120} onChange={(e) => setNomeBase(e.target.value)} className="h-9" />
                </div>
              </div>
              <label className="flex items-start gap-2 text-xs">
                <Switch checked={exigirWhatsapp} onCheckedChange={setExigirWhatsapp} data-testid="exigir-whatsapp" />
                <span>
                  <strong>Só números com WhatsApp confirmado</strong> (recomendado). Desligado, entram também celulares ainda não
                  conferidos; o disparo confere na hora, usando o chip de envio.
                </span>
              </label>
              {!pedidoValido && (
                <p className="text-xs text-destructive">Use de 1 a 500 leads por lote e de 1 a 50 lotes.</p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground" data-testid="resumo-separacao">
                  {vaiSeparar > 0
                    ? `Vai criar ${Math.ceil(vaiSeparar / t)} planilha(s) com ${fmt(vaiSeparar)} leads.`
                    : "Nenhum lead disponível com esses critérios."}
                </span>
                <Button
                  size="sm"
                  onClick={separar}
                  disabled={!pedidoValido || vaiSeparar === 0 || enviando}
                  className="gap-1.5"
                  data-testid="btn-separar"
                >
                  {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
                  Separar lotes
                </Button>
              </div>
            </section>

            {criadas && (
              <section className="space-y-2 rounded-lg border border-emerald-500/40 bg-emerald-500/[0.05] p-3" data-testid="planilhas-criadas">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  {criadas.length === 0 ? "Nenhuma planilha criada" : `${criadas.length} planilha(s) criada(s)`}
                </div>
                <ul className="space-y-1 text-xs">
                  {criadas.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <span className="truncate">{p.nome}</span>
                      <span className="shrink-0 text-muted-foreground">{fmt(p.leads)} leads</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Elas já aparecem em Campanhas › Novo Disparo, como base de leads. Esses leads não entram em outro lote.
                </p>
              </section>
            )}

            <section className="space-y-2 rounded-lg border border-border p-3" data-testid="limpeza-secao">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Trash2 className="h-4 w-4 text-destructive" />
                Limpar números que não servem
              </div>
              <p className="text-xs text-muted-foreground">
                Sem WhatsApp (já conferido): <strong>{fmt(previa.inutil_sem_whatsapp)}</strong> · Fixo ainda não conferido:{" "}
                <strong>{fmt(previa.inutil_fixo_nao_conferido)}</strong> · Número inválido: <strong>{fmt(previa.inutil_invalido)}</strong>.
                Opt-out nunca é apagado.
              </p>
              {(previa.inutil_fixo_nao_conferido || 0) > 0 && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  Alguns fixos têm WhatsApp Business. Se quiser salvar esses, confira os números antes de apagar.
                </p>
              )}
              {apagados !== null && (
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400" data-testid="limpeza-feita">
                  {fmt(apagados)} lead(s) apagado(s) da base.
                </p>
              )}
              {limpeza && limpeza.willDelete > 0 ? (
                <>
                  <p className="text-xs" data-testid="limpeza-resumo">
                    Vai apagar <strong>{fmt(limpeza.willDelete)}</strong> lead(s) de vez.
                    {limpeza.kept === 1 ? " 1 fica porque já conversou com a empresa." : limpeza.kept > 1 ? ` ${fmt(limpeza.kept)} ficam porque já conversaram com a empresa.` : ""}
                  </p>
                  {!confirmandoLimpeza ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={baixarListaLimpeza} className="h-8 gap-1.5 text-xs">
                        <Download className="h-3.5 w-3.5" /> Baixar a lista antes
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmandoLimpeza(true)}
                        className="h-8 gap-1.5 border-destructive/50 text-xs text-destructive hover:bg-destructive/10"
                        data-testid="btn-limpar"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Apagar {fmt(limpeza.willDelete)} números
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5" data-testid="limpeza-confirmar">
                      <p className="text-xs font-semibold text-destructive">
                        Isso apaga {fmt(limpeza.willDelete)} lead(s) de vez. Não dá para desfazer, só reimportando a lista baixada.
                      </p>
                      {limpeza.confirmation?.typedRequired && (
                        <div className="space-y-1">
                          <Label htmlFor="limpeza-numero" className="text-xs">
                            Digite {limpeza.willDelete} para confirmar
                          </Label>
                          <Input
                            id="limpeza-numero"
                            inputMode="numeric"
                            value={numeroDigitado}
                            onChange={(e) => setNumeroDigitado(e.target.value.replace(/\D/g, ""))}
                            className="h-8"
                          />
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => setConfirmandoLimpeza(false)} className="h-8 text-xs" disabled={apagando}>
                          Cancelar
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={apagarInutilizaveis}
                          disabled={apagando || (Boolean(limpeza.confirmation?.typedRequired) && numeroDigitado !== String(limpeza.willDelete))}
                          className="h-8 gap-1.5 text-xs"
                          data-testid="btn-limpar-confirmar"
                        >
                          {apagando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          Apagar de vez
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground" data-testid="limpeza-vazia">
                  {limpeza ? "Nada para limpar: todos os números da base servem." : "Não foi possível calcular a limpeza agora."}
                </p>
              )}
            </section>

            {previa.fixo > 0 && (
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <PhoneOff className="mt-0.5 h-3 w-3 shrink-0" />
                Telefone fixo só entra em lote quando a conferência confirma que ele tem WhatsApp (alguns comércios usam
                WhatsApp Business no fixo).
              </p>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
