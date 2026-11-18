import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";
import {
  Bot,
  Cpu,
  Sparkles,
  CheckCircle2,
  XCircle,
  Play,
  Pause,
  Save,
  MessageSquare,
  ShieldCheck,
  Zap,
  Activity,
  Users,
  Terminal,
  Plus,
  Trash2,
  Power,
  Calendar,
  Video,
  Clock,
  Search,
  RotateCw,
  Mail,
  Mic,
  Eye,
  AlertTriangle,
  ExternalLink,
  Check,
  ListTodo,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { podeVerClientesGd } from "@/lib/gdClientes";

export interface HeloisaUsuario {
  id: string;
  client_id: string;
  nome: string;
  telefone: string;
  papel: string;
  ativo: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface HeloisaAgenda {
  id: string;
  nome: string;
  email: string;
  telefone: string | null;
  papel: string;
  ativo: boolean;
  notificar_whatsapp: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface HeloisaExecucao {
  id: string;
  canal: string;
  solicitante_nome: string;
  solicitante_telefone: string | null;
  solicitante_papel: string | null;
  client_id: string;
  texto_entrada: string;
  tipo_entrada: string;
  ferramenta_executada: string | null;
  parametros: any;
  resultado: any;
  resposta_saida: string;
  status: "sucesso" | "erro" | "aviso";
  erro_detalhes: string | null;
  tempo_execucao_ms: number;
  created_at: string;
}

export function formatarTelefoneExibicao(tel: string) {
  const digits = String(tel || "").replace(/\D/g, "");
  if (!digits) return "—";
  if (digits.startsWith("55") && digits.length >= 12) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    if (rest.length === 9) {
      return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    }
    if (rest.length === 8) {
      return `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
    }
    return `+55 (${ddd}) ${rest}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return tel;
}

interface GoclawRuntimeStatus {
  online: boolean;
  latencyMs: number | null;
  url: string;
  primaryModel: string;
  fallbackModel: string;
  lanes: string[];
}

interface GoclawStatusResponse {
  ok: boolean;
  runtime: GoclawRuntimeStatus;
  users: Array<{ username: string; name: string; role: string }>;
}

const LANES_METADATA = [
  {
    key: "heloisa",
    nome: "Heloísa (Átrio & Interface Executiva)",
    descricao: "Copiloto direto de Conrado e Caio no WhatsApp. Processa áudios e texto, comanda e orquestra todas as personas da família.",
    tag: "Átrio / WhatsApp",
    cor: "purple",
  },
  {
    key: "gomes",
    nome: "Gomes (Cartório & Contratos)",
    descricao: "Emissão autônoma de propostas e minutas contratuais da GD. Publica no grupo PASTA do WhatsApp e notifica Caio no privado (Zero Slack).",
    tag: "Cartório & Contratos",
    cor: "emerald",
  },
  {
    key: "tropeco",
    nome: "Tropeço (Operações & Onboarding)",
    descricao: "Estruturação das 4 pastas no Google Drive, criação de grupos WhatsApp internos e de clientes via Evolution API e boas-vindas operacionais.",
    tag: "Operações & Drive",
    cor: "blue",
  },
  {
    key: "maozinha",
    nome: "Mãozinha (Agendador & Reuniões)",
    descricao: "Sincronização com Google Calendar oficial, links Google Meet seguros, supressão de mensagens duplicadas e respeito a reuniões exclusivas.",
    tag: "Agendador & Meet",
    cor: "amber",
  },
  {
    key: "morticia",
    nome: "Mortícia (Cobradora D-2, D-1, D-0)",
    descricao: "Régua de cobrança condicional inteligente no WhatsApp para prazos de demandas do Trello, ativada em D-2, D-1 e D-0.",
    tag: "Cobrança Condicional",
    cor: "rose",
  },
  {
    key: "wandinha",
    nome: "Wandinha (Síndica & Trello Auditor)",
    descricao: "Vigilância em tempo real dos quadros na workspace 'Mídias Sociais'. Inspeciona colunas e status de aprovação/conclusão para desarmar cobranças da Mortícia.",
    tag: "Síndica & Auditoria",
    cor: "slate",
  },
  {
    key: "maestro",
    nome: "Maestro (COO & Triagem)",
    descricao: "Coordenação geral da agência, orquestração de entregas e distribuição.",
    tag: "Coordenação",
    cor: "indigo",
  },
  {
    key: "demandas_cron",
    nome: "Vigia GD (Auditor Cron WhatsApp)",
    descricao: "Robô de monitoramento de prazos que roda às 09h00 e 18h00 disparando alertas no WhatsApp.",
    tag: "Automação Cron",
    cor: "amber",
  },
  {
    key: "onboarding",
    nome: "Onboarding (Boas-vindas Clientes)",
    descricao: "Geração de grupos de WhatsApp, coleta de briefings e boas-vindas dos novos clientes.",
    tag: "Clientes Novos",
    cor: "emerald",
  },
];

export function GeracaoDigitalGoclawConfig() {
  const { accessProfile, getIdToken } = useAuth();
  const queryClient = useQueryClient();
  const temAcesso = podeVerClientesGd(accessProfile);

  // Aba Geral
  const [painelAba, setPainelAba] = useState<"execucoes" | "agendas" | "diretores" | "prompts">("execucoes");

  // Filtros de Execuções
  const [filtroCanal, setFiltroCanal] = useState("todos");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [buscaExecucao, setBuscaExecucao] = useState("");
  const [execucaoDetalhes, setExecucaoDetalhes] = useState<HeloisaExecucao | null>(null);

  // Prompts Lanes
  const [activeLane, setActiveLane] = useState("heloisa");
  const [promptEditando, setPromptEditando] = useState<Record<string, string>>({});
  const [logDisparo, setLogDisparo] = useState<any>(null);

  // ─── Query Configuração Geral da Heloísa (Kill Switch) ───────────────────
  const { data: configData, isLoading: carregandoConfig } = useQuery<{
    ok: boolean;
    config: { ativo: boolean; notificar_whatsapp: boolean };
  }>({
    queryKey: ["heloisaConfig"],
    queryFn: async () => {
      const token = await getIdToken();
      const res = await fetchApi("/api/goclaw/heloisa/config", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Falha ao carregar configurações da Heloísa");
      return res.json();
    },
    enabled: temAcesso,
    refetchInterval: 10000,
  });

  const heloisaAtiva = configData?.config?.ativo !== false;

  // ─── Mutation Liga / Desliga Heloísa (Kill Switch) ────────────────────────
  const toggleHeloisaAtivaMutation = useMutation({
    mutationFn: async (novoAtivo: boolean) => {
      const token = await getIdToken();
      const res = await fetchApi("/api/goclaw/heloisa/config", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ativo: novoAtivo }),
      });
      if (!res.ok) throw new Error("Falha ao alternar status da Heloísa");
      return res.json();
    },
    onSuccess: (data, novoAtivo) => {
      queryClient.setQueryData(["heloisaConfig"], (prev: any) => ({
        ...prev,
        config: { ...prev?.config, ativo: novoAtivo },
      }));
      toast({
        title: novoAtivo ? "Heloísa Ativada!" : "Heloísa Desligada/Pausada",
        description: novoAtivo
          ? "A Heloísa está ativa e pronta para responder no WhatsApp e no Widget Web."
          : "A Heloísa foi desligada. Nenhuma mensagem do WhatsApp será interceptada até você reativar.",
        variant: novoAtivo ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["heloisaConfig"] });
    },
    onError: (err: any) => {
      toast({
        title: "Erro ao alternar status",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ─── Query Histórico de Execuções e Tarefas da Heloísa ────────────────────
  const {
    data: execucoesData,
    isLoading: carregandoExecucoes,
    refetch: refetchExecucoes,
  } = useQuery<{
    ok: boolean;
    data: HeloisaExecucao[];
    pagination: { page: number; limit: number; total: number; pages: number };
    stats: { total: number; sucesso: number; erro: number; hoje: number; whatsapp: number; voice_web: number };
  }>({
    queryKey: ["heloisaExecucoes", filtroCanal, filtroStatus, buscaExecucao],
    queryFn: async () => {
      const token = await getIdToken();
      const params = new URLSearchParams();
      if (filtroCanal !== "todos") params.set("canal", filtroCanal);
      if (filtroStatus !== "todos") params.set("status", filtroStatus);
      if (buscaExecucao.trim()) params.set("busca", buscaExecucao.trim());
      params.set("limit", "50");

      const res = await fetchApi(`/api/goclaw/heloisa/execucoes?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Falha ao carregar histórico de execuções");
      return res.json();
    },
    enabled: temAcesso,
    refetchInterval: 15000,
  });

  // ─── Mutation Limpar Histórico de Execuções ──────────────────────────────
  const limparExecucoesMutation = useMutation({
    mutationFn: async () => {
      const token = await getIdToken();
      const res = await fetchApi("/api/goclaw/heloisa/execucoes/limpar", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Falha ao limpar histórico");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Histórico Limpo",
        description: "O registro de tarefas da Heloísa foi resetado com sucesso.",
      });
      queryClient.invalidateQueries({ queryKey: ["heloisaExecucoes"] });
    },
  });

  // ─── Mutation Excluir Execução Individual ────────────────────────────────
  const excluirExecucaoMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await getIdToken();
      const res = await fetchApi(`/api/goclaw/heloisa/execucoes/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Falha ao excluir registro");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["heloisaExecucoes"] });
    },
  });

  // ─── Query Agendas & E-mails (Google Meet) ────────────────────────────────
  const {
    data: agendasData = [],
    isLoading: carregandoAgendas,
  } = useQuery<HeloisaAgenda[]>({
    queryKey: ["heloisaAgendas"],
    queryFn: async () => {
      const token = await getIdToken();
      const res = await fetchApi("/api/goclaw/heloisa/agendas", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Falha ao carregar agendas da Heloísa");
      const json = await res.json();
      return json.data || [];
    },
    enabled: temAcesso,
  });

  // Modal Agendas State
  const [modalAgendaAberto, setModalAgendaAberto] = useState(false);
  const [agendaEmEdicao, setAgendaEmEdicao] = useState<HeloisaAgenda | null>(null);
  const [formAgendaNome, setFormAgendaNome] = useState("");
  const [formAgendaEmail, setFormAgendaEmail] = useState("");
  const [formAgendaTelefone, setFormAgendaTelefone] = useState("");
  const [formAgendaPapel, setFormAgendaPapel] = useState("Sócio Diretor");
  const [formAgendaNotificar, setFormAgendaNotificar] = useState(true);

  const abrirModalCriarAgenda = () => {
    setAgendaEmEdicao(null);
    setFormAgendaNome("");
    setFormAgendaEmail("");
    setFormAgendaTelefone("");
    setFormAgendaPapel("Sócio Diretor");
    setFormAgendaNotificar(true);
    setModalAgendaAberto(true);
  };

  const abrirModalEditarAgenda = (agenda: HeloisaAgenda) => {
    setAgendaEmEdicao(agenda);
    setFormAgendaNome(agenda.nome || "");
    setFormAgendaEmail(agenda.email || "");
    setFormAgendaTelefone(agenda.telefone || "");
    setFormAgendaPapel(agenda.papel || "Sócio Diretor");
    setFormAgendaNotificar(agenda.notificar_whatsapp ?? true);
    setModalAgendaAberto(true);
  };

  // ─── Mutation Salvar / Atualizar Agenda ───────────────────────────────────
  const salvarAgendaMutation = useMutation({
    mutationFn: async () => {
      const token = await getIdToken();
      const payload = {
        nome: formAgendaNome,
        email: formAgendaEmail,
        telefone: formAgendaTelefone,
        papel: formAgendaPapel,
        notificar_whatsapp: formAgendaNotificar,
        ...(agendaEmEdicao ? {} : { ativo: true }),
      };

      const url = agendaEmEdicao
        ? `/api/goclaw/heloisa/agendas/${agendaEmEdicao.id}`
        : "/api/goclaw/heloisa/agendas";
      const method = agendaEmEdicao ? "PATCH" : "POST";

      const res = await fetchApi(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || (agendaEmEdicao ? "Falha ao atualizar agenda." : "Falha ao salvar agenda."));
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: agendaEmEdicao ? "Agenda Atualizada!" : "Agenda Cadastrada!",
        description:
          data.message ||
          (agendaEmEdicao
            ? "Os dados da agenda foram atualizados com sucesso."
            : "E-mail de agenda configurado com sucesso para Google Meet."),
      });
      queryClient.invalidateQueries({ queryKey: ["heloisaAgendas"] });
      setModalAgendaAberto(false);
      setAgendaEmEdicao(null);
    },
    onError: (err: any) => {
      toast({
        title: agendaEmEdicao ? "Erro ao atualizar agenda" : "Erro ao cadastrar agenda",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ─── Mutation Toggle/Atualizar Agenda ─────────────────────────────────────
  const toggleAgendaMutation = useMutation({
    mutationFn: async ({ id, campo, valor }: { id: string; campo: string; valor: any }) => {
      const token = await getIdToken();
      const res = await fetchApi(`/api/goclaw/heloisa/agendas/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ [campo]: valor }),
      });
      if (!res.ok) throw new Error("Falha ao atualizar agenda.");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["heloisaAgendas"] });
    },
    onError: (err: any) => {
      toast({
        title: "Erro ao atualizar",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ─── Mutation Excluir Agenda ──────────────────────────────────────────────
  const excluirAgendaMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await getIdToken();
      const res = await fetchApi(`/api/goclaw/heloisa/agendas/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Falha ao excluir agenda.");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Agenda Removida",
        description: "A agenda foi removida com sucesso.",
      });
      queryClient.invalidateQueries({ queryKey: ["heloisaAgendas"] });
    },
  });

  // ─── Query Status GoClaw ──────────────────────────────────────────────────
  const { data: statusData, isLoading: carregandoStatus, refetch: refetchStatus } = useQuery<GoclawStatusResponse>({
    queryKey: ["goclawStatus"],
    queryFn: async () => {
      const token = await getIdToken();
      const res = await fetchApi("/api/goclaw/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Falha ao consultar status do GoClaw");
      return res.json();
    },
    enabled: temAcesso,
    refetchInterval: 15000,
  });

  // ─── Query Prompts ────────────────────────────────────────────────────────
  const { data: promptsData } = useQuery<{ ok: boolean; prompts: Record<string, string> }>({
    queryKey: ["goclawPrompts"],
    queryFn: async () => {
      const token = await getIdToken();
      const res = await fetchApi("/api/goclaw/prompts", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Falha ao carregar prompts do GoClaw");
      const json = await res.json();
      setPromptEditando(json.prompts || {});
      return json;
    },
    enabled: temAcesso,
  });

  // ─── Mutation Salvar Prompt ───────────────────────────────────────────────
  const salvarPromptMutation = useMutation({
    mutationFn: async () => {
      const token = await getIdToken();
      const content = promptEditando[activeLane] || "";
      const res = await fetchApi(`/api/goclaw/prompts/${activeLane}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Falha ao salvar prompt.");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Prompt Atualizado!",
        description: `O prompt da lane "${activeLane}" foi salvo com sucesso no GoClaw.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Erro ao salvar",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ─── Mutation Testar Vigia ────────────────────────────────────────────────
  const testarVigiaMutation = useMutation({
    mutationFn: async (periodo: string) => {
      const token = await getIdToken();
      const res = await fetchApi("/api/goclaw/test-vigia", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ periodo }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Falha no disparo do Vigia.");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setLogDisparo(data);
      toast({
        title: "Vigia Disparado com Sucesso!",
        description: "Os relatórios foram enviados para o WhatsApp dos sócios.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Falha no disparo",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ─── Query Usuários Autorizados Heloísa ────────────────────────────────────
  const {
    data: heloisaUsuarios = [],
    isLoading: carregandoUsuarios,
  } = useQuery<HeloisaUsuario[]>({
    queryKey: ["heloisaUsuarios"],
    queryFn: async () => {
      const token = await getIdToken();
      const res = await fetchApi("/api/goclaw/heloisa/usuarios", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Falha ao carregar usuários da Heloísa");
      const json = await res.json();
      return json.data || [];
    },
    enabled: temAcesso,
  });

  // Modal Usuário State
  const [modalUsuarioAberto, setModalUsuarioAberto] = useState(false);
  const [formNome, setFormNome] = useState("");
  const [formTelefone, setFormTelefone] = useState("");
  const [formPapel, setFormPapel] = useState("Diretor");
  const [formClientId, setFormClientId] = useState("geracao-digital");

  const abrirModalCriarUsuario = () => {
    setFormNome("");
    setFormTelefone("");
    setFormPapel("Diretor");
    setFormClientId("geracao-digital");
    setModalUsuarioAberto(true);
  };

  // ─── Mutation Salvar Usuário ───────────────────────────────────────────────
  const salvarUsuarioMutation = useMutation({
    mutationFn: async () => {
      const token = await getIdToken();
      const res = await fetchApi("/api/goclaw/heloisa/usuarios", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nome: formNome,
          telefone: formTelefone,
          papel: formPapel,
          client_id: formClientId,
          ativo: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Falha ao salvar número autorizado.");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Número Autorizado!",
        description: data.message || `O número de ${formNome} foi autorizado com sucesso.`,
      });
      queryClient.invalidateQueries({ queryKey: ["heloisaUsuarios"] });
      setModalUsuarioAberto(false);
    },
    onError: (err: any) => {
      toast({
        title: "Erro ao cadastrar",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ─── Mutation Alternar Ativo/Pausar Usuário ────────────────────────────────
  const toggleUsuarioAtivoMutation = useMutation({
    mutationFn: async ({ id, ativoAtual }: { id: string; ativoAtual: boolean }) => {
      const token = await getIdToken();
      const res = await fetchApi(`/api/goclaw/heloisa/usuarios/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ativo: !ativoAtual }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Falha ao atualizar status.");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["heloisaUsuarios"] });
    },
  });

  // ─── Mutation Excluir Usuário ──────────────────────────────────────────────
  const excluirUsuarioMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await getIdToken();
      const res = await fetchApi(`/api/goclaw/heloisa/usuarios/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Falha ao excluir número.");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Número Removido",
        description: "O número foi desautorizado da Heloísa com sucesso.",
      });
      queryClient.invalidateQueries({ queryKey: ["heloisaUsuarios"] });
    },
  });

  if (!temAcesso) {
    return (
      <PageShell title="GoClaw Engine">
        <div className="p-8 text-center text-slate-500">
          <ShieldCheck className="h-12 w-12 mx-auto text-amber-500 mb-2" />
          <h2 className="text-lg font-bold">Acesso Restrito</h2>
          <p className="text-sm">Você não tem permissão para configurar o motor GoClaw.</p>
        </div>
      </PageShell>
    );
  }

  const runtime = statusData?.runtime;
  const execucoesStats = execucoesData?.stats || { total: 0, sucesso: 0, erro: 0, hoje: 0, whatsapp: 0, voice_web: 0 };
  const execucoesLista = execucoesData?.data || [];

  return (
    <PageShell title="Central Executiva · GoClaw & Heloísa">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Principal com Kill Switch & Status */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-white/10 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-purple-500/20 shrink-0">
              <Sparkles className="h-7 w-7" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                  Heloísa · Secretária Executiva Master
                </h1>
                {heloisaAtiva ? (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5 py-1 px-2.5 font-semibold">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    Heloísa Ativa (Online)
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="flex items-center gap-1.5 py-1 px-2.5 font-semibold">
                    <Power className="h-3 w-3" />
                    Heloísa Desligada (Pausada)
                  </Badge>
                )}
                {runtime?.online && (
                  <Badge variant="outline" className="text-slate-500 border-slate-300 dark:border-white/10 text-xs">
                    Runtime GoClaw: {runtime.latencyMs}ms
                  </Badge>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
                Painel mestre de controle e auditoria da assistente autônoma. Monitore tarefas executadas, gerencie agendas e Google Meet, e ative ou pause o robô instantaneamente.
              </p>
            </div>
          </div>

          {/* Kill Switch Card */}
          <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-2xl border border-slate-200/80 dark:border-white/10 shrink-0">
            <div className="text-left sm:text-right">
              <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5 justify-start sm:justify-end">
                <Power className={cn("h-3.5 w-3.5", heloisaAtiva ? "text-emerald-500" : "text-red-500")} />
                Interruptor Geral
              </div>
              <div className="text-[11px] text-slate-500">
                {heloisaAtiva ? "Recebendo áudios e comandos" : "Pausada · Silêncio total"}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={heloisaAtiva}
                onCheckedChange={(checked) => toggleHeloisaAtivaMutation.mutate(checked)}
                disabled={toggleHeloisaAtivaMutation.isPending || carregandoConfig}
                className={cn(
                  "data-[state=checked]:bg-emerald-600 data-[state=unchecked]:bg-slate-300 dark:data-[state=unchecked]:bg-slate-700"
                )}
              />
              <span className="text-xs font-semibold select-none text-slate-700 dark:text-slate-300">
                {heloisaAtiva ? "LIGADA" : "DESLIGADA"}
              </span>
            </div>
          </div>
        </div>

        {/* Abas de Navegação Principal */}
        <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-white/10 pb-2">
          <button
            onClick={() => setPainelAba("execucoes")}
            className={cn(
              "px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border",
              painelAba === "execucoes"
                ? "bg-purple-600 text-white border-purple-600 shadow-sm shadow-purple-500/20"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:bg-slate-50"
            )}
          >
            <ListTodo className="h-4 w-4" />
            <span>Painel de Tarefas & Execuções</span>
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px] px-1.5 py-0 rounded-full",
                painelAba === "execucoes" ? "bg-white/20 text-white" : "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300"
              )}
            >
              {execucoesStats.total}
            </Badge>
          </button>

          <button
            onClick={() => setPainelAba("agendas")}
            className={cn(
              "px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border",
              painelAba === "agendas"
                ? "bg-purple-600 text-white border-purple-600 shadow-sm shadow-purple-500/20"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:bg-slate-50"
            )}
          >
            <Calendar className="h-4 w-4" />
            <span>Agendas & Google Meet</span>
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px] px-1.5 py-0 rounded-full",
                painelAba === "agendas" ? "bg-white/20 text-white" : "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
              )}
            >
              {agendasData.length}
            </Badge>
          </button>

          <button
            onClick={() => setPainelAba("diretores")}
            className={cn(
              "px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border",
              painelAba === "diretores"
                ? "bg-purple-600 text-white border-purple-600 shadow-sm shadow-purple-500/20"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:bg-slate-50"
            )}
          >
            <Users className="h-4 w-4" />
            <span>Diretores Autorizados (WhatsApp)</span>
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px] px-1.5 py-0 rounded-full",
                painelAba === "diretores" ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
              )}
            >
              {heloisaUsuarios.length}
            </Badge>
          </button>

          <button
            onClick={() => setPainelAba("prompts")}
            className={cn(
              "px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border",
              painelAba === "prompts"
                ? "bg-purple-600 text-white border-purple-600 shadow-sm shadow-purple-500/20"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:bg-slate-50"
            )}
          >
            <Terminal className="h-4 w-4" />
            <span>Prompts & Modelos GoClaw</span>
          </button>
        </div>

        {/* ══════════════════════════════════════════════════════════════════════
            ABA 1: HISTÓRICO DE TAREFAS & EXECUÇÕES
           ══════════════════════════════════════════════════════════════════════ */}
        {painelAba === "execucoes" && (
          <div className="space-y-6">
            {/* Cards de Métricas */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="rounded-2xl border-slate-200 dark:border-white/10 shadow-xs">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-semibold text-slate-500">Total de Execuções</div>
                    <div className="text-2xl font-black text-slate-900 dark:text-white mt-1">
                      {execucoesStats.total}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950/50">
                    <ListTodo className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-slate-200 dark:border-white/10 shadow-xs">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-semibold text-slate-500">Sucessos</div>
                    <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
                      {execucoesStats.sucesso}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-slate-200 dark:border-white/10 shadow-xs">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-semibold text-slate-500">Falhas / Alertas</div>
                    <div className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">
                      {execucoesStats.erro}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/50">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border-slate-200 dark:border-white/10 shadow-xs">
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-semibold text-slate-500">Execuções Hoje</div>
                    <div className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">
                      {execucoesStats.hoje}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50">
                    <Clock className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Filtros e Ações */}
            <Card className="rounded-2xl border-slate-200 dark:border-white/10 shadow-sm">
              <CardHeader className="pb-3 border-b border-slate-100 dark:border-white/10">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                      <Activity className="h-4 w-4 text-purple-600" />
                      Auditoria de Comandos e Tarefas
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Histórico completo em tempo real de cada ordem falada ou digitada para a Heloísa
                    </CardDescription>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refetchExecucoes()}
                      className="rounded-xl text-xs h-8 gap-1.5"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      Atualizar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm("Deseja realmente limpar todo o histórico de execuções da Heloísa?")) {
                          limparExecucoesMutation.mutate();
                        }
                      }}
                      disabled={limparExecucoesMutation.isPending || execucoesLista.length === 0}
                      className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 h-8 gap-1.5"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Limpar Histórico
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <Input
                      placeholder="Buscar por ordem, resposta ou solicitante..."
                      value={buscaExecucao}
                      onChange={(e) => setBuscaExecucao(e.target.value)}
                      className="pl-8 text-xs h-8 rounded-xl"
                    />
                  </div>

                  <div className="flex gap-2">
                    <select
                      value={filtroCanal}
                      onChange={(e) => setFiltroCanal(e.target.value)}
                      className="text-xs rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-1 text-slate-700 dark:text-slate-300"
                    >
                      <option value="todos">Todos os Canais</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="voice_web">Widget Web</option>
                    </select>

                    <select
                      value={filtroStatus}
                      onChange={(e) => setFiltroStatus(e.target.value)}
                      className="text-xs rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-1 text-slate-700 dark:text-slate-300"
                    >
                      <option value="todos">Todos os Status</option>
                      <option value="sucesso">Sucesso</option>
                      <option value="erro">Erro</option>
                    </select>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {carregandoExecucoes ? (
                  <div className="p-8 text-center text-xs text-slate-400">
                    <RotateCw className="h-5 w-5 animate-spin mx-auto mb-2 text-purple-600" />
                    Carregando histórico de tarefas...
                  </div>
                ) : execucoesLista.length === 0 ? (
                  <div className="p-12 text-center text-slate-400">
                    <Sparkles className="h-8 w-8 mx-auto mb-2 text-purple-400 opacity-60" />
                    <div className="font-semibold text-slate-700 dark:text-slate-300 text-sm">
                      Nenhuma tarefa registrada ainda
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Mande um áudio ou comando de teste para a Heloísa no WhatsApp ou clique no orbe de voz!
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-white/5">
                    {execucoesLista.map((ex) => (
                      <div
                        key={ex.id}
                        className="p-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors flex flex-col md:flex-row md:items-start justify-between gap-3 text-xs"
                      >
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {/* Canal Badge */}
                            {ex.canal === "whatsapp" ? (
                              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 font-medium text-[10px] px-2 py-0.5 gap-1">
                                <MessageSquare className="h-3 w-3" />
                                WhatsApp
                              </Badge>
                            ) : (
                              <Badge className="bg-purple-500/15 text-purple-700 dark:text-purple-400 border border-purple-500/30 font-medium text-[10px] px-2 py-0.5 gap-1">
                                <Mic className="h-3 w-3" />
                                Orbe de Voz Web
                              </Badge>
                            )}

                            {/* Solicitante */}
                            <span className="font-bold text-slate-900 dark:text-white">
                              {ex.solicitante_nome}
                            </span>
                            {ex.solicitante_papel && (
                              <span className="text-[11px] text-slate-400">({ex.solicitante_papel})</span>
                            )}

                            {/* Status */}
                            {ex.status === "sucesso" ? (
                              <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 text-[10px] px-1.5 py-0">
                                Sucesso
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                Erro
                              </Badge>
                            )}

                            {/* Horário */}
                            <span className="text-[11px] text-slate-400 ml-auto md:ml-0 font-mono">
                              {new Date(ex.created_at).toLocaleString("pt-BR", {
                                day: "2-digit",
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              })}
                            </span>

                            {ex.tempo_execucao_ms > 0 && (
                              <span className="text-[10px] text-slate-400 font-mono">
                                • {ex.tempo_execucao_ms}ms
                              </span>
                            )}
                          </div>

                          {/* Ordem / Entrada */}
                          <div className="font-semibold text-slate-800 dark:text-slate-200 bg-slate-100/60 dark:bg-slate-800/80 p-2 rounded-xl text-xs flex items-start gap-1.5">
                            {ex.tipo_entrada === "audio" ? (
                              <Mic className="h-3.5 w-3.5 text-purple-600 shrink-0 mt-0.5" />
                            ) : (
                              <MessageSquare className="h-3.5 w-3.5 text-indigo-500 shrink-0 mt-0.5" />
                            )}
                            <span className="break-words">"{ex.texto_entrada || "[Áudio sem transcrição]"}"</span>
                          </div>

                          {/* Ferramenta Executada */}
                          {ex.ferramenta_executada && (
                            <div className="flex items-center gap-1.5 text-[11px] text-purple-700 dark:text-purple-300 font-mono">
                              <Zap className="h-3 w-3 text-amber-500" />
                              <span>Tool: {ex.ferramenta_executada}</span>
                            </div>
                          )}

                          {/* Resposta Heloísa */}
                          {ex.resposta_saida && (
                            <div className="text-[11px] text-slate-600 dark:text-slate-400 pl-2 border-l-2 border-purple-500/40 italic">
                              Heloísa: "{ex.resposta_saida.slice(0, 180)}{ex.resposta_saida.length > 180 ? "..." : ""}"
                            </div>
                          )}
                        </div>

                        {/* Ações */}
                        <div className="flex items-center gap-1 shrink-0 self-end md:self-center">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setExecucaoDetalhes(ex)}
                            className="rounded-xl text-xs h-8 gap-1"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Detalhes
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => excluirExecucaoMutation.mutate(ex.id)}
                            className="h-8 w-8 text-slate-400 hover:text-red-600"
                            title="Excluir este log"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            ABA 2: AGENDAS & GOOGLE MEET
           ══════════════════════════════════════════════════════════════════════ */}
        {painelAba === "agendas" && (
          <div className="space-y-6">
            <Card className="rounded-2xl border-slate-200 dark:border-white/10 shadow-sm">
              <CardHeader className="pb-4 border-b border-slate-100 dark:border-white/10">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600">
                      <Calendar className="h-6 w-6" />
                    </div>
                    <div>
                      <CardTitle className="text-base font-bold text-slate-900 dark:text-white">
                        Agendas Oficiais & Integração Google Meet
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Configure os e-mails das agendas (Conrado, Caio, GD). Ao solicitar um agendamento, a Heloísa gera o Google Meet na hora e avisa a equipe no WhatsApp.
                      </CardDescription>
                    </div>
                  </div>

                  <Button
                    size="sm"
                    onClick={abrirModalCriarAgenda}
                    className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs h-9 gap-1.5 shadow-sm"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    + Cadastrar Nova Agenda / E-mail
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="pt-6 space-y-6">
                {/* Banner Educativo */}
                <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-50/70 to-indigo-50/70 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-200/60 dark:border-blue-900/40 text-xs space-y-2">
                  <div className="font-bold text-blue-900 dark:text-blue-200 flex items-center gap-1.5">
                    <Video className="h-4 w-4 text-blue-600" />
                    Como funciona a geração automática de reuniões:
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                    Basta pedir para a Heloísa por voz ou WhatsApp: <code className="bg-white dark:bg-slate-900 px-1.5 py-0.5 rounded font-mono text-[11px]">"Heloísa, agenda uma reunião com o Caio amanhã às 15h sobre a proposta do cliente X"</code>.
                    Ela automaticamente cria o link exclusivo do <strong>Google Meet</strong> (ex: <span className="font-mono text-blue-600">https://meet.google.com/abc-defg-hij</span>), salva o compromisso no calendário do Vexo OS e <strong>dispara na hora uma mensagem no WhatsApp</strong> dos participantes selecionados com o link e detalhes da reunião.
                  </p>
                </div>

                {/* Listagem de Agendas */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {carregandoAgendas ? (
                    <div className="col-span-full p-8 text-center text-xs text-slate-400">
                      Carregando agendas configuradas...
                    </div>
                  ) : agendasData.length === 0 ? (
                    <div className="col-span-full p-8 text-center text-slate-400 border border-dashed rounded-2xl">
                      Nenhuma agenda configurada. Clique no botão acima para adicionar.
                    </div>
                  ) : (
                    agendasData.map((ag) => (
                      <div
                        key={ag.id}
                        className={cn(
                          "p-4 rounded-2xl bg-white dark:bg-slate-800/80 border transition-all flex flex-col justify-between gap-4 shadow-xs",
                          ag.ativo
                            ? "border-blue-200 dark:border-blue-900/40"
                            : "border-slate-200 dark:border-white/10 opacity-60"
                        )}
                      >
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-bold text-slate-900 dark:text-white text-sm">
                                {ag.nome}
                              </div>
                              <div className="text-[11px] text-slate-500 font-medium">
                                {ag.papel || "Participante"}
                              </div>
                            </div>
                            <Badge
                              variant={ag.ativo ? "default" : "secondary"}
                              className={cn(
                                "text-[10px] px-2 py-0.5 font-medium",
                                ag.ativo
                                  ? "bg-blue-500/15 text-blue-700 dark:text-blue-400 border border-blue-500/20"
                                  : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400"
                              )}
                            >
                              {ag.ativo ? "Agenda Ativa" : "Pausada"}
                            </Badge>
                          </div>

                          {/* Email */}
                          <div className="flex items-center gap-2 text-xs font-mono text-slate-700 dark:text-slate-300">
                            <Mail className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                            <span className="truncate">{ag.email}</span>
                          </div>

                          {/* Telefone / WhatsApp */}
                          {ag.telefone && (
                            <div className="flex items-center gap-2 text-xs font-mono text-slate-600 dark:text-slate-400">
                              <MessageSquare className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                              <span>{formatarTelefoneExibicao(ag.telefone)}</span>
                            </div>
                          )}
                        </div>

                        {/* Rodapé do Card com Toggles */}
                        <div className="pt-3 border-t border-slate-100 dark:border-white/5 flex items-center justify-between gap-2 text-[11px]">
                          <label className="flex items-center gap-1.5 cursor-pointer text-slate-600 dark:text-slate-400 select-none">
                            <input
                              type="checkbox"
                              checked={ag.notificar_whatsapp}
                              onChange={(e) =>
                                toggleAgendaMutation.mutate({
                                  id: ag.id,
                                  campo: "notificar_whatsapp",
                                  valor: e.target.checked,
                                })
                              }
                              className="rounded text-blue-600 focus:ring-blue-500"
                            />
                            <span>Avisar no WhatsApp</span>
                          </label>

                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-slate-500 hover:text-blue-600"
                              title="Editar agenda"
                              onClick={() => abrirModalEditarAgenda(ag)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-slate-500"
                              title={ag.ativo ? "Pausar agenda" : "Ativar agenda"}
                              onClick={() =>
                                toggleAgendaMutation.mutate({
                                  id: ag.id,
                                  campo: "ativo",
                                  valor: !ag.ativo,
                                })
                              }
                            >
                              {ag.ativo ? (
                                <Pause className="h-3.5 w-3.5 text-amber-500" />
                              ) : (
                                <Play className="h-3.5 w-3.5 text-emerald-500" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-slate-400 hover:text-red-600"
                              title="Excluir agenda"
                              onClick={() => {
                                if (confirm(`Deseja remover a agenda de "${ag.nome}"?`)) {
                                  excluirAgendaMutation.mutate(ag.id);
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            ABA 3: DIRETORES AUTORIZADOS (WHATSAPP)
           ══════════════════════════════════════════════════════════════════════ */}
        {painelAba === "diretores" && (
          <div className="space-y-6">
            <Card className="rounded-2xl border-purple-200 dark:border-purple-900/50 bg-gradient-to-br from-purple-50/50 to-white dark:from-purple-950/20 dark:to-slate-900 shadow-sm">
              <CardHeader className="pb-3 border-b border-purple-100 dark:border-white/5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-purple-600 text-white shrink-0">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        Diretores Autorizados no WhatsApp
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Números autorizados a acionar a secretária diretamente por voz ou texto no WhatsApp oficial da Vexo (+55 34 9175-1267)
                      </CardDescription>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={abrirModalCriarUsuario}
                    className="bg-purple-600 hover:bg-purple-700 text-white text-xs h-8 gap-1.5 shadow-sm"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    + Adicionar Diretor
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-4 text-xs">
                {carregandoUsuarios ? (
                  <div className="p-6 text-center text-slate-400">Carregando diretores autorizados...</div>
                ) : heloisaUsuarios.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 border border-dashed rounded-xl">
                    Nenhum número cadastrado. Clique no botão acima para adicionar.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {heloisaUsuarios.map((u) => (
                      <div
                        key={u.id}
                        className={cn(
                          "p-3 rounded-xl bg-white dark:bg-slate-800/80 border transition-all flex flex-col justify-between gap-2.5",
                          u.ativo
                            ? "border-purple-200 dark:border-purple-900/40 shadow-xs"
                            : "border-slate-200 dark:border-white/10 opacity-70"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                              <Users className="h-3.5 w-3.5 text-purple-600 shrink-0" />
                              <span>{u.nome}</span>
                            </div>
                            <div className="text-[11px] text-slate-500 font-medium">
                              {u.papel} {u.client_id ? `· ${u.client_id}` : ""}
                            </div>
                          </div>
                          <Badge
                            variant={u.ativo ? "default" : "secondary"}
                            className={cn(
                              "text-[10px] px-1.5 py-0 font-medium",
                              u.ativo
                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20"
                                : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400"
                            )}
                          >
                            {u.ativo ? "Ativo" : "Pausado"}
                          </Badge>
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-white/5">
                          <a
                            href={`https://wa.me/${u.telefone}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-slate-600 dark:text-slate-300 font-mono text-xs hover:text-purple-600 transition-colors flex items-center gap-1"
                          >
                            <MessageSquare className="h-3 w-3 text-emerald-500" />
                            {formatarTelefoneExibicao(u.telefone)}
                          </a>

                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-slate-500 hover:text-slate-800 dark:hover:text-white"
                              title={u.ativo ? "Pausar autorização" : "Ativar autorização"}
                              onClick={() => toggleUsuarioAtivoMutation.mutate({ id: u.id, ativoAtual: u.ativo })}
                              disabled={toggleUsuarioAtivoMutation.isPending}
                            >
                              {u.ativo ? <Pause className="h-3.5 w-3.5 text-amber-500" /> : <Play className="h-3.5 w-3.5 text-emerald-500" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                              title="Remover autorização"
                              onClick={() => {
                                if (confirm(`Deseja desautorizar "${u.nome}" da Heloísa?`)) {
                                  excluirUsuarioMutation.mutate(u.id);
                                }
                              }}
                              disabled={excluirUsuarioMutation.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            ABA 4: PROMPTS & MODELOS GOCLAW
           ══════════════════════════════════════════════════════════════════════ */}
        {painelAba === "prompts" && (
          <div className="space-y-6">
            {/* Card Modelos & Vigia */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="rounded-2xl border-slate-200 dark:border-white/10 shadow-sm md:col-span-2">
                <CardHeader className="pb-3 border-b border-slate-100 dark:border-white/10">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base font-bold flex items-center gap-2">
                        <Terminal className="h-5 w-5 text-purple-600" />
                        Editor de Prompts das Lanes (GoClaw)
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Ajuste fino visual das instruções de cada robô da agência
                      </CardDescription>
                    </div>

                    <Button
                      onClick={() => salvarPromptMutation.mutate()}
                      disabled={salvarPromptMutation.isPending}
                      className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Save className="h-4 w-4" />
                      {salvarPromptMutation.isPending ? "Salvando..." : "Salvar Prompt"}
                    </Button>
                  </div>

                  {/* Abas das Lanes */}
                  <div className="flex gap-2 pt-4 overflow-x-auto">
                    {LANES_METADATA.map((l) => (
                      <button
                        key={l.key}
                        onClick={() => setActiveLane(l.key)}
                        className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 border whitespace-nowrap ${
                          activeLane === l.key
                            ? "bg-purple-600 text-white border-purple-600 shadow-sm"
                            : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:bg-slate-100"
                        }`}
                      >
                        <span>{l.nome}</span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${
                            activeLane === l.key ? "bg-white/20 text-white border-white/30" : ""
                          }`}
                        >
                          {l.tag}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </CardHeader>

                <CardContent className="pt-4 space-y-3">
                  <div className="text-xs text-slate-500">
                    {LANES_METADATA.find((l) => l.key === activeLane)?.descricao}
                  </div>

                  <Textarea
                    value={promptEditando[activeLane] || ""}
                    onChange={(e) =>
                      setPromptEditando((prev) => ({
                        ...prev,
                        [activeLane]: e.target.value,
                      }))
                    }
                    rows={18}
                    className="font-mono text-xs leading-relaxed rounded-xl bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-white/10"
                    placeholder="Digite o system prompt da lane..."
                  />
                </CardContent>
              </Card>

              {/* Card Modelos & Vigia */}
              <Card className="rounded-2xl border-slate-200 dark:border-white/10 shadow-sm flex flex-col justify-between">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <Cpu className="h-5 w-5 text-indigo-500" />
                    Arquitetura & Vigia
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Modelos ativos e teste de disparos
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-xs">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-white/10">
                      <span className="text-slate-500">Modelo Primário:</span>
                      <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">Gemini 3 Flash</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-white/10">
                      <span className="text-slate-500">Fallback Automático:</span>
                      <span className="font-mono text-slate-700 dark:text-slate-300">Groq GPT-OSS 120B</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-white/10">
                      <span className="text-slate-500">Transcrição STT:</span>
                      <span className="font-mono text-slate-700 dark:text-slate-300">Groq Whisper Large</span>
                    </div>
                  </div>

                  <div className="pt-2">
                    <div className="font-semibold text-slate-900 dark:text-white mb-2 flex items-center gap-1.5">
                      <Zap className="h-4 w-4 text-amber-500" />
                      Testar Vigia no WhatsApp
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => testarVigiaMutation.mutate("checkin")}
                        disabled={testarVigiaMutation.isPending}
                        className="rounded-xl text-xs"
                      >
                        <Play className="h-3 w-3 mr-1 text-emerald-500" />
                        09h (Manhã)
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => testarVigiaMutation.mutate("checkout")}
                        disabled={testarVigiaMutation.isPending}
                        className="rounded-xl text-xs"
                      >
                        <Play className="h-3 w-3 mr-1 text-purple-500" />
                        18h (Tarde)
                      </Button>
                    </div>
                  </div>

                  {logDisparo && (
                    <div className="p-2.5 rounded-xl bg-slate-900 text-slate-200 font-mono text-[11px] overflow-x-auto max-h-32">
                      ✓ Disparo: {logDisparo.resultado?.relatorio?.slice(0, 180)}...
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL DETALHES DA EXECUÇÃO
         ══════════════════════════════════════════════════════════════════════ */}
      <Dialog open={Boolean(execucaoDetalhes)} onOpenChange={(open) => !open && setExecucaoDetalhes(null)}>
        <DialogContent className="max-w-2xl rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Eye className="h-5 w-5 text-purple-600" />
              Detalhes da Execução da Heloísa
            </DialogTitle>
            <DialogDescription className="text-xs">
              Registro completo de entrada, ferramenta executada e retorno gerado.
            </DialogDescription>
          </DialogHeader>

          {execucaoDetalhes && (
            <div className="space-y-4 py-2 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200/80 dark:border-white/10">
                <div>
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">Canal</div>
                  <div className="font-bold text-slate-800 dark:text-slate-200 capitalize mt-0.5">
                    {execucaoDetalhes.canal === "whatsapp" ? "WhatsApp Oficial" : "Orbe de Voz Web"}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">Solicitante</div>
                  <div className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                    {execucaoDetalhes.solicitante_nome}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">Status</div>
                  <div className="font-bold capitalize mt-0.5 text-emerald-600">
                    {execucaoDetalhes.status}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">Duração</div>
                  <div className="font-mono text-slate-700 dark:text-slate-300 mt-0.5">
                    {execucaoDetalhes.tempo_execucao_ms}ms
                  </div>
                </div>
              </div>

              {/* Ordem Solicitada */}
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5 text-purple-600" />
                  Ordem Solicitada pelo Diretor:
                </Label>
                <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 font-mono text-xs">
                  {execucaoDetalhes.texto_entrada || "[Sem texto de entrada]"}
                </div>
              </div>

              {/* Resposta da Heloísa */}
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                  Resposta Falada / Enviada pela Heloísa:
                </Label>
                <div className="p-3 rounded-xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200/60 dark:border-purple-900/40 text-slate-800 dark:text-slate-200 text-xs leading-relaxed">
                  {execucaoDetalhes.resposta_saida || "[Sem resposta gerada]"}
                </div>
              </div>

              {/* Ferramentas e Parâmetros */}
              {execucaoDetalhes.ferramenta_executada && (
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-amber-500" />
                    Ferramenta Executada: <span className="font-mono text-purple-600">{execucaoDetalhes.ferramenta_executada}</span>
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1 font-semibold">Parâmetros Enviados:</div>
                      <pre className="p-2.5 rounded-xl bg-slate-900 text-slate-200 font-mono text-[11px] overflow-x-auto max-h-40">
                        {JSON.stringify(execucaoDetalhes.parametros || {}, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 mb-1 font-semibold">Retorno da Ferramenta:</div>
                      <pre className="p-2.5 rounded-xl bg-slate-900 text-slate-200 font-mono text-[11px] overflow-x-auto max-h-40">
                        {JSON.stringify(execucaoDetalhes.resultado || {}, null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExecucaoDetalhes(null)}
              className="text-xs rounded-xl"
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL ADICIONAR / EDITAR AGENDA (GOOGLE MEET)
         ══════════════════════════════════════════════════════════════════════ */}
      <Dialog
        open={modalAgendaAberto}
        onOpenChange={(aberto) => {
          setModalAgendaAberto(aberto);
          if (!aberto) setAgendaEmEdicao(null);
        }}
      >
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Calendar className="h-5 w-5 text-blue-600" />
              {agendaEmEdicao ? "Editar Agenda (Google Meet)" : "+ Cadastrar Agenda (Google Meet)"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {agendaEmEdicao
                ? "Atualize o e-mail e configurações de notificação desta agenda para reuniões e links do Meet."
                : "Cadastre o e-mail da agenda Google para envio automático de convites e geração de link do Meet."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Nome do Titular ou Agenda *
              </Label>
              <Input
                placeholder="Ex: Conrado Finzi, Caio Almeida, Geração Digital"
                value={formAgendaNome}
                onChange={(e) => setFormAgendaNome(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                E-mail da Agenda Google (Gmail / Workspace) *
              </Label>
              <Input
                type="email"
                placeholder="Ex: conradofinzi@gmail.com"
                value={formAgendaEmail}
                onChange={(e) => setFormAgendaEmail(e.target.value)}
                className="h-9 text-xs font-mono"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                WhatsApp com DDD para Notificações Automáticas
              </Label>
              <Input
                placeholder="Ex: 34997817660"
                value={formAgendaTelefone}
                onChange={(e) => setFormAgendaTelefone(e.target.value)}
                className="h-9 text-xs font-mono"
              />
              <span className="text-[10px] text-slate-400">
                O titular receberá uma mensagem no WhatsApp com o link do Meet assim que a Heloísa agendar uma reunião.
              </span>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Papel / Cargo
              </Label>
              <Input
                placeholder="Ex: Sócio Diretor Executivo"
                value={formAgendaPapel}
                onChange={(e) => setFormAgendaPapel(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-white/5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={formAgendaNotificar}
                  onChange={(e) => setFormAgendaNotificar(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300 text-xs">
                  Avisar imediatamente no WhatsApp ao criar reunião
                </span>
              </label>
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setModalAgendaAberto(false);
                setAgendaEmEdicao(null);
              }}
              className="text-xs rounded-xl"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => salvarAgendaMutation.mutate()}
              disabled={salvarAgendaMutation.isPending || !formAgendaNome.trim() || !formAgendaEmail.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1.5 rounded-xl"
            >
              <Save className="h-3.5 w-3.5" />
              {salvarAgendaMutation.isPending
                ? "Salvando..."
                : agendaEmEdicao
                ? "Salvar Alterações"
                : "Salvar Agenda"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL ADICIONAR DIRETOR (WHATSAPP)
         ══════════════════════════════════════════════════════════════════════ */}
      <Dialog open={modalUsuarioAberto} onOpenChange={setModalUsuarioAberto}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-600" />
              + Adicionar Diretor Autorizado
            </DialogTitle>
            <DialogDescription className="text-xs">
              Cadastre o número de WhatsApp do diretor ou gestor para autorizar comandos e áudios com a Heloísa.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Nome Completo *
              </Label>
              <Input
                placeholder="Ex: Conrado Finzi"
                value={formNome}
                onChange={(e) => setFormNome(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                WhatsApp com DDD *
              </Label>
              <Input
                placeholder="Ex: (34) 99781-7660 ou 34997817660"
                value={formTelefone}
                onChange={(e) => setFormTelefone(e.target.value)}
                className="h-9 text-xs font-mono"
              />
              <span className="text-[10px] text-slate-400">
                O número será normalizado e validado automaticamente com código do país 55.
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Cargo / Papel
                </Label>
                <Input
                  placeholder="Ex: Diretor Executivo"
                  value={formPapel}
                  onChange={(e) => setFormPapel(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Empresa / Tenant
                </Label>
                <Input
                  placeholder="Ex: geracao-digital"
                  value={formClientId}
                  onChange={(e) => setFormClientId(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setModalUsuarioAberto(false)}
              className="text-xs rounded-xl"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => salvarUsuarioMutation.mutate()}
              disabled={salvarUsuarioMutation.isPending || !formNome.trim() || !formTelefone.trim()}
              className="bg-purple-600 hover:bg-purple-700 text-white text-xs gap-1.5 rounded-xl"
            >
              <Save className="h-3.5 w-3.5" />
              {salvarUsuarioMutation.isPending ? "Salvando..." : "Salvar Diretor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

export default GeracaoDigitalGoclawConfig;
