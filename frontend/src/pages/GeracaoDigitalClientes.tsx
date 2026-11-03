// Clientes da Geração Digital (03/11/2026): a tela que substitui a planilha. Lista, mover de estado,
// linha do tempo, criar e editar, sobre /api/gd/clientes. Sem acabamento visual neste corte.
//
// Três regras que a tela não pode quebrar:
// - prazo é só o que a API manda (PrazoCelula recebe só o objeto prazo; não faz conta);
// - cnpj_a_confirmar aparece e se desliga pelo PATCH;
// - estado só muda por POST /eventos, nunca pelo PATCH.
import { useMemo, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { GeracaoDigitalTabs } from "@/components/GeracaoDigitalTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  GdApiError,
  useCriarGdCliente,
  useEditarGdCliente,
  useGdCliente,
  useGdClientes,
  useGdEstados,
  useMoverGdCliente,
  type NovoGdCliente,
} from "@/hooks/useGdClientes";
import {
  ESCOPOS,
  formatarDataHora,
  linkWhatsApp,
  ordenarClientes,
  podeVerClientesGd,
  rotuloDoAtor,
  textoDesde,
  textoDoPrazo,
  type GdCliente,
  type GdEstado,
  type GdPrazo,
} from "@/lib/gdClientes";

const CAMPO_DO_ERRO: Record<string, string> = {
  NOME_INVALIDO: "nome",
  ESTADO_INVALIDO: "estado",
  CNPJ_INVALIDO: "cnpj",
  TELEFONE_INVALIDO: "aprovador_telefone",
  DRIVE_URL_INVALIDA: "drive_url",
  ESCOPO_INVALIDO: "escopo",
  APROVADOR_NOME_INVALIDO: "aprovador_nome",
  ESCOPO_ORIGINAL_INVALIDO: "escopo_original",
};

type ErrosDeCampo = Record<string, string>;

function errosDe(err: unknown): ErrosDeCampo {
  if (err instanceof GdApiError) return { [CAMPO_DO_ERRO[err.code] || "geral"]: err.message };
  return { geral: err instanceof Error ? err.message : "Erro inesperado." };
}

const LINK_EXTERNO = { target: "_blank", rel: "noopener noreferrer" } as const;

function PrazoCelula({ prazo }: { prazo: GdPrazo | null }) {
  const { texto, atrasado } = textoDoPrazo(prazo);
  return (
    <span>
      {texto}
      {atrasado && <strong className="ml-1 text-red-600">atrasado</strong>}
    </span>
  );
}

// Códigos na célula; o texto como foi vendido ("Vexo disparo (dezembro)") no tooltip e no nome
// acessível do gatilho, e escrito embaixo só em tela estreita, onde não existe hover.
function EscopoCelula({ escopo, original }: { escopo: string[] | null; original: string | null }) {
  const codigos = (escopo || []).join(", ") || "—";
  if (!original) return <span>{codigos}</span>;
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="cursor-help text-left underline decoration-dotted underline-offset-2" aria-label={`${codigos}. Como foi vendido: ${original}`}>
            {codigos}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">{original}</TooltipContent>
      </Tooltip>
      <span className="block text-muted-foreground md:hidden">{original}</span>
    </>
  );
}

function Erro({ msg }: { msg?: string }) {
  return msg ? <p role="alert" className="text-xs text-red-600">{msg}</p> : null;
}

function SeletorDeEstado({ estados, valor, onChange, rotulo, id }: { estados: GdEstado[]; valor: string; onChange: (v: string) => void; rotulo: string; id: string }) {
  return (
    <select id={id} aria-label={rotulo} value={valor} onChange={(e) => onChange(e.target.value)} className="h-9 rounded border px-2 text-sm bg-background">
      <option value="">{rotulo}</option>
      {estados.map((e) => (
        <option key={e.codigo} value={e.codigo}>{e.rotulo_interno}</option>
      ))}
    </select>
  );
}

// Campos opcionais do cadastro, os mesmos no criar e no editar.
type Cadastro = {
  nome: string;
  cnpj: string;
  aprovador_nome: string;
  aprovador_telefone: string;
  drive_url: string;
  escopo: string[];
  escopo_original: string;
};

const cadastroVazio: Cadastro = { nome: "", cnpj: "", aprovador_nome: "", aprovador_telefone: "", drive_url: "", escopo: [], escopo_original: "" };

function cadastroDe(c: GdCliente): Cadastro {
  return {
    nome: c.nome,
    cnpj: c.cnpj || "",
    aprovador_nome: c.aprovador_nome || "",
    aprovador_telefone: c.aprovador_telefone || "",
    drive_url: c.drive_url || "",
    escopo: c.escopo || [],
    escopo_original: c.escopo_original || "",
  };
}

