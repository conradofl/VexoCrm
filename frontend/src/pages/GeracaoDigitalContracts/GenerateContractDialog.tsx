import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateGdContract, useUpdateGdContract, useExtractContractData, useGdContractTemplates, useCreateGdContractTemplate, useUpdateGdContractTemplate, GdContractFormData } from "@/hooks/useGdContracts";
import { useJuridicoSettings } from "@/hooks/useJuridico";
import {
  Sparkles,
  AlertTriangle,
  Building2,
  ChevronDown,
  Info,
  FileText,
  Layers,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Save,
  BookmarkPlus,
  Calendar,
  CreditCard,
  DollarSign,
  RefreshCw,
} from "lucide-react";
import {
  buildContractDados,
  ContractClauseBlock,
  toExtenseOrdinal,
  assembleContractFromBlocks,
  parseTemplateContentToClauses,
  extractPlaceholders,
  extractDynamicPlaceholders,
  formatFieldLabel,
  ContractParcela,
  FormaPagamentoParcela,
  PeriodicidadeParcela,
  generateScheduleInstallments,
  calculateScheduleTotals,
  formatBrl,
} from "@/lib/geracaoDigital/contractMerge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ContractPreview } from "./ContractPreview";
import { useToast } from "@/components/ui/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalStorage } from "@/hooks/useLocalStorage";

const CONTRACT_DEFAULTS: Record<string, any> = {
  // Contratante
  razao_social: "",
  cnpj: "",
  telefone: "",
  telefone2: "",
  email: "",
  representante: "",
  endereco: "",
  // Contratada (sobrescrita opcional por contrato)
  contratada_razao_social: "",
  contratada_cnpj: "",
  contratada_representante: "",
  contratada_endereco: "",
  contratada_telefone: "",
  contratada_email: "",
  contratada_comarca: "",
  // Objeto / entregas
  produtos: "",
  condicoes_pagamento: "",
  artes_mensais: "15",
  // Preço (estruturado)
  forma_pagamento: "permuta",
  num_parcelas: "6",
  valor_parcela: "",
  data_primeiro_venc: "",
  parcelas: [],
  // Prazo / foro / assinatura
  prazo_dias: "180",
  aviso_previo_dias: "60",
  foro_cidade: "",
  cidade_assinatura: "",
  assinatura_contratada: "",
  assinatura_contratante: "",
  espaco_assinatura: "4",
  vigencia: "90",
};

// Ignora chaves vazias para não apagar default com string em branco.
function somentePreenchidos(obj: Record<string, any> = {}): Record<string, any> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => {
      if (Array.isArray(v)) return v.length > 0;
      return v !== undefined && v !== null && String(v).trim() !== "";
    })
  );
}

interface GenerateContractDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId?: string | null;
  initialData?: Partial<GdContractFormData>;
  /** Quando presente, o diálogo entra em modo EDIÇÃO de um contrato já gerado. */
  contractId?: string | null;
  /** Dados salvos do contrato que está sendo editado. */
  initialDados?: Partial<GdContractFormData> | null;
  /** Status da proposta de origem (ex: rascunho, enviada, aceita) para aviso contextual */
  proposalStatus?: string | null;
  /** Chave isolada para contrato avulso para evitar colisão entre rascunhos */
  standaloneKey?: string | null;
}

