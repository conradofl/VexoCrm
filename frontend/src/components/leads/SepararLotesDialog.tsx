import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, Layers, Loader2, PhoneOff, ShieldCheck, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

/** De onde o lote sai (backend: services/leadBatchOrigin.js). Sem origem = empresa inteira. */
export type OrigemLote =
  | { tipo: "empresa" }
  | { tipo: "tag"; tag: string }
  | { tipo: "planilha"; importId: string }
  | { tipo: "filtro"; filtro: Record<string, unknown> };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  /** Não é mais usado: a conferência de WhatsApp, que escolhia o chip, foi desligada (27/11/2026). */
  chips?: ChipOption[];
  onSeparated?: () => void;
  /** Tags da empresa, para "De onde tirar: uma tag". */
  tags?: { tag: string; count?: number }[];
  /** Planilhas da empresa, para "De onde tirar: uma planilha". */
  planilhas?: { id: string; nome: string; linhas?: number }[];
  /** Filtro que está na tabela agora (quando há algum), para "De onde tirar: o filtro da tela". */
  filtroAtual?: { filtro: Record<string, unknown>; rotulo: string; total?: number } | null;
  /** Origem com que o diálogo abre (ex.: botão "Separar lote deste filtro"). */
  origemInicial?: OrigemLote;
}

const fmt = (n: number | undefined | null) => Number(n || 0).toLocaleString("pt-BR");

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

