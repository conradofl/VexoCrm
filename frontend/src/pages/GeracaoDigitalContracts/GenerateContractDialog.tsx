import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateGdContract, useUpdateGdContract, useExtractContractData, useGdContractTemplates, GdContractFormData } from "@/hooks/useGdContracts";
import { Sparkles } from "lucide-react";
import { buildContractDados } from "@/lib/geracaoDigital/contractMerge";
import { ContractPreview } from "./ContractPreview";
import { useToast } from "@/components/ui/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalStorage } from "@/hooks/useLocalStorage";

const CONTRACT_DEFAULTS: Record<string, string> = {
  // Contratante
  razao_social: "",
  cnpj: "",
  telefone: "",
  telefone2: "",
  email: "",
  representante: "",
  endereco: "",
  // Objeto / entregas
  produtos: "",
  condicoes_pagamento: "",
  artes_mensais: "15",
  // Preço (estruturado)
  forma_pagamento: "permuta",
  num_parcelas: "6",
  valor_parcela: "",
  data_primeiro_venc: "",
  // Prazo / foro / assinatura
  prazo_dias: "180",
  aviso_previo_dias: "60",
  foro_cidade: "Uberlândia-MG",
  cidade_assinatura: "Uberlândia-MG",
  vigencia: "90",
};

// Ignora chaves vazias para não apagar default com string em branco.
function somentePreenchidos(obj: Record<string, any> = {}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
  ) as Record<string, string>;
}

interface GenerateContractDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  initialData: Partial<GdContractFormData>;
  /** Quando presente, o diálogo entra em modo EDIÇÃO de um contrato já gerado. */
  contractId?: string | null;
  /** Dados salvos do contrato que está sendo editado. */
  initialDados?: Partial<GdContractFormData> | null;
}

export function GenerateContractDialog({ open, onOpenChange, proposalId, initialData, contractId, initialDados }: GenerateContractDialogProps) {
  const { data: templates } = useGdContractTemplates();
  const createContract = useCreateGdContract();
  const updateContract = useUpdateGdContract();
  const extractData = useExtractContractData();
  const { toast } = useToast();
  const isEdit = !!contractId;
  const [textoColado, setTextoColado] = useState("");

  const [formData, setFormData] = useLocalStorage<GdContractFormData>(
    `gd_contract_form_${proposalId}`,
    // Defaults + tudo que veio da proposta aceita (escopo, parcelas, valores,
    // período, carência). O spread precisa vir por último: antes só 3 campos
    // eram aproveitados e o resto ficava no default.
    { ...CONTRACT_DEFAULTS, ...somentePreenchidos(initialData) } as GdContractFormData
  );

  // Modo edição: ao abrir, carrega os dados salvos do contrato (fonte da verdade,
  // não o rascunho do localStorage).
  useEffect(() => {
    if (open && contractId && initialDados) {
      setFormData((prev) => ({ ...prev, ...initialDados }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contractId]);

  // Puxa (de novo) tudo que já foi negociado na proposta: escopo, forma de
  // pagamento, parcelas, valor, 1º vencimento e prazo. Útil quando existe um
  // rascunho antigo no navegador, criado antes destes campos existirem.
  const handlePuxarDaProposta = () => {
    const vindos = somentePreenchidos(initialData);
    if (Object.keys(vindos).length === 0) {
      toast({ title: "Nada para puxar", description: "Esta proposta não tem dados aproveitáveis.", variant: "destructive" });
      return;
    }
    setFormData((prev) => ({ ...prev, ...vindos }));
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

    const templateId = templates && templates.length > 0 ? templates[0].id : undefined;

    // Modo edição: atualiza o contrato existente (o PDF é remontado on the fly,
    // então a correção aparece no documento na hora).
    if (contractId) {
      updateContract.mutate(
        { id: contractId, data: { dados: buildContractDados(formData) as GdContractFormData } },
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
      proposal_id: proposalId,
      template_id: templateId,
      // Salva já com os campos derivados (forma por extenso + cronograma).
      dados: buildContractDados(formData) as GdContractFormData
    }, {
      onSuccess: () => {
        toast({
          title: "Contrato gerado",
          description: "O contrato foi gerado com sucesso.",
        });
        localStorage.removeItem(`gd_contract_form_${proposalId}`);
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
    extractData.mutate(textoColado, {
      onSuccess: (extraido) => {
        const preenchidos = Object.entries(extraido).filter(([, v]) => v && String(v).trim() !== "");
        if (preenchidos.length === 0) {
          toast({ title: "Nada encontrado", description: "A IA não identificou dados no texto colado.", variant: "destructive" });
          return;
        }
        setFormData((prev) => ({ ...prev, ...Object.fromEntries(preenchidos) }));
        toast({ title: "Campos preenchidos", description: `${preenchidos.length} campo(s) preenchido(s) pela IA. Revise antes de gerar.` });
      },
      onError: (err: any) => toast({ title: "Erro na extração", description: err.message, variant: "destructive" }),
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

        <Tabs defaultValue="form" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="form">Formulário de Preenchimento</TabsTrigger>
            <TabsTrigger value="preview">Preview do Contrato</TabsTrigger>
          </TabsList>

          <TabsContent value="form" className="space-y-4">
            {/* Dados já negociados na proposta */}
            {!isEdit && (
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

              {/* Cláusula 5ª — Preço e Condições (estruturado) */}
              <div className="md:col-span-2 border-t border-slate-200 dark:border-white/10 pt-3">
                <span className="text-xs font-bold uppercase tracking-wider text-purple-650 dark:text-purple-400">Preço e Condições (Cláusula 5ª)</span>
              </div>
              <div className="space-y-2">
                <Label>Forma de pagamento</Label>
                <select
                  name="forma_pagamento"
                  value={formData.forma_pagamento || "permuta"}
                  onChange={handleChange}
                  className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-md px-3 h-10 text-sm text-slate-800 dark:text-slate-100"
                >
                  <option value="permuta">100% permuta (troca de serviços)</option>
                  <option value="dinheiro">Dinheiro</option>
                  <option value="misto">Misto (dinheiro + permuta)</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Nº de parcelas</Label>
                <Input name="num_parcelas" value={formData.num_parcelas || ""} onChange={handleChange} type="number" placeholder="Ex: 6" />
              </div>
              <div className="space-y-2">
                <Label>Valor por parcela (R$)</Label>
                <Input name="valor_parcela" value={formData.valor_parcela || ""} onChange={handleChange} type="number" placeholder="Ex: 3500" />
              </div>
              <div className="space-y-2">
                <Label>Data do 1º vencimento</Label>
                <Input name="data_primeiro_venc" value={formData.data_primeiro_venc || ""} onChange={handleChange} type="date" />
              </div>

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
                <Input name="foro_cidade" value={formData.foro_cidade || ""} onChange={handleChange} placeholder="Ex: Uberlândia-MG" />
              </div>
              <div className="space-y-2">
                <Label>Cidade da assinatura</Label>
                <Input name="cidade_assinatura" value={formData.cidade_assinatura || ""} onChange={handleChange} placeholder="Ex: Uberlândia-MG" />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="preview">
            <ContractPreview template={template} formData={buildContractDados(formData) as GdContractFormData} />
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
