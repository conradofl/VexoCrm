import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateGdContract, useGdContractTemplates, GdContractFormData } from "@/hooks/useGdContracts";
import { ContractPreview } from "./ContractPreview";
import { useToast } from "@/components/ui/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalStorage } from "@/hooks/useLocalStorage";

interface GenerateContractDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  initialData: Partial<GdContractFormData>;
}

export function GenerateContractDialog({ open, onOpenChange, proposalId, initialData }: GenerateContractDialogProps) {
  const { data: templates } = useGdContractTemplates();
  const createContract = useCreateGdContract();
  const { toast } = useToast();

  const [formData, setFormData] = useLocalStorage<GdContractFormData>(`gd_contract_form_${proposalId}`, {
    razao_social: initialData.razao_social || "",
    cnpj: "",
    telefone: "",
    email: "",
    representante: "",
    endereco: "",
    produtos: initialData.produtos || "",
    condicoes_pagamento: initialData.condicoes_pagamento || "",
    vigencia: "90", // 3 meses (padrão)
  });

  // Atualizar quando initialData mudar (se não tinha localStorage)
  useEffect(() => {
    if (open && initialData && (!formData.razao_social && !formData.produtos)) {
      setFormData((prev) => ({
        ...prev,
        razao_social: initialData.razao_social || prev.razao_social,
        produtos: initialData.produtos || prev.produtos,
        condicoes_pagamento: initialData.condicoes_pagamento || prev.condicoes_pagamento,
      }));
    }
  }, [open, initialData, setFormData, formData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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

    createContract.mutate({
      proposal_id: proposalId,
      template_id: templateId,
      dados: formData
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

  const template = templates && templates.length > 0 ? templates[0] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gerar Contrato Jurídico</DialogTitle>
          <DialogDescription>
            Preencha os dados do cliente. O texto da cláusula será montado mesclando essas variáveis no template.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="form" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="form">Formulário de Preenchimento</TabsTrigger>
            <TabsTrigger value="preview">Preview do Contrato</TabsTrigger>
          </TabsList>

          <TabsContent value="form" className="space-y-4">
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
                <Label>Email</Label>
                <Input name="email" value={formData.email} onChange={handleChange} type="email" />
              </div>
              <div className="space-y-2">
                <Label>Vigência (dias)</Label>
                <Input name="vigencia" value={formData.vigencia} onChange={handleChange} type="number" />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Endereço Completo</Label>
                <Input name="endereco" value={formData.endereco} onChange={handleChange} />
              </div>
              
              <div className="space-y-2 md:col-span-2">
                <Label>Produtos/Serviços (Objeto)</Label>
                <Textarea 
                  name="produtos" 
                  value={formData.produtos} 
                  onChange={handleChange} 
                  rows={4}
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>Condições de Pagamento</Label>
                <Textarea 
                  name="condicoes_pagamento" 
                  value={formData.condicoes_pagamento} 
                  onChange={handleChange} 
                  rows={3}
                  className="font-mono text-xs"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="preview">
            <ContractPreview template={template} formData={formData} />
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button 
            onClick={handleGenerate} 
            disabled={createContract.isPending}
            className="bg-purple-650 hover:bg-purple-700 text-white"
          >
            {createContract.isPending ? "Gerando..." : "Gerar Contrato Definitivo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
