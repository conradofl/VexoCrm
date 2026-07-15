import { useState } from "react";
import { fetchApi } from "@/lib/api";
import type { PaymentTerm } from "@/lib/geracaoDigital/paymentTerms";

interface UseProposalWizardProps {
  clientId: string;
  getIdToken: () => Promise<string | undefined>;
  availablePackages: any[];
  vexoProducts: any[];
  gdProducts: any[];
  availableTerms: PaymentTerm[];
  loadProposals: () => void;
  toast: (options: { title: string; description: string; variant?: "default" | "destructive" }) => void;
}

export function useProposalWizard({
  clientId,
  getIdToken,
  availablePackages,
  vexoProducts,
  gdProducts,
  availableTerms,
  loadProposals,
  toast
}: UseProposalWizardProps) {
  const [showNewForm, setShowNewForm] = useState<boolean>(false);
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [newProspect, setNewProspect] = useState<string>("");
  const [newPackageId, setNewPackageId] = useState<string>("");
  const [newPackageVexoId, setNewPackageVexoId] = useState<string>("");
  const [newPacotesOfertados, setNewPacotesOfertados] = useState<string[]>([]);
  const [newOfferedTermIds, setNewOfferedTermIds] = useState<string[]>([]);
  const [newVexoAvulsoIds, setNewVexoAvulsoIds] = useState<Record<string, boolean>>({});
  const [newGdAvulsoIds, setNewGdAvulsoIds] = useState<Record<string, boolean>>({});
  const [newCarencia, setNewCarencia] = useState<string>("");
  const [newCobrarSetup, setNewCobrarSetup] = useState<boolean>(false);
  const [newValorSetup, setNewValorSetup] = useState<number>(0);
  const [newPeriodo, setNewPeriodo] = useState<string>("mensal");
  const [newValidade, setNewValidade] = useState<string>("");
  const [newCondicoes, setNewCondicoes] = useState<string>("");
  const [newPaymentLink, setNewPaymentLink] = useState<string>("");
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null);

  const resetWizard = () => {
    setWizardStep(1);
    setNewProspect("");
    setNewPackageId("");
    setNewPackageVexoId("");
    setNewPacotesOfertados([]);
    setNewOfferedTermIds([]);
    setNewVexoAvulsoIds({});
    setNewGdAvulsoIds({});
    setNewCarencia("");
    setNewCobrarSetup(false);
    setNewValorSetup(0);
    setNewPeriodo("mensal");
    setNewValidade("");
    setNewCondicoes("");
    setNewPaymentLink("");
    setEditingProposalId(null);
  };

  const handleCreateDirectProposal = async () => {
    if (!newProspect.trim()) {
      toast({ title: "Nome obrigatório", description: "Informe o nome do prospect.", variant: "destructive" });
      return;
    }
    try {
      const token = await getIdToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const finalItems: any[] = [];

      let totalVp = 0;

      // 1. Add GD package item
      const selectedGdPkg = availablePackages.find(p => p.id === newPackageId && (p.tipo === "gd" || !p.tipo));
      if (selectedGdPkg) {
        const val = Number(selectedGdPkg.valor || 0);
        const PERIOD_MONTHS: Record<string, number> = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
        const meses = selectedGdPkg.periodo === "unico" ? null : (PERIOD_MONTHS[selectedGdPkg.periodo] ?? 1);
        const mensalidade = meses ? Math.round((val / meses) * 100) / 100 : val;
        const valorTabela = Number(selectedGdPkg.valor_tabela || 0);
        const vp = selectedGdPkg.valor_vp ? Number(selectedGdPkg.valor_vp) : 0;
        if (vp > 0) totalVp += vp;

        finalItems.push({
          product_id: null,
          descricao: `Pacote: ${selectedGdPkg.nome} (${selectedGdPkg.periodo === "unico" ? "Setup" : "Recorrência"})`,
          categoria: "gd",
          valor: mensalidade,
          valor_vp: vp > 0 ? vp : null,
          recorrencia: meses ? "mensal" : "unico",
          periodo: selectedGdPkg.periodo,
          meses,
          total_periodo: meses ? val : null,
          valor_tabela: valorTabela > val ? valorTabela : null
        });

        if (Array.isArray(selectedGdPkg.produtos_incluidos)) {
          selectedGdPkg.produtos_incluidos.forEach((p: any) => {
            finalItems.push({
              product_id: p.product_id || null,
              descricao: p.nome,
              categoria: "gd",
              valor: 0,
              recorrencia: "mensal"
            });
          });
        }
      }

      // 2. Add Vexo package item
      const selectedVexoPkg = availablePackages.find(p => p.id === newPackageVexoId && p.tipo === "vexo");
      if (selectedVexoPkg) {
        const val = Number(selectedVexoPkg.valor || 0);
        const PERIOD_MONTHS: Record<string, number> = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
        const meses = selectedVexoPkg.periodo === "unico" ? null : (PERIOD_MONTHS[selectedVexoPkg.periodo] ?? 1);
        const mensalidade = meses ? Math.round((val / meses) * 100) / 100 : val;
        const valorTabela = Number(selectedVexoPkg.valor_tabela || 0);
        const vp = selectedVexoPkg.valor_vp ? Number(selectedVexoPkg.valor_vp) : 0;
        if (vp > 0) totalVp += vp;

        finalItems.push({
          product_id: null,
          descricao: `Pacote Vexo: ${selectedVexoPkg.nome} (${selectedVexoPkg.periodo === "unico" ? "Setup" : "Recorrência"})`,
          categoria: "vexo",
          valor: mensalidade,
          valor_vp: vp > 0 ? vp : null,
          recorrencia: meses ? "mensal" : "unico",
          periodo: selectedVexoPkg.periodo,
          meses,
          total_periodo: meses ? val : null,
          valor_tabela: valorTabela > val ? valorTabela : null
        });

        if (Array.isArray(selectedVexoPkg.produtos_incluidos)) {
          selectedVexoPkg.produtos_incluidos.forEach((p: any) => {
            finalItems.push({
              product_id: p.product_id || null,
              descricao: `Módulo: ${p.nome}`,
              categoria: "vexo",
              valor: 0,
              recorrencia: "mensal"
            });
          });
        }
      }

      // 3. Add Vexo avulso modules
      Object.entries(newVexoAvulsoIds).forEach(([id, checked]) => {
        if (checked) {
          const prod = vexoProducts.find(p => p.id === id);
          if (prod) {
            const vp = prod.valor_vp ? Number(prod.valor_vp) : 0;
            if (vp > 0) totalVp += vp;
            finalItems.push({
              product_id: prod.id,
              descricao: `Vexo OS: ${prod.nome}`,
              categoria: "vexo",
              valor: Number(prod.valor || 0),
              valor_vp: vp > 0 ? vp : null,
              recorrencia: prod.recorrencia || "mensal"
            });
          }
        }
      });

      // 3b. Add GD avulso modules
      Object.entries(newGdAvulsoIds).forEach(([id, checked]) => {
        if (checked) {
          const prod = gdProducts.find(p => p.id === id);
          if (prod) {
            const vp = prod.valor_vp ? Number(prod.valor_vp) : 0;
            if (vp > 0) totalVp += vp;
            finalItems.push({
              product_id: prod.id,
              descricao: `GD: ${prod.nome}`,
              categoria: "gd",
              valor: Number(prod.valor_padrao || 0),
              valor_vp: vp > 0 ? vp : null,
              recorrencia: prod.recorrencia || "mensal"
            });
          }
        }
      });

      const body: any = {
        client_id: clientId,
        prospect_name: newProspect.trim(),
        package_id: newPackageId || null,
        package_vexo_id: newPackageVexoId || null,
        pacotes_ofertados: newPacotesOfertados,
        itens: finalItems,
        cobrar_setup: newCobrarSetup,
        valor_setup_vexo: newCobrarSetup ? Number(newValorSetup || 0) : null,
        periodo_plano: (() => {
          const gdPkg = availablePackages.find(p => p.id === newPackageId && (p.tipo === "gd" || !p.tipo));
          const vexoPkg = availablePackages.find(p => p.id === newPackageVexoId && p.tipo === "vexo");
          return gdPkg?.periodo || vexoPkg?.periodo || "mensal";
        })(),
        validade_ate: newValidade ? new Date(`${newValidade}T23:59:59`).toISOString() : null,
        condicoes: newCondicoes || undefined,
        payment_link: newPaymentLink || null,
        carencia_dias: newCarencia !== "" ? Number(newCarencia) : null,
        valor_vp: totalVp > 0 ? totalVp : null,
        // Condições de pagamento ofertadas ao cliente (menu na proposta pública).
        condicoes_pagamento: {
          ofertadas: availableTerms.filter((t) => newOfferedTermIds.includes(t.id)),
          escolhida: null
        }
      };

      const url = editingProposalId ? `/api/gd/proposals/${editingProposalId}` : `/api/gd/proposals`;
      const method = editingProposalId ? "PUT" : "POST";

      const res = await fetchApi(url, {
        method,
        headers,
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Erro ao ${editingProposalId ? "atualizar" : "criar"} proposta.`);
      }
      toast({
        title: editingProposalId ? "Proposta Atualizada" : "Proposta Criada",
        description: editingProposalId 
          ? `Rascunho de ${newProspect} atualizado com sucesso.`
          : `Rascunho para ${newProspect} pronto para edição e negociação.`
      });
      setShowNewForm(false);
      resetWizard();
      loadProposals();
    } catch (err: any) {
      console.error(err);
      toast({ title: editingProposalId ? "Erro ao Atualizar" : "Erro ao Criar", description: err.message, variant: "destructive" });
    }
  };

  return {
    showNewForm,
    setShowNewForm,
    wizardStep,
    setWizardStep,
    newProspect,
    setNewProspect,
    newPackageId,
    setNewPackageId,
    newPackageVexoId,
    setNewPackageVexoId,
    newPacotesOfertados,
    setNewPacotesOfertados,
    newOfferedTermIds,
    setNewOfferedTermIds,
    newVexoAvulsoIds,
    setNewVexoAvulsoIds,
    newGdAvulsoIds,
    setNewGdAvulsoIds,
    newCarencia,
    setNewCarencia,
    newCobrarSetup,
    setNewCobrarSetup,
    newValorSetup,
    setNewValorSetup,
    newPeriodo,
    setNewPeriodo,
    newValidade,
    setNewValidade,
    newCondicoes,
    setNewCondicoes,
    newPaymentLink,
    setNewPaymentLink,
    editingProposalId,
    setEditingProposalId,
    resetWizard,
    handleCreateDirectProposal
  };
}
