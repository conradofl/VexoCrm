import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/PageShell";
import { GeracaoDigitalTabs } from "@/components/GeracaoDigitalTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { MessageSquare, Plus, Pencil, Trash2, UserCheck, ShieldAlert, Phone, Mail, Trello } from "lucide-react";
import { fetchApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { podeVerClientesGd } from "@/lib/gdClientes";

export interface Colaborador {
  id: string;
  nome: string;
  funcao: string;
  telefone: string;
  email: string | null;
  trello_username: string | null;
  recebe_cobranca_whatsapp: boolean;
  ativo: boolean;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
}

export function GeracaoDigitalColaboradores() {
  const { accessProfile, getIdToken } = useAuth();
  const queryClient = useQueryClient();
  const temAcesso = podeVerClientesGd(accessProfile);

  const [modalAberto, setModalAberto] = useState(false);
  const [colaboradorEditando, setColaboradorEditando] = useState<Colaborador | null>(null);

  // Form state
  const [nome, setNome] = useState("");
  const [funcao, setFuncao] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [trelloUsername, setTrelloUsername] = useState("");
  const [recebeCobranca, setRecebeCobranca] = useState(true);
  const [ativo, setAtivo] = useState(true);
  const [observacoes, setObservacoes] = useState("");

  const abrirModalCriacao = () => {
    setColaboradorEditando(null);
    setNome("");
    setFuncao("");
    setTelefone("");
    setEmail("");
    setTrelloUsername("");
    setRecebeCobranca(true);
    setAtivo(true);
    setObservacoes("");
    setModalAberto(true);
  };

  const abrirModalEdicao = (c: Colaborador) => {
    setColaboradorEditando(c);
    setNome(c.nome);
    setFuncao(c.funcao);
    setTelefone(c.telefone);
    setEmail(c.email || "");
    setTrelloUsername(c.trello_username || "");
    setRecebeCobranca(c.recebe_cobranca_whatsapp);
    setAtivo(c.ativo);
    setObservacoes(c.observacoes || "");
    setModalAberto(true);
  };

  // ─── Query Listar ─────────────────────────────────────────────────────────
  const { data: colaboradores = [], isLoading, refetch } = useQuery<Colaborador[]>({
    queryKey: ["gdColaboradores"],
    queryFn: async () => {
      const token = await getIdToken();
      const res = await fetchApi("/api/gd/colaboradores", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Falha ao carregar colaboradores");
      const json = await res.json();
      return json.data || [];
    },
    enabled: temAcesso,
  });

  // ─── Mutation Salvar (Criar ou Editar) ─────────────────────────────────────
  const salvarMutation = useMutation({
    mutationFn: async () => {
      const token = await getIdToken();
      const payload = {
        nome,
        funcao,
        telefone,
        email: email.trim() || null,
        trello_username: trelloUsername.trim() || null,
        recebe_cobranca_whatsapp: recebeCobranca,
        ativo,
        observacoes: observacoes.trim() || null,
      };

      const url = colaboradorEditando
        ? `/api/gd/colaboradores/${colaboradorEditando.id}`
        : "/api/gd/colaboradores";
      const method = colaboradorEditando ? "PATCH" : "POST";

      const res = await fetchApi(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Erro ao salvar colaborador.");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gdColaboradores"] });
      toast({
        title: colaboradorEditando ? "Colaborador atualizado!" : "Colaborador cadastrado!",
        description: `${nome} foi salvo com sucesso.`,
      });
      setModalAberto(false);
    },
    onError: (err: any) => {
      toast({
        title: "Erro ao salvar",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ─── Mutation Toggle Rápido ───────────────────────────────────────────────
  const toggleMutation = useMutation({
    mutationFn: async ({ id, campo, valor }: { id: string; campo: string; valor: boolean }) => {
      const token = await getIdToken();
      const res = await fetchApi(`/api/gd/colaboradores/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ [campo]: valor }),
      });
      if (!res.ok) throw new Error("Erro ao atualizar status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gdColaboradores"] });
    },
    onError: (err: any) => {
      toast({ title: "Falha na atualização", description: err.message, variant: "destructive" });
    },
  });

  // ─── Mutation Deletar ─────────────────────────────────────────────────────
  const deletarMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await getIdToken();
      const res = await fetchApi(`/api/gd/colaboradores/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Erro ao remover colaborador");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gdColaboradores"] });
      toast({ title: "Removido", description: "Colaborador removido da lista." });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" });
    },
  });

  if (!temAcesso) {
    return (
      <PageShell title="Colaboradores GD">
        <div className="p-8 text-center text-slate-500">
          <ShieldAlert className="h-12 w-12 mx-auto text-amber-500 mb-2" />
          <h2 className="text-lg font-bold">Acesso Restrito</h2>
          <p className="text-sm">Você não tem permissão para visualizar a equipe da Geração Digital.</p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="Colaboradores GD - Equipe & Cobranças">
      <GeracaoDigitalTabs />

      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-white/10 shadow-sm">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <UserCheck className="h-6 w-6 text-purple-600" />
              Equipe Geração Digital & Cobranças WhatsApp
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Colaboradores oficiais da agência monitorados pelo GoClaw, Heloísa e Vigia de Prazos (100% WhatsApp).
            </p>
          </div>

          <Button
            onClick={abrirModalCriacao}
            className="bg-purple-600 hover:bg-purple-700 text-white font-medium flex items-center gap-2 rounded-xl"
          >
            <Plus className="h-4 w-4" />
            Novo Colaborador
          </Button>
        </div>

        {/* Tabela de Colaboradores */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-white/10 shadow-sm overflow-hidden">
          <Table>
            <TableHeader className="bg-slate-50 dark:bg-slate-800/50">
              <TableRow>
                <TableHead className="font-bold">Nome & Função</TableHead>
                <TableHead className="font-bold">WhatsApp</TableHead>
                <TableHead className="font-bold">Trello</TableHead>
                <TableHead className="font-bold text-center">Cobrança WhatsApp</TableHead>
                <TableHead className="font-bold text-center">Status</TableHead>
                <TableHead className="font-bold text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-slate-400">
                    Carregando equipe...
                  </TableCell>
                </TableRow>
              ) : colaboradores.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-slate-400">
                    Nenhum colaborador cadastrado.
                  </TableCell>
                </TableRow>
              ) : (
                colaboradores.map((c) => (
                  <TableRow key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <TableCell>
                      <div className="font-semibold text-slate-900 dark:text-white">{c.nome}</div>
                      <div className="text-xs text-slate-500">{c.funcao}</div>
                      {c.email && (
                        <div className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                          <Mail className="h-3 w-3" />
                          {c.email}
                        </div>
                      )}
                    </TableCell>

                    <TableCell>
                      <a
                        href={`https://wa.me/${c.telefone}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-mono font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800 hover:underline"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        +{c.telefone}
                      </a>
                    </TableCell>

                    <TableCell>
                      {c.trello_username ? (
                        <Badge variant="outline" className="text-xs font-mono bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800">
                          @{c.trello_username}
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TableCell>

                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Switch
                          checked={c.recebe_cobranca_whatsapp}
                          onCheckedChange={(val) =>
                            toggleMutation.mutate({ id: c.id, campo: "recebe_cobranca_whatsapp", valor: val })
                          }
                        />
                        <span className="text-xs text-slate-500">
                          {c.recebe_cobranca_whatsapp ? "Ativa" : "Pausada"}
                        </span>
                      </div>
                    </TableCell>

                    <TableCell className="text-center">
                      <Badge
                        variant={c.ativo ? "default" : "secondary"}
                        className={c.ativo ? "bg-emerald-500 hover:bg-emerald-600 text-white" : "text-slate-400"}
                      >
                        {c.ativo ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => abrirModalEdicao(c)}
                          className="h-8 w-8 p-0 text-slate-600 hover:text-slate-900 dark:text-slate-300"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm(`Remover "${c.nome}" da equipe oficial?`)) {
                              deletarMutation.mutate(c.id);
                            }
                          }}
                          className="h-8 w-8 p-0 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Modal Criar/Editar */}
      <Dialog open={modalAberto} onOpenChange={setModalAberto}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              {colaboradorEditando ? "Editar Colaborador" : "Novo Colaborador"}
            </DialogTitle>
            <DialogDescription>
              Dados de contato e parâmetros de acionamento do colaborador pelo WhatsApp.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Nome Completo *</label>
              <Input
                placeholder="Ex: Santana"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Função / Cargo *</label>
              <Input
                placeholder="Ex: Diretor de arte / Criativos"
                value={funcao}
                onChange={(e) => setFuncao(e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">WhatsApp (com DDD) *</label>
              <Input
                placeholder="Ex: 5534997817660"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                className="mt-1 font-mono"
              />
              <span className="text-[11px] text-slate-400">Pode colar com ou sem 55, parênteses e traço.</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Usuário Trello</label>
                <Input
                  placeholder="Ex: santana_gd"
                  value={trelloUsername}
                  onChange={(e) => setTrelloUsername(e.target.value)}
                  className="mt-1 font-mono text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">E-mail</label>
                <Input
                  placeholder="email@agenciagd.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">Recebe Cobrança WhatsApp</div>
                  <div className="text-[11px] text-slate-500">Permite que o GoClaw e a Heloísa enviem avisos automáticos</div>
                </div>
                <Switch checked={recebeCobranca} onCheckedChange={setRecebeCobranca} />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">Colaborador Ativo</div>
                  <div className="text-[11px] text-slate-500">Colaborador ativo na operação da agência</div>
                </div>
                <Switch checked={ativo} onCheckedChange={setAtivo} />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setModalAberto(false)} className="rounded-xl">
              Cancelar
            </Button>
            <Button
              onClick={() => salvarMutation.mutate()}
              disabled={salvarMutation.isPending || !nome.trim() || !funcao.trim() || !telefone.trim()}
              className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl"
            >
              {salvarMutation.isPending ? "Salvando..." : "Salvar Colaborador"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
export default GeracaoDigitalColaboradores;
