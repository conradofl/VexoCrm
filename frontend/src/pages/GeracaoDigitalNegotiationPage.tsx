import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { GeracaoDigitalNegotiationBoard, type NegotiationFinalizeResult } from "@/components/GeracaoDigitalNegotiationBoard";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { FileText, ArrowLeft, CheckCircle, Share2, ExternalLink } from "lucide-react";
import { PageShell } from "@/components/PageShell";

interface NegotiationPageProps {
  // Quando renderizada inline (overlay na proposta pública), recebe o id por
  // prop e um onExit em vez de depender da rota/window.close.
  proposalId?: string;
  onExit?: () => void;
}

export default function GeracaoDigitalNegotiationPage({ proposalId, onExit }: NegotiationPageProps = {}) {
  const params = useParams<{ id: string }>();
  const id = proposalId ?? params.id;
  const navigate = useNavigate();
  const handleExit = onExit ?? (() => window.close());
  const { toast } = useToast();
  const { isAuthenticated, getIdToken, clientId } = useAuth();
  
  const [proposal, setProposal] = useState<any>(null);
  const [availablePackages, setAvailablePackages] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [negotiated, setNegotiated] = useState(false);
  const [pendingNegotiationUpdate, setPendingNegotiationUpdate] = useState<NegotiationFinalizeResult | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    
    const loadData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const token = await getIdToken();
        const headers: HeadersInit = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;

        // 1. Load Proposal
        const propRes = await fetchApi(`/api/gd/proposals/${id}?client_id=${clientId || ""}`, { headers });
        if (!propRes.ok) {
          throw new Error(await readApiErrorMessage(propRes, "Erro ao carregar proposta"));
        }
        const propData = await readApiJson<any>(propRes, "proposal");
        const proposalObj = propData.data || propData;
        setProposal(proposalObj);

        // 2. Load Packages — biblioteca (ad_hoc=false) + os pacotes referenciados
        // por esta proposta buscados por id (INCLUSIVE ad_hoc, que não aparecem na
        // biblioteca). Sem isso, uma proposta com pacote ad_hoc abria a Mesa com o
        // pacote faltando e o board quebrava no lookup.
        const refIds = new Set<string>();
        if (proposalObj?.package_id) refIds.add(proposalObj.package_id);
        if (proposalObj?.package_vexo_id) refIds.add(proposalObj.package_vexo_id);
        (Array.isArray(proposalObj?.pacotes_ofertados) ? proposalObj.pacotes_ofertados : []).forEach((pid: string) => { if (pid) refIds.add(pid); });

        const [pkgRes, refRes] = await Promise.all([
          fetchApi(`/api/gd/packages?client_id=${clientId || ""}`, { headers }),
          refIds.size > 0
            ? fetchApi(`/api/gd/packages?client_id=${clientId || ""}&ids=${Array.from(refIds).join(",")}`, { headers })
            : Promise.resolve(null),
        ]);

        const merged = new Map<string, any>();
        if (pkgRes.ok) {
          const pkgData = await readApiJson<any>(pkgRes, "packages");
          (Array.isArray(pkgData) ? pkgData : (pkgData?.data || [])).forEach((p: any) => merged.set(p.id, p));
        }
        if (refRes && refRes.ok) {
          const refData = await readApiJson<any>(refRes, "packages-ref");
          (Array.isArray(refData) ? refData : (refData?.data || [])).forEach((p: any) => merged.set(p.id, p));
        }
        setAvailablePackages(Array.from(merged.values()));
      } catch (err: any) {
        console.error(err);
        setError(err.message || "Falha ao carregar dados da negociação.");
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [id, isAuthenticated, clientId]);

  // Debounced auto-save on lever adjustments
  useEffect(() => {
    if (!pendingNegotiationUpdate || !proposal || negotiated) return;

    const timer = setTimeout(async () => {
      try {
        const token = await getIdToken();
        const headers: HeadersInit = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const isento = pendingNegotiationUpdate.descontos.some((d: any) => d.tipo === "isencao_setup");
        const cobrarSetup = proposal.cobrar_setup;
        const valorSetupVexo = proposal.valor_setup_vexo;

        const body = {
          client_id: clientId,
          prospect_name: proposal.prospect_name,
          itens: proposal.itens,
          condicoes: proposal.condicoes,
          payment_link: proposal.payment_link,
          cobrar_setup: cobrarSetup,
          valor_setup_vexo: isento ? 0 : (cobrarSetup ? Number(valorSetupVexo || 0) : null),
          descontos_concedidos: pendingNegotiationUpdate.descontos,
          meio_pagamento: pendingNegotiationUpdate.meioPagamento,
          periodo_plano: proposal.periodo_plano || null,
          validade_ate: proposal.validade_ate || null,
          valor_apos_validade: proposal.valor_apos_validade !== null ? Number(proposal.valor_apos_validade) : null,
          observacao_validade: proposal.observacao_validade || null,
          carencia_dias: pendingNegotiationUpdate.carenciaDias ? Number(pendingNegotiationUpdate.carenciaDias) : (proposal.carencia_dias || null),
          condicoes_pagamento: proposal.condicoes_pagamento
        };

        const res = await fetchApi(`/api/gd/proposals/${proposal.id}`, {
          method: "PUT",
          headers,
          body: JSON.stringify(body)
        });

        if (res.ok) {
          console.log("Auto-save completed successfully.");
        }
      } catch (err) {
        console.error("Auto-save error:", err);
      }
    }, 400); // 400ms debounce

    return () => clearTimeout(timer);
  }, [pendingNegotiationUpdate, proposal, clientId, negotiated]);

  const handleFinalize = async (result: NegotiationFinalizeResult) => {
    if (!proposal) return;
    try {
      setIsSaving(true);
      const token = await getIdToken();
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const isento = result.descontos.some((d) => d.tipo === "isencao_setup");
      const cobrarSetup = proposal.cobrar_setup;
      const valorSetupVexo = proposal.valor_setup_vexo;

      const body = {
        client_id: clientId,
        prospect_name: proposal.prospect_name,
        itens: proposal.itens,
        condicoes: proposal.condicoes,
        payment_link: proposal.payment_link,
        cobrar_setup: cobrarSetup,
        valor_setup_vexo: isento ? 0 : (cobrarSetup ? Number(valorSetupVexo || 0) : null),
        descontos_concedidos: result.descontos,
        meio_pagamento: result.meioPagamento,
        periodo_plano: proposal.periodo_plano || null,
        validade_ate: proposal.validade_ate || null,
        valor_apos_validade: proposal.valor_apos_validade !== null ? Number(proposal.valor_apos_validade) : null,
        observacao_validade: proposal.observacao_validade || null,
        carencia_dias: result.carenciaDias ? Number(result.carenciaDias) : (proposal.carencia_dias || null),
        condicoes_pagamento: proposal.condicoes_pagamento
      };

      const res = await fetchApi(`/api/gd/proposals/${proposal.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(body)
      });
      
      if (!res.ok) throw new Error("Erro ao gravar as concessões da negociação.");

      toast({ title: "Negociação registrada", description: "Concessões gravadas com sucesso!" });
      setNegotiated(true);
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro", description: err.message || "Falha ao fechar a negociação.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
        <div className="p-8 max-w-lg w-full text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl space-y-4">
          <h2 className="text-lg font-bold text-red-600">Erro ao abrir a Mesa</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">{error}</p>
          <Button onClick={handleExit} variant="outline" className="w-full dark:text-slate-200">
            Fechar
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading || !proposal) {
    return (
      <div className="flex h-screen items-center justify-center gap-3 bg-slate-50 dark:bg-slate-950">
        <span className="animate-spin h-6 w-6 border-4 border-purple-600 border-t-transparent rounded-full" />
        <div className="text-sm font-bold text-slate-700 dark:text-slate-200">Carregando Mesa de Negociação...</div>
      </div>
    );
  }

  if (false) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center mt-12 bg-white dark:bg-slate-900 border rounded-xl">
        <h2 className="text-lg font-bold text-red-600 mb-2">Erro</h2>
        <p className="text-slate-650 dark:text-slate-350 text-sm mb-4">{error || "Proposta não encontrada."}</p>
        <Button onClick={handleExit} variant="outline" className="w-full">
          Fechar Aba
        </Button>
      </div>
    );
  }

  if (negotiated) {
    const publicUrl = `${window.location.origin}/proposta/${proposal.id}`;
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 dark:bg-slate-950 p-6">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-8 rounded-3xl text-center space-y-6 shadow-xl">
          <CheckCircle className="h-16 w-16 text-emerald-500 mx-auto" />
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-slate-800 dark:text-slate-100">Negociação Salva!</h2>
            <p className="text-xs text-slate-550 dark:text-slate-400">
              As alavancas e descontos comerciais da proposta de <b>{proposal.prospect_name}</b> foram registrados com sucesso no banco de dados.
            </p>
          </div>
          
          <div className="flex flex-col gap-3 pt-2">
            <Button
              className="bg-gradient-to-r from-purple-700 to-indigo-600 text-white font-bold w-full"
              onClick={() => window.open(publicUrl, "_blank")}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Ver Proposta Pública
            </Button>
            <Button
              variant="outline"
              className="w-full border-slate-200 dark:border-white/10 dark:text-slate-200"
              onClick={() => {
                navigator.clipboard.writeText(publicUrl);
                toast({ title: "Copiado", description: "Link copiado!" });
              }}
            >
              <Share2 className="h-4 w-4 mr-2" />
              Copiar Link Público
            </Button>
            <Button
              variant="ghost"
              className="w-full text-slate-550 dark:text-slate-400"
              onClick={handleExit}
            >
              Fechar Negociação
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const items = proposal.itens || [];
  const setupTotal = items.filter((i: any) => i.recorrencia === "unico").reduce((sum: number, i: any) => sum + Number(i.valor || 0), 0);
  const recurringTotal = items.filter((i: any) => i.recorrencia === "mensal").reduce((sum: number, i: any) => sum + Number(i.valor || 0), 0);
  const setupVexoValue = proposal.cobrar_setup ? Number(proposal.valor_setup_vexo || 0) : 0;
  const offeredTerms = proposal.condicoes_pagamento?.ofertadas || [];

  return (
    <GeracaoDigitalNegotiationBoard
      prospectName={proposal.prospect_name}
      items={items}
      setupItensTotal={setupTotal}
      recurringTotal={recurringTotal}
      setupVexoValue={setupVexoValue}
      periodoPlano={proposal.periodo_plano || "mensal"}
      validadeAte={proposal.validade_ate ? proposal.validade_ate.split("T")[0] : ""}
      offeredTerms={offeredTerms}
      onClose={handleExit}
      onFinalize={handleFinalize}
      onNegotiationChange={(res) => setPendingNegotiationUpdate(res)}
      packageId={proposal.package_id}
      packageVexoId={proposal.package_vexo_id}
      availablePackages={availablePackages}
    />
  );
}