function CamposOpcionais({ valor, onChange, erros }: { valor: Cadastro; onChange: (v: Cadastro) => void; erros: ErrosDeCampo }) {
  const campo = (chave: keyof Cadastro, rotulo: string, placeholder = "") => (
    <label className="flex flex-col gap-1 text-sm">
      {rotulo}
      <Input aria-label={rotulo} placeholder={placeholder} value={valor[chave] as string} onChange={(e) => onChange({ ...valor, [chave]: e.target.value })} />
      <Erro msg={erros[chave]} />
    </label>
  );
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {campo("cnpj", "CNPJ", "só se tiver certeza")}
      {campo("aprovador_nome", "Aprovador")}
      {campo("aprovador_telefone", "Telefone do aprovador", "(34) 99999-0000")}
      {campo("drive_url", "Pasta do Drive", "https://drive.google.com/drive/folders/...")}
      <fieldset className="flex flex-col gap-1 text-sm md:col-span-2">
        <legend>Escopo</legend>
        <div className="flex flex-wrap gap-3">
          {ESCOPOS.map((e) => (
            <label key={e} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={valor.escopo.includes(e)}
                onChange={(ev) => onChange({ ...valor, escopo: ev.target.checked ? [...valor.escopo, e] : valor.escopo.filter((x) => x !== e) })}
              />
              {e}
            </label>
          ))}
        </div>
        <Erro msg={erros.escopo} />
      </fieldset>
      {campo("escopo_original", "Escopo como foi vendido", "ex.: Vexo disparo (dezembro)")}
    </div>
  );
}

// Criar é o botão mais usado na primeira semana: nome e estado bastam, o resto fica recolhido.
function NovoCliente({ estados, onFechar }: { estados: GdEstado[]; onFechar: () => void }) {
  const criar = useCriarGdCliente();
  const [estado, setEstado] = useState("");
  const [cadastro, setCadastro] = useState<Cadastro>(cadastroVazio);
  const [maisDados, setMaisDados] = useState(false);
  const [erros, setErros] = useState<ErrosDeCampo>({});

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const local: ErrosDeCampo = {};
    if (!cadastro.nome.trim()) local.nome = "Informe o nome.";
    if (!estado) local.estado = "Escolha o estado.";
    setErros(local);
    if (Object.keys(local).length) return;
    const corpo: NovoGdCliente = { nome: cadastro.nome.trim(), estado };
    for (const [k, v] of Object.entries(cadastro)) {
      if (k === "nome") continue;
      if (Array.isArray(v) ? v.length : String(v).trim()) (corpo as Record<string, unknown>)[k] = v;
    }
    try {
      await criar.mutateAsync(corpo);
      toast({ title: "Cliente criado", description: cadastro.nome.trim() });
      onFechar();
    } catch (err) {
      setErros(errosDe(err));
    }
  };

  return (
    <form onSubmit={salvar} aria-label="Novo cliente" className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Nome
          <Input aria-label="Nome" autoFocus value={cadastro.nome} onChange={(e) => setCadastro({ ...cadastro, nome: e.target.value })} />
          <Erro msg={erros.nome} />
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <SeletorDeEstado id="novo-estado" estados={estados} valor={estado} onChange={setEstado} rotulo="Estado inicial" />
          <Erro msg={erros.estado} />
        </div>
        <Button type="submit" disabled={criar.isPending}>Criar cliente</Button>
        <Button type="button" variant="ghost" onClick={onFechar}>Cancelar</Button>
      </div>
      <button type="button" className="text-xs underline" onClick={() => setMaisDados((v) => !v)}>
        {maisDados ? "Esconder dados opcionais" : "Mais dados (opcional)"}
      </button>
      {maisDados && <CamposOpcionais valor={cadastro} onChange={setCadastro} erros={erros} />}
      <Erro msg={erros.geral} />
    </form>
  );
}