export function SepararLotesDialog({
  open,
  onOpenChange,
  clientId,
  onSeparated,
  tags = [],
  planilhas = [],
  filtroAtual = null,
  origemInicial,
}: Props) {
  const { getIdToken } = useAuth();
  // "De onde tirar": empresa inteira, uma tag, uma planilha ou o filtro da tela (24/11/2026).
  const [origemTipo, setOrigemTipo] = useState<OrigemLote["tipo"]>("empresa");
  const [origemTag, setOrigemTag] = useState("");
  const [origemPlanilha, setOrigemPlanilha] = useState("");
  const origem = useMemo<OrigemLote>(() => {
    if (origemTipo === "tag" && origemTag) return { tipo: "tag", tag: origemTag };
    if (origemTipo === "planilha" && origemPlanilha) return { tipo: "planilha", importId: origemPlanilha };
    if (origemTipo === "filtro" && filtroAtual) return { tipo: "filtro", filtro: filtroAtual.filtro };
    return { tipo: "empresa" };
  }, [origemTipo, origemTag, origemPlanilha, filtroAtual]);
  const origemIncompleta = origemTipo !== "empresa" && origem.tipo === "empresa";
  const origemParam = origem.tipo === "empresa" ? "" : `&origem=${encodeURIComponent(JSON.stringify(origem))}`;
  const [previa, setPrevia] = useState<PreviaLotes | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tamanho, setTamanho] = useState("50");
  const [quantidade, setQuantidade] = useState("1");
  const [nomeBase, setNomeBase] = useState("");
  const [exigirWhatsapp, setExigirWhatsapp] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [criadas, setCriadas] = useState<PlanilhaCriada[] | null>(null);
  const [limpeza, setLimpeza] = useState<PreviaLimpeza | null>(null);
  const [confirmandoLimpeza, setConfirmandoLimpeza] = useState(false);
  const [numeroDigitado, setNumeroDigitado] = useState("");
  const [apagando, setApagando] = useState(false);
  const [apagados, setApagados] = useState<number | null>(null);

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
      const dados = await chamar(`/api/leads/lotes/previa?clientId=${encodeURIComponent(clientId)}${origemParam}`);
      setPrevia(dados.previa);
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
  }, [chamar, clientId, origemParam]);

  // Abriu: começa pela origem pedida (botão "Separar lote deste filtro") ou pela empresa inteira.
  useEffect(() => {
    if (!open) return;
    const o = origemInicial ?? { tipo: "empresa" as const };
    setOrigemTipo(o.tipo);
    if (o.tipo === "tag") setOrigemTag(o.tag);
    if (o.tipo === "planilha") setOrigemPlanilha(o.importId);
    if (o.tipo === "tag" && !nomeBase) setNomeBase(o.tag.slice(0, 60));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setCriadas(null);
    setConfirmandoLimpeza(false);
    setNumeroDigitado("");
    setApagados(null);
    void carregar();
  }, [open, carregar]);

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
        body: JSON.stringify({
          clientId,
          tamanho: t,
          quantidade: q,
          nomeBase: nomeBase.trim() || undefined,
          exigirWhatsapp,
          ...(origem.tipo === "empresa" ? {} : { origem }),
        }),
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
            <section className="space-y-2 rounded-lg border border-primary/30 bg-primary/[0.03] p-3" data-testid="lote-origem">
              <Label className="text-xs font-semibold">De onde tirar o lote</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Select
                  value={origemTipo}
                  onValueChange={(v) => {
                    setOrigemTipo(v as OrigemLote["tipo"]);
                    setCriadas(null);
                  }}
                >
                  <SelectTrigger className="h-9 text-xs" data-testid="lote-origem-tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="empresa" className="text-xs">Empresa inteira</SelectItem>
                    <SelectItem value="tag" className="text-xs" disabled={tags.length === 0}>Uma tag</SelectItem>
                    <SelectItem value="planilha" className="text-xs" disabled={planilhas.length === 0}>Uma planilha</SelectItem>
                    <SelectItem value="filtro" className="text-xs" disabled={!filtroAtual}>
                      {filtroAtual ? `O filtro da tela (${filtroAtual.rotulo})` : "O filtro da tela (nenhum filtro ativo)"}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {origemTipo === "tag" && (
                  <Select
                    value={origemTag}
                    onValueChange={(v) => {
                      setOrigemTag(v);
                      if (!nomeBase.trim()) setNomeBase(v.slice(0, 60));
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs" data-testid="lote-origem-tag">
                      <SelectValue placeholder="Escolha a tag" />
                    </SelectTrigger>
                    <SelectContent position="popper" className="max-h-72 max-w-[calc(100vw-2rem)]">
                      {tags.map((t) => (
                        <SelectItem key={t.tag} value={t.tag} className="whitespace-normal break-words text-xs">
                          {t.tag}
                          {typeof t.count === "number" ? ` (${fmt(t.count)})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {origemTipo === "planilha" && (
                  <Select value={origemPlanilha} onValueChange={setOrigemPlanilha}>
                    <SelectTrigger className="h-9 text-xs" data-testid="lote-origem-planilha">
                      <SelectValue placeholder="Escolha a planilha" />
                    </SelectTrigger>
                    <SelectContent position="popper" className="max-h-72 max-w-[calc(100vw-2rem)]">
                      {planilhas.map((pl) => (
                        <SelectItem key={pl.id} value={pl.id} className="whitespace-normal break-words text-xs">
                          {pl.nome}
                          {typeof pl.linhas === "number" ? ` (${fmt(pl.linhas)})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground" data-testid="lote-origem-texto">
                {origemIncompleta
                  ? origemTipo === "tag"
                    ? "Escolha a tag para ver quantos estão disponíveis."
                    : "Escolha a planilha para ver quantos estão disponíveis."
                  : origem.tipo === "empresa"
                    ? "O lote sai de toda a base da empresa."
                    : "Os números abaixo são só deste grupo. Quem já recebeu campanha ou já está em outro lote continua de fora."}
              </p>
            </section>

            <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Numero testId="previa-total" rotulo={origem.tipo === "empresa" ? "Leads na base" : "Leads no grupo"} valor={previa.total} />
              <Numero testId="previa-confirmado" rotulo="WhatsApp confirmado" valor={previa.whatsapp_confirmado} />
              <Numero testId="previa-nao-conferido" rotulo="Ainda não conferidos" valor={previa.nao_conferido} />
              <Numero testId="previa-sem-whatsapp" rotulo="Sem WhatsApp" valor={previa.sem_whatsapp} />
              <Numero testId="previa-fixo" rotulo="Telefone fixo" valor={previa.fixo} />
              <Numero testId="previa-recebeu" rotulo="Já receberam campanha" valor={previa.ja_recebeu} />
              <Numero testId="previa-separado" rotulo="Já estão em lote" valor={previa.ja_separado} />
              <Numero testId="previa-disponivel" rotulo="Disponíveis agora" valor={disponiveis} destaque />
            </section>

            <section className="space-y-1 rounded-lg border border-border p-3" data-testid="conferencia-desligada">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Conferência de WhatsApp desligada
              </div>
              <p className="text-xs text-muted-foreground">
                Perguntar ao WhatsApp, em massa, se os números existem derrubou chips. Agora o lote faz uma limpeza sem
                consulta (formato, DDD, sem fixo, sem número inventado, sem repetido) e pausa sozinho se muitos números
                derem inexistente durante o envio, com aviso.
              </p>
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
                  <strong>Só números já confirmados no WhatsApp</strong> (conferidos antes de 27/11). Desligado (padrão), entram
                  os celulares que passaram na limpeza; o lote pausa sozinho se a lista se mostrar ruim.
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
                  disabled={!pedidoValido || vaiSeparar === 0 || enviando || origemIncompleta || carregando}
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