export function GenerateContractDialog({
  open,
  onOpenChange,
  proposalId,
  initialData = {},
  contractId,
  initialDados,
  proposalStatus,
  standaloneKey,
}: GenerateContractDialogProps) {
  const { data: templates } = useGdContractTemplates();
  const { data: juridicoSettings } = useJuridicoSettings();
  const createContract = useCreateGdContract();
  const updateContract = useUpdateGdContract();
  const createTemplateMutation = useCreateGdContractTemplate();
  const updateTemplateMutation = useUpdateGdContractTemplate();
  const extractData = useExtractContractData();
  const { toast } = useToast();
  const isEdit = !!contractId;
  const [textoColado, setTextoColado] = useState("");
  const [showContratadaOverride, setShowContratadaOverride] = useState(false);

  // Estados dos Modelos e Cláusulas em Blocos
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [clausulas, setClausulas] = useState<ContractClauseBlock[]>([]);
  const [tituloPrincipal, setTituloPrincipal] = useState<string>("");
  const [fechamento, setFechamento] = useState<string>("");
  const [isSavingAsNew, setIsSavingAsNew] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const lastLoadedTemplateIdRef = React.useRef<string | null>(null);

  // Sincronização e carregamento de templates e suas cláusulas
  useEffect(() => {
    if (!open) {
      lastLoadedTemplateIdRef.current = null;
      return;
    }
    if (!templates || templates.length === 0) return;

    let tplId = selectedTemplateId;
    if (!tplId || !templates.some((t) => t.id === tplId)) {
      const defaultTpl = templates.find((t) => t.ativo !== false) || templates[0];
      tplId = defaultTpl.id;
      setSelectedTemplateId(tplId);
    }

    if (lastLoadedTemplateIdRef.current !== tplId) {
      lastLoadedTemplateIdRef.current = tplId;
      const tpl = templates.find((t) => t.id === tplId);
      if (tpl) {
        if (tpl.clausulas && Array.isArray(tpl.clausulas) && tpl.clausulas.length > 0) {
          setClausulas(tpl.clausulas);
          const parsed = parseTemplateContentToClauses(tpl.conteudo || "");
          setTituloPrincipal(parsed.tituloPrincipal);
          setFechamento(parsed.fechamento);
        } else if (tpl.conteudo) {
          const parsed = parseTemplateContentToClauses(tpl.conteudo);
          setTituloPrincipal(parsed.tituloPrincipal);
          setClausulas(parsed.clausulas);
          setFechamento(parsed.fechamento);
        }
      }
    }
  }, [open, templates, selectedTemplateId]);

  const currentTemplate = React.useMemo(() => {
    return (templates || []).find((t) => t.id === selectedTemplateId) || (templates && templates[0]) || null;
  }, [templates, selectedTemplateId]);

  // Contrato montado a partir dos blocos ativos com numeração ordinal recalculada
  const assembledContractContent = React.useMemo(() => {
    return assembleContractFromBlocks({
      tituloPrincipal,
      clausulas,
      fechamento,
    });
  }, [tituloPrincipal, clausulas, fechamento]);

  // Marcadores detectados dinamicamente que não são campos padrão do sistema
  const dynamicPlaceholders = React.useMemo(() => {
    return extractDynamicPlaceholders(clausulas);
  }, [clausulas]);

  // Mapeamento dinâmico de índice ordinal para cada cláusula ativa
  const activeIndexMap = React.useMemo(() => {
    const map = new Map<string, number>();
    let count = 0;
    for (const c of clausulas) {
      if (c && c.ativo !== false) {
        count += 1;
        map.set(c.id, count);
      }
    }
    return map;
  }, [clausulas]);


  const handleMoveClause = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= clausulas.length) return;
    const copy = [...clausulas];
    const temp = copy[targetIndex];
    copy[targetIndex] = copy[index];
    copy[index] = temp;
    setClausulas(copy);
  };

  const handleToggleClause = (id: string) => {
    setClausulas((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ativo: c.ativo === false } : c))
    );
  };

  const handleUpdateClauseTitle = (id: string, newTitle: string) => {
    setClausulas((prev) =>
      prev.map((c) => (c.id === id ? { ...c, titulo: newTitle } : c))
    );
  };

  const handleUpdateClauseContent = (id: string, newContent: string) => {
    setClausulas((prev) =>
      prev.map((c) => (c.id === id ? { ...c, conteudo: newContent } : c))
    );
  };

  const handleDeleteClause = (id: string) => {
    setClausulas((prev) => prev.filter((c) => c.id !== id));
  };

  const handleAddClause = () => {
    const newId = `custom_${Date.now()}`;
    const newBlock: ContractClauseBlock = {
      id: newId,
      titulo: "Nova Cláusula",
      conteudo: "O CONTRATANTE e a CONTRATADA ajustam que...",
      ativo: true,
    };
    setClausulas((prev) => [...prev, newBlock]);
    toast({ title: "Nova cláusula adicionada", description: "Edite o título e o texto da cláusula." });
  };

  const handleUpdateCurrentTemplate = () => {
    if (!selectedTemplateId) return;
    const tplName = currentTemplate?.nome || "Modelo";
    updateTemplateMutation.mutate(
      {
        id: selectedTemplateId,
        data: {
          clausulas,
          conteudo: assembledContractContent,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Modelo atualizado", description: `O modelo "${tplName}" foi salvo com as cláusulas atuais.` });
        },
        onError: (err: any) => {
          toast({ title: "Erro ao atualizar modelo", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  const handleSaveAsNewTemplate = () => {
    if (!newTemplateName.trim()) {
      toast({ title: "Nome obrigatório", description: "Informe o nome do novo modelo de contrato.", variant: "destructive" });
      return;
    }
    createTemplateMutation.mutate(
      {
        nome: newTemplateName.trim(),
        clausulas,
        conteudo: assembledContractContent,
        ativo: true,
      },
      {
        onSuccess: (newTpl) => {
          toast({ title: "Modelo criado com sucesso", description: `Modelo "${newTpl.nome}" criado e selecionado.` });
          setIsSavingAsNew(false);
          setNewTemplateName("");
          setSelectedTemplateId(newTpl.id);
        },
        onError: (err: any) => {
          toast({ title: "Erro ao criar modelo", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  // Isolamento estrito de chave para nunca haver colisão de rascunhos:
  // - Edição: isolado por contractId
  // - Proposta: isolado por proposalId
  // - Avulso: isolado por chave de sessão do contrato avulso
  const storageKey = contractId
    ? `gd_contract_edit_${contractId}`
    : proposalId
    ? `gd_contract_form_${proposalId}`
    : `gd_contract_form_standalone_${standaloneKey || "draft"}`;

  const [formData, setFormData] = useLocalStorage<GdContractFormData>(
    storageKey,
    // Defaults + tudo que veio da proposta aceita (escopo, parcelas, valores,
    // período, carência). O spread precisa vir por último: antes só 3 campos
    // eram aproveitados e o resto ficava no default.
    { ...CONTRACT_DEFAULTS, ...somentePreenchidos(initialData) } as GdContractFormData
  );

  // Preenche dados padrão da Contratada do tenant caso ainda não estejam no formulário
  useEffect(() => {
    if (open && !contractId && juridicoSettings?.contratada) {
      const c = juridicoSettings.contratada;
      setFormData((prev) => ({
        ...prev,
        contratada_razao_social: prev.contratada_razao_social || c.razao_social || "",
        contratada_cnpj: prev.contratada_cnpj || c.cnpj || "",
        contratada_representante: prev.contratada_representante || c.representante || "",
        contratada_endereco: prev.contratada_endereco || c.endereco || "",
        contratada_telefone: prev.contratada_telefone || c.telefone || "",
        contratada_email: prev.contratada_email || c.email || "",
        contratada_comarca: prev.contratada_comarca || c.comarca || "",
        foro_cidade: prev.foro_cidade || c.comarca || "",
        cidade_assinatura: prev.cidade_assinatura || c.comarca || "",
        assinatura_contratada: prev.assinatura_contratada || c.assinatura || "",
      }));
    }
  }, [open, contractId, juridicoSettings]);

  // Modo edição: ao abrir, carrega os dados salvos do contrato (fonte da verdade,
  // não o rascunho do localStorage).
  useEffect(() => {
    if (open && contractId && initialDados) {
      setFormData((prev) => ({ ...prev, ...initialDados }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contractId]);

  // Estados para o Gerador de Cronograma de Pagamento (Item 11)
  const [schedulePeriodicidade, setSchedulePeriodicidade] = useState<PeriodicidadeParcela>("mensal");
  const [scheduleTipoPadrao, setScheduleTipoPadrao] = useState<FormaPagamentoParcela>("dinheiro");
  const [scheduleValorTotal, setScheduleValorTotal] = useState<string>("");

  // Inicialização inteligente da grade de parcelas se ainda não houver array estruturado
  useEffect(() => {
    if (open && (!formData.parcelas || formData.parcelas.length === 0)) {
      const n = Number(formData.num_parcelas) || 0;
      const v = Number(formData.valor_parcela) || 0;
      if (n > 0 && v > 0) {
        const generated = generateScheduleInstallments({
          numParcelas: n,
          valorPorParcela: v,
          dataPrimeiroVenc: formData.data_primeiro_venc || "",
          periodicidade: schedulePeriodicidade,
          tipoPadrao: (formData.forma_pagamento as FormaPagamentoParcela) || "dinheiro",
        });
        setFormData((prev) => ({ ...prev, parcelas: generated }));
      }
    }
  }, [open, formData.num_parcelas, formData.valor_parcela, formData.data_primeiro_venc]);

  // Totalizadores em tempo real
  const scheduleTotals = React.useMemo(() => {
    return calculateScheduleTotals(formData.parcelas || []);
  }, [formData.parcelas]);

  const handleGenerateSchedule = () => {
    const n = Number(formData.num_parcelas) || 1;
    const vParcela = Number(formData.valor_parcela) || 0;
    const vTotal = Number(scheduleValorTotal) || 0;
    const dt = formData.data_primeiro_venc || "";

    if (n <= 0) {
      toast({ title: "Nº de parcelas inválido", description: "Informe ao menos 1 parcela.", variant: "destructive" });
      return;
    }

    const generated = generateScheduleInstallments({
      numParcelas: n,
      valorTotal: vTotal > 0 ? vTotal : undefined,
      valorPorParcela: vParcela > 0 ? vParcela : undefined,
      dataPrimeiroVenc: dt,
      periodicidade: schedulePeriodicidade,
      tipoPadrao: scheduleTipoPadrao,
    });

    setFormData((prev) => ({
      ...prev,
      parcelas: generated,
      num_parcelas: String(generated.length),
      valor_parcela: String(generated[0]?.valor || prev.valor_parcela),
    }));

    toast({
      title: "Grade de parcelas gerada",
      description: `${generated.length} parcela(s) gerada(s) com periodicidade ${schedulePeriodicidade}.`,
    });
  };

  const handleUpdateParcela = (id: string, field: keyof ContractParcela, value: any) => {
    setFormData((prev) => {
      const current = prev.parcelas || [];
      const updated = current.map((p) => {
        if (p.id !== id) return p;
        const item = { ...p, [field]: value };
        if (field === "valor") {
          item.valor = Math.max(0, Number(value) || 0);
        }
        return item;
      });
      return { ...prev, parcelas: updated };
    });
  };

  const handleRemoveParcela = (id: string) => {
    setFormData((prev) => {
      const current = prev.parcelas || [];
      const filtered = current.filter((p) => p.id !== id);
      const renumbered = filtered.map((p, idx) => ({ ...p, numero: idx + 1 }));
      return {
        ...prev,
        parcelas: renumbered,
        num_parcelas: String(renumbered.length),
      };
    });
  };

  const handleAddParcelaAvulsa = () => {
    setFormData((prev) => {
      const current = prev.parcelas || [];
      const last = current[current.length - 1];
      let nextDate = "";
      if (last && last.data && last.data !== "a combinar") {
        const d = new Date(`${last.data}T12:00:00`);
        if (!isNaN(d.getTime())) {
          if (schedulePeriodicidade === "semanal") d.setDate(d.getDate() + 7);
          else if (schedulePeriodicidade === "quinzenal") d.setDate(d.getDate() + 15);
          else d.setMonth(d.getMonth() + 1);
          nextDate = d.toISOString().slice(0, 10);
        }
      }
      const newP: ContractParcela = {
        id: `parcela-${current.length + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        numero: current.length + 1,
        data: nextDate || prev.data_primeiro_venc || "",
        valor: last ? last.valor : Number(prev.valor_parcela) || 0,
        tipo: last ? last.tipo : scheduleTipoPadrao,
        observacao: "",
      };
      const updated = [...current, newP];
      return {
        ...prev,
        parcelas: updated,
        num_parcelas: String(updated.length),
      };
    });
  };

  // Puxa (de novo) tudo que já foi negociado na proposta: escopo, forma de
  // pagamento, parcelas, valor, 1º vencimento e prazo. Útil quando existe um
  // rascunho antigo no navegador, criado antes destes campos existirem.
  const handlePuxarDaProposta = () => {
    const vindos = somentePreenchidos(initialData);
    if (Object.keys(vindos).length === 0) {
      toast({ title: "Nada para puxar", description: "Esta proposta não tem dados aproveitáveis.", variant: "destructive" });
      return;
    }
    const n = Number(vindos.num_parcelas) || Number(formData.num_parcelas) || 1;
    const v = Number(vindos.valor_parcela) || Number(formData.valor_parcela) || 0;
    const dt = vindos.data_primeiro_venc || formData.data_primeiro_venc || "";
    const fp = (vindos.forma_pagamento as FormaPagamentoParcela) || "dinheiro";

    let generatedParcelas = vindos.parcelas;
    if (!generatedParcelas || generatedParcelas.length === 0) {
      if (n > 0 && v > 0) {
        generatedParcelas = generateScheduleInstallments({
          numParcelas: n,
          valorPorParcela: v,
          dataPrimeiroVenc: dt,
          tipoPadrao: fp,
        });
      }
    }

    setFormData((prev) => ({
      ...prev,
      ...vindos,
      ...(generatedParcelas ? { parcelas: generatedParcelas } : {}),
    }));
    toast({ title: "Dados da proposta aplicados", description: `${Object.keys(vindos).length} campo(s) preenchido(s) a partir da proposta.` });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleGenerate = () => {
    if (!formData.razao_social || !formData.cnpj || !formData.representante) {
      toast({
        title: "Campos obrigatórios",
        description: "Preencha a Razão Social, CNPJ e o Representante.",
        variant: "destructive"
      });
      return;
    }

    const templateId = selectedTemplateId || (templates && templates.length > 0 ? templates[0].id : undefined);

    // Modo edição: atualiza o contrato existente (o PDF é remontado on the fly,
    // então a correção aparece no documento na hora).
    if (contractId) {
      updateContract.mutate(
        {
          id: contractId,
          data: {
            dados: buildContractDados(formData) as GdContractFormData,
            template_id: templateId || null,
          },
        },
        {
          onSuccess: () => {
            toast({ title: "Contrato atualizado", description: "As alterações foram salvas." });
            onOpenChange(false);
          },
          onError: (err: any) => toast({ title: "Erro ao atualizar", description: err.message, variant: "destructive" }),
        }
      );
      return;
    }

    createContract.mutate({
      proposal_id: proposalId || null,
      template_id: templateId,
      // Salva já com os campos derivados (forma por extenso + cronograma).
      dados: buildContractDados(formData) as GdContractFormData
    }, {
      onSuccess: () => {
        toast({
          title: "Contrato gerado",
          description: "O contrato foi gerado com sucesso.",
        });
        localStorage.removeItem(storageKey);
        onOpenChange(false);
      },
      onError: (err: any) => {
        toast({
          title: "Erro ao gerar",
          description: err.message,
          variant: "destructive"
        });
      }
    });
  };

  // Cola o texto cru do cliente (WhatsApp/e-mail/cartão CNPJ) e a IA preenche os
  // campos. Só sobrescreve o que veio preenchido — nada é salvo sem revisão.
  const handleExtract = () => {
    const textRaw = textoColado;
    const fallbackExtracted: Record<string, string> = {};

    const cnpjMatch = textRaw.match(/cnpj[\s:]*([0-9.\-\/]{8,20})/i) || textRaw.match(/([0-9]{2}[\.\s]?[0-9]{3}[\.\s]?[0-9]{3}[\/\s]?[0-9]{4}[\.\-\s]?[0-9]{2})/);
    if (cnpjMatch) fallbackExtracted.cnpj = cnpjMatch[1].trim();

    const tel1Match = textRaw.match(/telefone[\s:1]*([0-9\s.()\-\+]{8,20})/i) || textRaw.match(/tel[\s:]*([0-9\s.()\-\+]{8,20})/i) || textRaw.match(/celular[\s:]*([0-9\s.()\-\+]{8,20})/i) || textRaw.match(/([0-9]{2}\s?[0-9]{4,5}[\-\s]?[0-9]{4})/);
    if (tel1Match) fallbackExtracted.telefone = tel1Match[1].trim();

    const tel2Match = textRaw.match(/telefone\s*2[\s:]*([0-9\s.()\-\+]{8,20})/i) || textRaw.match(/tel\s*2[\s:]*([0-9\s.()\-\+]{8,20})/i);
    if (tel2Match) fallbackExtracted.telefone2 = tel2Match[1].trim();

    const repMatch = textRaw.match(/representante[\s:]*([^\n\r,]+)/i) || textRaw.match(/responsavel[\s:]*([^\n\r,]+)/i);
    if (repMatch) fallbackExtracted.representante = repMatch[1].trim();

    const emailMatch = textRaw.match(/email[\s:]*([^\s\n\r]+@[^\s\n\r]+)/i) || textRaw.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) fallbackExtracted.email = emailMatch[1].trim();

    extractData.mutate(textoColado, {
      onSuccess: (extraido) => {
        const merged = { ...fallbackExtracted, ...extraido };
        if (!merged.cnpj && fallbackExtracted.cnpj) merged.cnpj = fallbackExtracted.cnpj;
        if (!merged.telefone && fallbackExtracted.telefone) merged.telefone = fallbackExtracted.telefone;
        if (!merged.telefone2 && fallbackExtracted.telefone2) merged.telefone2 = fallbackExtracted.telefone2;

        const preenchidos = Object.entries(merged).filter(([, v]) => v && String(v).trim() !== "");
        if (preenchidos.length === 0) {
          toast({ title: "Nada encontrado", description: "A IA não identificou dados no texto colado.", variant: "destructive" });
          return;
        }
        setFormData((prev) => ({ ...prev, ...Object.fromEntries(preenchidos) }));
        toast({ title: "Campos preenchidos", description: `${preenchidos.length} campo(s) preenchido(s) pela IA. Revise antes de gerar.` });
      },
      onError: (err: any) => {
        const preenchidos = Object.entries(fallbackExtracted).filter(([, v]) => v && String(v).trim() !== "");
        if (preenchidos.length > 0) {
          setFormData((prev) => ({ ...prev, ...fallbackExtracted }));
          toast({ title: "Campos preenchidos (Local)", description: `${preenchidos.length} campo(s) preenchido(s) do texto. Revise antes de gerar.` });
        } else {
          toast({ title: "Erro na extração", description: err.message, variant: "destructive" });
        }
      },
    });
  };

  const template = templates && templates.length > 0 ? templates[0] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Contrato" : "Gerar Contrato Jurídico"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Corrija os dados do contrato já gerado. O PDF é remontado com as alterações."
              : "Preencha os dados do cliente. O texto da cláusula será montado mesclando essas variáveis no template."}
          </DialogDescription>
        </DialogHeader>

        {!Boolean(juridicoSettings?.contratada?.razao_social || juridicoSettings?.contratada?.cnpj) && (
          <div className="p-3 my-2 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>Atenção:</strong> Os dados da Contratada ainda não foram configurados neste tenant. Acesse a aba <em>Contratos &gt; Configurações da Contratada e Jurídico</em> para cadastrá-los e ter preenchimento automático.
            </span>
          </div>
        )}

        {proposalId && proposalStatus && proposalStatus !== "aceita" && (
          <div className="p-3 my-2 rounded-md bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/50 text-blue-800 dark:text-blue-300 text-xs flex items-center gap-2">
            <Info className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <span>
              Esta proposta está com status <strong>"{proposalStatus}"</strong>. O contrato será gerado com os dados atuais dela.
            </span>
          </div>
        )}

        {!proposalId && !isEdit && (
          <div className="p-3 my-2 rounded-md bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/50 text-purple-800 dark:text-purple-300 text-xs flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-purple-600 dark:text-purple-400" />
            <span>
              <strong>Contrato Avulso:</strong> Este contrato está sendo gerado do zero, sem vínculo com proposta prévia.
            </span>
          </div>
        )}

        {/* Seletor e Gestão de Modelos de Contrato */}
        <div className="bg-slate-50 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200 dark:border-white/10 space-y-2.5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full sm:w-auto">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 shrink-0">
                <Layers className="h-4 w-4 text-purple-650 dark:text-purple-400" />
                <span>Modelo de Contrato:</span>
              </div>
              <div className="w-full sm:w-[260px]">
                <Select value={selectedTemplateId} onValueChange={(val) => setSelectedTemplateId(val)}>
                  <SelectTrigger className="h-8 text-xs bg-white dark:bg-slate-950">
                    <SelectValue placeholder="Selecione um modelo..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(templates || []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.nome} {!t.ativo ? "(Inativo)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleUpdateCurrentTemplate}
                disabled={!selectedTemplateId || updateTemplateMutation.isPending}
                className="h-8 text-xs gap-1.5 text-slate-700 dark:text-slate-200"
                title="Salva as alterações de cláusulas no modelo selecionado"
              >
                <Save className="h-3.5 w-3.5 text-purple-650" />
                <span>{updateTemplateMutation.isPending ? "Salvando..." : "Atualizar Modelo"}</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setIsSavingAsNew((v) => !v)}
                className="h-8 text-xs gap-1.5 text-purple-750 dark:text-purple-300 border-purple-200 dark:border-purple-800 hover:bg-purple-50 dark:hover:bg-purple-950/40"
              >
                <BookmarkPlus className="h-3.5 w-3.5 text-purple-650" />
                <span>Salvar como Novo</span>
              </Button>
            </div>
          </div>

          {isSavingAsNew && (
            <div className="bg-purple-50/70 dark:bg-purple-950/30 p-2.5 rounded-lg border border-purple-200 dark:border-purple-800/60 flex items-center gap-2">
              <Input
                placeholder="Nome do novo modelo (ex: Modelo Energia Solar / Odonto)..."
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                className="h-8 text-xs bg-white dark:bg-slate-950"
                autoFocus
              />
              <Button
                size="sm"
                onClick={handleSaveAsNewTemplate}
                disabled={createTemplateMutation.isPending || !newTemplateName.trim()}
                className="h-8 text-xs bg-purple-650 hover:bg-purple-700 text-white shrink-0"
              >
                {createTemplateMutation.isPending ? "Criando..." : "Confirmar e Salvar"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setIsSavingAsNew(false); setNewTemplateName(""); }}
                className="h-8 text-xs shrink-0"
              >
                Cancelar
              </Button>
            </div>
          )}
        </div>

        <Tabs defaultValue="form" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="form">1. Dados / Variáveis</TabsTrigger>
            <TabsTrigger value="clausulas" className="flex items-center gap-1.5">
              <span>2. Cláusulas</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-purple-100 dark:bg-purple-900/60 text-purple-800 dark:text-purple-200 font-bold">
                {clausulas.filter((c) => c.ativo !== false).length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="preview">3. Preview do Contrato</TabsTrigger>
          </TabsList>

          <TabsContent value="form" className="space-y-4">
            {/* Dados já negociados na proposta */}
            {!isEdit && proposalId && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
                <div className="min-w-0">
                  <span className="text-xs font-bold text-indigo-900 block">Dados da proposta</span>
                  <span className="text-[10px] text-indigo-700/80">
                    Escopo, forma de pagamento, parcelas, valor, 1º vencimento e prazo.
                  </span>
                </div>
                <Button size="sm" variant="outline" onClick={handlePuxarDaProposta} className="h-8 border-indigo-300 text-indigo-800 hover:bg-indigo-100 shrink-0">
                  Puxar da proposta
                </Button>
              </div>
            )}

            {/* Preenchimento assistido por IA — cole o que o cliente mandou */}
            <div className="rounded-xl border border-purple-200 bg-purple-50/60 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-xs font-bold text-purple-800">
                  Preenchimento automático — cole os dados que o cliente enviou
                </Label>
                <Button
                  size="sm"
                  onClick={handleExtract}
                  disabled={extractData.isPending || textoColado.trim().length < 10}
                  className="bg-purple-650 hover:bg-purple-700 text-white h-8 gap-1.5"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {extractData.isPending ? "Lendo..." : "Preencher com IA"}
                </Button>
              </div>
              <Textarea
                value={textoColado}
                onChange={(e) => setTextoColado(e.target.value)}
                rows={3}
                placeholder="Cole aqui a mensagem do WhatsApp / e-mail / cartão CNPJ do cliente. A IA identifica razão social, CNPJ, representante, telefones, e-mail e endereço."
                className="text-xs bg-white"
              />
              <p className="text-[10px] text-purple-700/70">
                A IA só preenche os campos abaixo — nada é salvo sem a sua revisão.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Razão Social *</Label>
                <Input name="razao_social" value={formData.razao_social} onChange={handleChange} />
              </div>
              <div className="space-y-2">
                <Label>CNPJ *</Label>
                <Input name="cnpj" value={formData.cnpj} onChange={handleChange} />
              </div>
              <div className="space-y-2">
                <Label>Representante *</Label>
                <Input name="representante" value={formData.representante} onChange={handleChange} />
              </div>
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input name="telefone" value={formData.telefone} onChange={handleChange} />
              </div>
              <div className="space-y-2">
                <Label>Telefone 2 (opcional)</Label>
                <Input name="telefone2" value={formData.telefone2 || ""} onChange={handleChange} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input name="email" value={formData.email} onChange={handleChange} type="email" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Endereço Completo</Label>
                <Input name="endereco" value={formData.endereco} onChange={handleChange} placeholder="Av. ..., nº, bairro – Cidade/UF" />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>Produtos/Serviços (Objeto — Cláusula 2ª)</Label>
                <Textarea
                  name="produtos"
                  value={formData.produtos}
                  onChange={handleChange}
                  rows={4}
                  className="font-mono text-xs"
                />
              </div>

              {/* Entregas (Cláusula 4ª — Obrigações) */}
              <div className="space-y-2">
                <Label>Artes por mês (Cláusula 4ª)</Label>
                <Input name="artes_mensais" value={formData.artes_mensais || ""} onChange={handleChange} type="number" placeholder="Ex: 15" />
              </div>

              {/* Seção de Preço e Cronograma de Pagamento (Item 11) */}
              <div className="md:col-span-2 border-t border-slate-200 dark:border-white/10 pt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CreditCard className="h-4 w-4 text-purple-650 dark:text-purple-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-purple-650 dark:text-purple-400">
                      Preço e Cronograma de Pagamento
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {(formData.parcelas || []).length} parcela(s) configurada(s)
                  </span>
                </div>

                {/* Painel de Projeção / Geração Rápida de Parcelas */}
                <div className="p-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <RefreshCw className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                      Gerador Rápido de Parcelas
                    </span>
                    <span className="text-[11px] text-muted-foreground">Projete a grade com intervalos regulares</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                    <div className="space-y-1">
                      <Label className="text-[11px]">Periodicidade</Label>
                      <select
                        value={schedulePeriodicidade}
                        onChange={(e) => setSchedulePeriodicidade(e.target.value as PeriodicidadeParcela)}
                        className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-md px-2.5 h-8 text-xs text-slate-800 dark:text-slate-100"
                      >
                        <option value="mensal">Mensal (30 dias)</option>
                        <option value="quinzenal">Quinzenal (15 dias)</option>
                        <option value="semanal">Semanal (7 dias)</option>
                        <option value="livre">Datas Livres / Avulsas</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-[11px]">Nº de Parcelas</Label>
                      <Input
                        name="num_parcelas"
                        type="number"
                        min="1"
                        value={formData.num_parcelas || ""}
                        onChange={handleChange}
                        className="h-8 text-xs"
                        placeholder="Ex: 4"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-[11px]">Valor Parcela (R$)</Label>
                      <Input
                        name="valor_parcela"
                        type="number"
                        step="0.01"
                        value={formData.valor_parcela || ""}
                        onChange={handleChange}
                        className="h-8 text-xs"
                        placeholder="Ex: 1500"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-[11px]">Ou Valor Total (R$)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={scheduleValorTotal}
                        onChange={(e) => setScheduleValorTotal(e.target.value)}
                        className="h-8 text-xs"
                        placeholder="Ex: 6000"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-[11px]">1º Vencimento</Label>
                      <Input
                        name="data_primeiro_venc"
                        type="date"
                        value={formData.data_primeiro_venc || ""}
                        onChange={handleChange}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200/60 dark:border-white/5">
                    <div className="flex items-center gap-2">
                      <Label className="text-[11px] whitespace-nowrap">Meio Padrão:</Label>
                      <select
                        value={scheduleTipoPadrao}
                        onChange={(e) => setScheduleTipoPadrao(e.target.value as FormaPagamentoParcela)}
                        className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-md px-2 h-7 text-xs text-slate-800 dark:text-slate-100"
                      >
                        <option value="dinheiro">Dinheiro</option>
                        <option value="pix">PIX</option>
                        <option value="boleto">Boleto</option>
                        <option value="cartao">Cartão</option>
                        <option value="permuta">Permuta</option>
                        <option value="misto">Misto</option>
                      </select>
                    </div>

                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleGenerateSchedule}
                      className="h-7 text-xs gap-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 dark:hover:bg-purple-900/50 border border-purple-200 dark:border-purple-800"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Gerar / Recalcular Grade
                    </Button>
                  </div>
                </div>

                {/* Grade Interativa de Parcelas (Tabela Editável) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Grade de Parcelas & Vencimentos
                    </Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAddParcelaAvulsa}
                      className="h-7 text-xs gap-1 border-dashed"
                    >
                      <Plus className="h-3 w-3" />
                      Adicionar Parcela Avulsa
                    </Button>
                  </div>

                  {(!formData.parcelas || formData.parcelas.length === 0) ? (
                    <div className="text-center py-6 border border-dashed rounded-lg text-muted-foreground text-xs">
                      Nenhuma parcela configurada. Clique em <b>"Gerar / Recalcular Grade"</b> acima ou <b>"Adicionar Parcela Avulsa"</b>.
                    </div>
                  ) : (
                    <div className="border border-slate-200 dark:border-white/10 rounded-lg overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 dark:bg-white/5 border-b border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400">
                          <tr>
                            <th className="py-2 px-2 text-left w-10">#</th>
                            <th className="py-2 px-2 text-left w-36">Vencimento</th>
                            <th className="py-2 px-2 text-left w-32">Valor (R$)</th>
                            <th className="py-2 px-2 text-left w-36">Meio / Tipo</th>
                            <th className="py-2 px-2 text-left">Observação</th>
                            <th className="py-2 px-2 text-center w-12">Ação</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                          {formData.parcelas.map((parcela, idx) => (
                            <tr key={parcela.id || `p-${idx}`} className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02]">
                              <td className="py-1.5 px-2 font-medium text-slate-500 whitespace-nowrap">
                                {idx + 1}ª
                              </td>
                              <td className="py-1.5 px-2">
                                <Input
                                  type="date"
                                  value={parcela.data || ""}
                                  onChange={(e) => handleUpdateParcela(parcela.id, "data", e.target.value)}
                                  className="h-7 text-xs"
                                />
                              </td>
                              <td className="py-1.5 px-2">
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={parcela.valor !== undefined ? parcela.valor : ""}
                                  onChange={(e) => handleUpdateParcela(parcela.id, "valor", e.target.value)}
                                  className="h-7 text-xs font-mono"
                                />
                              </td>
                              <td className="py-1.5 px-2">
                                <select
                                  value={parcela.tipo || "dinheiro"}
                                  onChange={(e) => handleUpdateParcela(parcela.id, "tipo", e.target.value as FormaPagamentoParcela)}
                                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-md px-2 h-7 text-xs text-slate-800 dark:text-slate-100"
                                >
                                  <option value="dinheiro">Dinheiro</option>
                                  <option value="pix">PIX</option>
                                  <option value="boleto">Boleto</option>
                                  <option value="cartao">Cartão</option>
                                  <option value="permuta">Permuta</option>
                                  <option value="misto">Misto</option>
                                </select>
                              </td>
                              <td className="py-1.5 px-2">
                                <Input
                                  type="text"
                                  value={parcela.observacao || ""}
                                  placeholder="Ex: Sinal na assinatura, Entrega da 1ª remessa..."
                                  onChange={(e) => handleUpdateParcela(parcela.id, "observacao", e.target.value)}
                                  className="h-7 text-xs"
                                />
                              </td>
                              <td className="py-1.5 px-2 text-center">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRemoveParcela(parcela.id)}
                                  className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                                  title="Remover parcela"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Cards de Totais do Cronograma (Cálculo Reativo em Tempo Real) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                  <div className="p-2.5 rounded-lg border border-purple-200 dark:border-purple-800/60 bg-purple-50/60 dark:bg-purple-950/30">
                    <div className="text-[11px] font-medium text-purple-700 dark:text-purple-300">Total do Contrato</div>
                    <div className="text-base font-bold font-mono text-purple-900 dark:text-purple-100">
                      {formatBrl(scheduleTotals.totalGeral)}
                    </div>
                    <div className="text-[10px] text-purple-600/80 dark:text-purple-400/80">
                      {scheduleTotals.numParcelas} parcela(s)
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/60 dark:bg-emerald-950/30">
                    <div className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">Em Moeda Corrente</div>
                    <div className="text-base font-bold font-mono text-emerald-900 dark:text-emerald-100">
                      {formatBrl(scheduleTotals.totalDinheiro)}
                    </div>
                    <div className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80">
                      PIX, Dinheiro, Boleto ou Cartão
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-950/30">
                    <div className="text-[11px] font-medium text-amber-700 dark:text-amber-300">Em Permuta de Serviços</div>
                    <div className="text-base font-bold font-mono text-amber-900 dark:text-amber-100">
                      {formatBrl(scheduleTotals.totalPermuta)}
                    </div>
                    <div className="text-[10px] text-amber-600/80 dark:text-amber-400/80">
                      Troca / contrapartida de produtos/serviços
                    </div>
                  </div>
                </div>
              </div>

              {/* Dados da Contratada (neste contrato) */}
              <div className="md:col-span-2 border-t border-slate-200 dark:border-white/10 pt-3">
                <div
                  className="flex items-center justify-between cursor-pointer py-1 select-none"
                  onClick={() => setShowContratadaOverride((v) => !v)}
                >
                  <div className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-purple-650 dark:text-purple-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-purple-650 dark:text-purple-400">
                      Dados da Contratada ({formData.contratada_razao_social || juridicoSettings?.contratada?.razao_social || "Padrão do Sistema"})
                    </span>
                  </div>
                  <span className="text-[11px] text-purple-650 dark:text-purple-400 hover:underline flex items-center gap-1 font-medium">
                    {showContratadaOverride ? "Ocultar" : "Personalizar para este contrato"}
                    <ChevronDown className={`h-3 w-3 transition-transform ${showContratadaOverride ? "rotate-180" : ""}`} />
                  </span>
                </div>
              </div>

              {showContratadaOverride && (
                <>
                  <div className="space-y-2">
                    <Label>Razão Social da Contratada</Label>
                    <Input
                      name="contratada_razao_social"
                      value={formData.contratada_razao_social || ""}
                      onChange={handleChange}
                      placeholder={juridicoSettings?.contratada?.razao_social || "Razão Social da Contratada"}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>CNPJ da Contratada</Label>
                    <Input
                      name="contratada_cnpj"
                      value={formData.contratada_cnpj || ""}
                      onChange={handleChange}
                      placeholder={juridicoSettings?.contratada?.cnpj || "CNPJ"}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Representante da Contratada</Label>
                    <Input
                      name="contratada_representante"
                      value={formData.contratada_representante || ""}
                      onChange={handleChange}
                      placeholder={juridicoSettings?.contratada?.representante || "Representante"}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Comarca do Foro da Contratada</Label>
                    <Input
                      name="contratada_comarca"
                      value={formData.contratada_comarca || ""}
                      onChange={handleChange}
                      placeholder={juridicoSettings?.contratada?.comarca || "Ex: Uberlândia-MG"}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Endereço da Contratada</Label>
                    <Input
                      name="contratada_endereco"
                      value={formData.contratada_endereco || ""}
                      onChange={handleChange}
                      placeholder={juridicoSettings?.contratada?.endereco || "Endereço completo"}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Telefone da Contratada</Label>
                    <Input
                      name="contratada_telefone"
                      value={formData.contratada_telefone || ""}
                      onChange={handleChange}
                      placeholder={juridicoSettings?.contratada?.telefone || "Telefone"}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>E-mail da Contratada</Label>
                    <Input
                      name="contratada_email"
                      value={formData.contratada_email || ""}
                      onChange={handleChange}
                      placeholder={juridicoSettings?.contratada?.email || "E-mail comercial"}
                    />
                  </div>
                </>
              )}

              {/* Cláusula 5ª/6ª — Prazo e Foro */}
              <div className="md:col-span-2 border-t border-slate-200 dark:border-white/10 pt-3">
                <span className="text-xs font-bold uppercase tracking-wider text-purple-650 dark:text-purple-400">Prazo e Foro (Cláusulas 6ª e 7ª)</span>
              </div>
              <div className="space-y-2">
                <Label>Prazo do contrato (dias)</Label>
                <Input name="prazo_dias" value={formData.prazo_dias || ""} onChange={handleChange} type="number" placeholder="Ex: 180" />
              </div>
              <div className="space-y-2">
                <Label>Aviso prévio de rescisão (dias)</Label>
                <Input name="aviso_previo_dias" value={formData.aviso_previo_dias || ""} onChange={handleChange} type="number" placeholder="Ex: 60" />
              </div>
              <div className="space-y-2">
                <Label>Foro (Comarca)</Label>
                <Input
                  name="foro_cidade"
                  value={formData.foro_cidade || ""}
                  onChange={handleChange}
                  placeholder={formData.contratada_comarca || juridicoSettings?.contratada?.comarca || "Ex: Uberlândia-MG"}
                />
              </div>
              <div className="space-y-2">
                <Label>Cidade da assinatura</Label>
                <Input
                  name="cidade_assinatura"
                  value={formData.cidade_assinatura || ""}
                  onChange={handleChange}
                  placeholder={formData.contratada_comarca || juridicoSettings?.contratada?.comarca || "Ex: Uberlândia-MG"}
                />
              </div>

              {/* Assinaturas */}
              <div className="md:col-span-2 border-t border-slate-200 dark:border-white/10 pt-3">
                <span className="text-xs font-bold uppercase tracking-wider text-purple-650 dark:text-purple-400">Assinaturas do Contrato</span>
              </div>
              <div className="space-y-2">
                <Label>Nome da Contratada (na assinatura)</Label>
                <Input
                  name="assinatura_contratada"
                  value={formData.assinatura_contratada ?? ""}
                  onChange={handleChange}
                  placeholder={formData.contratada_razao_social || juridicoSettings?.contratada?.assinatura || "Nome da Contratada"}
                />
              </div>
              <div className="space-y-2">
                <Label>Nome da Contratante (na assinatura)</Label>
                <Input
                  name="assinatura_contratante"
                  value={formData.assinatura_contratante ?? ""}
                  onChange={handleChange}
                  placeholder={formData.razao_social || "Razão Social da Contratante"}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Espaço entre assinaturas (para assinatura digital)</Label>
                <select
                  name="espaco_assinatura"
                  value={formData.espaco_assinatura || "4"}
                  onChange={handleChange}
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-md px-3 h-10 text-sm text-slate-800 dark:text-slate-100"
                >
                  <option value="2">Compacto (2 linhas de respiro)</option>
                  <option value="4">Padrão (4 linhas - ideal para assinatura digital)</option>
                  <option value="6">Amplo (6 linhas - ZapSign / ClickSign / DocuSign)</option>
                  <option value="8">Extra Amplo (8 linhas - carimbos grandes com QR Code)</option>
                </select>
              </div>

              {/* Variáveis Dinâmicas Específicas do Modelo */}
              {dynamicPlaceholders.length > 0 && (
                <div className="md:col-span-2 border-t border-purple-200 dark:border-white/10 pt-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-purple-650 dark:text-purple-400">
                      Variáveis Específicas do Modelo ({dynamicPlaceholders.length})
                    </span>
                    <span className="text-[10px] bg-purple-100 text-purple-750 dark:bg-purple-950/60 dark:text-purple-300 px-2 py-0.5 rounded-full font-medium">
                      Campos Dinâmicos
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
                    Estes campos foram detectados automaticamente a partir dos marcadores {"{{...}}"} contidos nas cláusulas ativas deste modelo.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {dynamicPlaceholders.map((key) => (
                      <div key={key} className="space-y-1.5">
                        <Label className="text-xs font-medium">
                          {formatFieldLabel(key)} <span className="font-mono text-[10px] text-purple-600 dark:text-purple-400">({"{{"+key+"}}"})</span>
                        </Label>
                        <Input
                          name={key}
                          value={formData[key] ?? ""}
                          onChange={handleChange}
                          placeholder={`Preencher ${formatFieldLabel(key).toLowerCase()}...`}
                          className="text-xs"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="clausulas" className="space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-200 dark:border-white/10">
              <div>
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider flex items-center gap-2">
                  <Layers className="h-4 w-4 text-purple-650" />
                  Gestão Modular de Cláusulas
                </h4>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Reordene e ative/desative cláusulas. A numeração por extenso (Primeira, Segunda, Terceira...) é recalculada automaticamente sem buracos.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={handleAddClause}
                className="h-8 text-xs bg-purple-650 hover:bg-purple-700 text-white gap-1.5 shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                Nova Cláusula
              </Button>
            </div>

            <div className="space-y-3">
              {clausulas.map((clause, index) => {
                const isAtivo = clause.ativo !== false;
                const ordinalIndex = activeIndexMap.get(clause.id);
                const ordinalName = ordinalIndex ? toExtenseOrdinal(ordinalIndex) : "";
                const placeholdersInClause = extractPlaceholders(clause.conteudo);

                return (
                  <div
                    key={clause.id || `clause-${index}`}
                    className={`rounded-xl border transition-all p-3 space-y-2.5 ${
                      isAtivo
                        ? "bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10 shadow-sm"
                        : "bg-slate-50/80 dark:bg-slate-950/40 border-dashed border-slate-300 dark:border-white/10 opacity-70"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-white/5 pb-2">
                      <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                        {/* Botões de Reordenação ▲ / ▼ */}
                        <div className="flex items-center border border-slate-200 dark:border-white/10 rounded-md overflow-hidden bg-slate-50 dark:bg-slate-800">
                          <button
                            type="button"
                            onClick={() => handleMoveClause(index, -1)}
                            disabled={index === 0}
                            title="Subir cláusula"
                            className="px-1.5 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <div className="w-px h-4 bg-slate-200 dark:bg-white/10" />
                          <button
                            type="button"
                            onClick={() => handleMoveClause(index, 1)}
                            disabled={index === clausulas.length - 1}
                            title="Descer cláusula"
                            className="px-1.5 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Badge de Numeração Ordinal Dinâmica */}
                        {isAtivo && ordinalIndex ? (
                          <Badge className="bg-purple-650 text-white font-mono text-[10px] shrink-0">
                            {ordinalIndex}ª – Cláusula {ordinalName}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400 font-mono text-[10px] shrink-0">
                            Desativada
                          </Badge>
                        )}

                        {/* Título Editável */}
                        <Input
                          value={clause.titulo}
                          onChange={(e) => handleUpdateClauseTitle(clause.id, e.target.value)}
                          placeholder="Título da cláusula (ex: Do Objeto, Do Foro)..."
                          className="h-8 text-xs font-semibold flex-1 min-w-[150px]"
                        />
                      </div>

                      <div className="flex items-center gap-3">
                        {/* Switch Ativo / Desativado */}
                        <div className="flex items-center gap-1.5">
                          <Switch
                            checked={isAtivo}
                            onCheckedChange={() => handleToggleClause(clause.id)}
                            id={`switch-${clause.id}`}
                          />
                          <Label htmlFor={`switch-${clause.id}`} className="text-xs cursor-pointer select-none">
                            {isAtivo ? "Ativa" : "Desativada"}
                          </Label>
                        </div>

                        {/* Botão Excluir */}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteClause(clause.id)}
                          disabled={clause.obrigatorio}
                          title={clause.obrigatorio ? "Cláusula obrigatória não pode ser removida" : "Excluir cláusula"}
                          className="h-8 w-8 p-0 text-slate-400 hover:text-red-600 disabled:opacity-30"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Conteúdo da Cláusula */}
                    <div className="space-y-1.5">
                      <Textarea
                        value={clause.conteudo}
                        onChange={(e) => handleUpdateClauseContent(clause.id, e.target.value)}
                        rows={4}
                        placeholder="Texto da cláusula contendo marcadores {{variavel}}..."
                        className="text-xs font-mono leading-relaxed bg-white dark:bg-slate-950"
                      />

                      {/* Marcadores detectados na cláusula */}
                      {placeholdersInClause.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 pt-1">
                          <span className="text-[10px] text-slate-400">Variáveis detectadas:</span>
                          {placeholdersInClause.map((ph) => (
                            <span
                              key={ph}
                              className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10"
                            >
                              {"{{"}{ph}{"}}"}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {clausulas.length === 0 && (
                <div className="p-8 text-center text-slate-500 bg-slate-50 dark:bg-slate-900 rounded-xl border border-dashed border-slate-300 dark:border-white/10">
                  Nenhuma cláusula definida para este modelo. Clique em <strong>+ Nova Cláusula</strong> para adicionar.
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="preview">
            <ContractPreview
              template={currentTemplate}
              rawTemplateContent={assembledContractContent}
              formData={buildContractDados(formData) as GdContractFormData}
              onChangeTextoFinal={(text) => setFormData((prev) => ({ ...prev, texto_final: text }))}
            />
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={handleGenerate}
            disabled={createContract.isPending || updateContract.isPending}
            className="bg-purple-650 hover:bg-purple-700 text-white"
          >
            {isEdit
              ? (updateContract.isPending ? "Salvando..." : "Salvar Alterações")
              : (createContract.isPending ? "Gerando..." : "Gerar Contrato Definitivo")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