function MoverEstado({ cliente, estados, onConflito }: { cliente: GdCliente; estados: GdEstado[]; onConflito: (msg: string) => void }) {
  const mover = useMoverGdCliente();
  const [aberto, setAberto] = useState(false);
  const [destino, setDestino] = useState("");
  const [motivo, setMotivo] = useState("");
  const opcoes = estados.filter((e) => e.codigo !== cliente.estado_atual);

  const fechar = () => {
    setAberto(false);
    setDestino("");
    setMotivo("");
  };

  const confirmar = async () => {
    if (!destino) return;
    try {
      await mover.mutateAsync({ id: cliente.id, estado: destino, estadoEsperado: cliente.estado_atual, motivo: motivo.trim() || undefined });
      fechar();
    } catch (err) {
      fechar();
      if (err instanceof GdApiError && err.code === "ESTADO_MUDOU") {
        const atual = estados.find((e) => e.codigo === err.details?.estado_atual)?.rotulo_interno || err.details?.estado_atual || "outro estado";
        onConflito(`Outra pessoa moveu ${cliente.nome} para ${atual}. A lista foi recarregada; confira antes de mover de novo.`);
        return;
      }
      toast({ title: "Não foi possível mover", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  // Botão compacto por linha: os clientes em ATIVO quase nunca se movem, e o seletor aberto em toda
  // linha virava a coluna mais larga da tela (ajuste do dono, 03/11/2026).
  return (
    <Popover open={aberto} onOpenChange={(v) => (v ? setAberto(true) : fechar())}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" aria-label={`Mover… ${cliente.nome}`}>Mover…</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2 p-3">
        <SeletorDeEstado id={`mover-${cliente.id}`} estados={opcoes} valor={destino} onChange={setDestino} rotulo={`Mover ${cliente.nome}`} />
        <Input aria-label="Motivo (opcional)" placeholder="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} className="h-8 text-xs" />
        <Button size="sm" className="w-full" disabled={!destino || mover.isPending} onClick={confirmar}>Mover</Button>
      </PopoverContent>
    </Popover>
  );
}

function Detalhe({ id, onFechar }: { id: string; onFechar: () => void }) {
  const { data, isLoading, error } = useGdCliente(id);
  const editar = useEditarGdCliente();
  const [editando, setEditando] = useState(false);
  const [cadastro, setCadastro] = useState<Cadastro>(cadastroVazio);
  const [erros, setErros] = useState<ErrosDeCampo>({});

  if (isLoading) return <section aria-label="Detalhe do cliente" className="rounded-lg border p-4">Carregando…</section>;
  if (error || !data) return <section aria-label="Detalhe do cliente" className="rounded-lg border p-4"><Erro msg={error instanceof Error ? error.message : "Cliente não encontrado."} /></section>;
  const { cliente, eventos } = data;

  const abrirEdicao = () => {
    setCadastro(cadastroDe(cliente));
    setErros({});
    setEditando(true);
  };

  // Só o que mudou vai no PATCH; a lista branca do hook descarta o resto.
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    const original = cadastroDe(cliente);
    const mudancas: Record<string, unknown> = {};
    for (const k of Object.keys(cadastro) as (keyof Cadastro)[]) {
      const novo = cadastro[k];
      if (JSON.stringify(novo) === JSON.stringify(original[k])) continue;
      mudancas[k] = Array.isArray(novo) ? novo : (novo as string).trim() || null;
    }
    if (Object.keys(mudancas).length === 0) {
      setEditando(false);
      return;
    }
    try {
      await editar.mutateAsync({ id: cliente.id, mudancas });
      setEditando(false);
    } catch (err) {
      setErros(errosDe(err));
    }
  };

  const conferirCnpj = async () => {
    try {
      await editar.mutateAsync({ id: cliente.id, mudancas: { cnpj_a_confirmar: false } });
    } catch (err) {
      toast({ title: "Não foi possível marcar o CNPJ", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  return (
    <section aria-label="Detalhe do cliente" className="rounded-lg border p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{cliente.nome}</h2>
          <p className="text-sm text-muted-foreground">CNPJ: {cliente.cnpj || "não informado"}</p>
        </div>
        <div className="flex gap-2">
          {!editando && <Button size="sm" variant="outline" onClick={abrirEdicao}>Editar dados</Button>}
          <Button size="sm" variant="ghost" onClick={onFechar}>Fechar</Button>
        </div>
      </div>

      {cliente.cnpj_a_confirmar && (
        <div role="status" className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          CNPJ a confirmar: o número gravado ({cliente.cnpj}) ainda não foi conferido.
          <Button size="sm" className="ml-3" onClick={conferirCnpj} disabled={editar.isPending}>CNPJ conferido</Button>
        </div>
      )}

      {editando && (
        <form onSubmit={salvar} aria-label="Editar cliente" className="space-y-3">
          <label className="flex flex-col gap-1 text-sm">
            Nome
            <Input aria-label="Nome" value={cadastro.nome} onChange={(e) => setCadastro({ ...cadastro, nome: e.target.value })} />
            <Erro msg={erros.nome} />
          </label>
          <CamposOpcionais valor={cadastro} onChange={setCadastro} erros={erros} />
          <Erro msg={erros.geral} />
          <div className="flex gap-2">
            <Button type="submit" disabled={editar.isPending}>Salvar</Button>
            <Button type="button" variant="ghost" onClick={() => setEditando(false)}>Cancelar</Button>
          </div>
        </form>
      )}

      <div>
        <h3 className="font-medium mb-2">Linha do tempo</h3>
        <ol aria-label="Linha do tempo" className="space-y-2 text-sm">
          {eventos.map((ev) => (
            <li key={ev.id} className="border-l-2 pl-3">
              <div>
                {ev.estado_anterior ? `${ev.estado_anterior} → ` : ""}<strong>{ev.rotulo_interno}</strong>
                {" · "}{formatarDataHora(ev.ocorrido_em)}{ev.data_estimada ? " (estimada)" : ""}
              </div>
              <div className="text-muted-foreground">
                {ev.origem} · {rotuloDoAtor(ev)}{ev.motivo ? ` · ${ev.motivo}` : ""}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function SemPermissao() {
  return (
    <PageShell title="Clientes GD" description="Estado de cada cliente da Geração Digital.">
      <GeracaoDigitalTabs />
      <p role="alert" className="mt-6">Sem permissão para clientes da GD. Peça acesso às propostas da Geração Digital.</p>
    </PageShell>
  );
}

// A checagem daqui só evita chamar a API à toa; quem decide é o backend (o 403 cai em SemPermissao).
export default function GeracaoDigitalClientes() {
  const { accessProfile } = useAuth();
  return podeVerClientesGd(accessProfile) ? <TelaClientes /> : <SemPermissao />;
}

function TelaClientes() {
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroFase, setFiltroFase] = useState("");
  const [criando, setCriando] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const estadosQ = useGdEstados();
  const clientesQ = useGdClientes({ estado: filtroEstado, fase: filtroFase });
  const estados = useMemo(() => estadosQ.data || [], [estadosQ.data]);
  const fases = useMemo(() => [...new Set(estados.map((e) => e.fase))], [estados]);
  const clientes = useMemo(() => ordenarClientes(clientesQ.data || []), [clientesQ.data]);

  const erro = clientesQ.error || estadosQ.error;
  if (erro instanceof GdApiError && erro.status === 403) return <SemPermissao />;

  return (
    <PageShell title="Clientes GD" description="Estado de cada cliente da Geração Digital.">
      <GeracaoDigitalTabs />
      <div className="mt-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setCriando(true)} disabled={criando}>Novo cliente</Button>
          <select aria-label="Filtrar por estado" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className="h-9 rounded border px-2 text-sm bg-background">
            <option value="">Todos os estados</option>
            {estados.map((e) => <option key={e.codigo} value={e.codigo}>{e.rotulo_interno}</option>)}
          </select>
          <select aria-label="Filtrar por fase" value={filtroFase} onChange={(e) => setFiltroFase(e.target.value)} className="h-9 rounded border px-2 text-sm bg-background">
            <option value="">Todas as fases</option>
            {fases.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <span className="text-sm text-muted-foreground">{clientes.length} clientes</span>
        </div>

        {criando && <NovoCliente estados={estados} onFechar={() => setCriando(false)} />}

        {aviso && (
          <div role="alert" className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            {aviso}
            <button type="button" className="ml-3 underline" onClick={() => setAviso(null)}>ok</button>
          </div>
        )}

        {erro && !(erro instanceof GdApiError && erro.status === 403) && <Erro msg={erro instanceof Error ? erro.message : "Erro ao carregar."} />}
        {clientesQ.isLoading ? (
          <p>Carregando…</p>
        ) : (
          <TooltipProvider delayDuration={200}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>No estado</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Aprovador</TableHead>
                  <TableHead>Escopo</TableHead>
                  <TableHead>Drive</TableHead>
                  <TableHead className="w-px" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientes.map((c) => (
                  <TableRow key={c.id} data-testid="linha-cliente" className="align-top">
                    <TableCell>
                      <button type="button" className="underline text-left" onClick={() => setAberto(c.id)}>{c.nome}</button>
                      {c.cnpj_a_confirmar && <span className="ml-2 rounded bg-amber-200 px-1 text-[10px] text-amber-900">CNPJ a confirmar</span>}
                    </TableCell>
                    <TableCell>{c.rotulo_interno || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{textoDesde(c)}</TableCell>
                    <TableCell data-testid="prazo"><PrazoCelula prazo={c.prazo} /></TableCell>
                    <TableCell>
                      {c.aprovador_nome || "—"}
                      {c.aprovador_telefone && (
                        <a className="block underline" href={linkWhatsApp(c.aprovador_telefone)} {...LINK_EXTERNO}>WhatsApp</a>
                      )}
                    </TableCell>
                    <TableCell className="min-w-[10rem]"><EscopoCelula escopo={c.escopo} original={c.escopo_original} /></TableCell>
                    <TableCell>
                      {c.drive_url ? <a className="underline" href={c.drive_url} {...LINK_EXTERNO}>Pasta</a> : "—"}
                    </TableCell>
                    <TableCell className="text-right"><MoverEstado cliente={c} estados={estados} onConflito={setAviso} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TooltipProvider>
        )}

        {aberto && <Detalhe id={aberto} onFechar={() => setAberto(null)} />}
      </div>
    </PageShell>
  );
}
