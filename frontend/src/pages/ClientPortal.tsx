import React, { useState } from "react";
import { useParams } from "react-router-dom";
import {
  useClientPortal,
  useApproveDeliverable,
  useRequestRevision,
  DeliverableItem,
  FunnelStageId,
} from "@/hooks/useClientPortal";
import { PortalHeroHeader } from "./ClientPortal/PortalHeroHeader";
import { PortalFunnelProgress } from "./ClientPortal/PortalFunnelProgress";
import { PortalDeliverablesList } from "./ClientPortal/PortalDeliverablesList";
import { PortalItemDetailModal } from "./ClientPortal/PortalItemDetailModal";
import { PortalMetricsSummary } from "./ClientPortal/PortalMetricsSummary";
import { useToast } from "@/hooks/use-toast";

export const ClientPortal: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const activeSlug = slug || "vox2you";
  const { toast } = useToast();

  const { data: portalData, isLoading } = useClientPortal(activeSlug);
  const approveMutation = useApproveDeliverable(activeSlug);
  const revisionMutation = useRequestRevision(activeSlug);

  const [selectedStage, setSelectedStage] = useState<FunnelStageId | "todos">("todos");
  const [selectedItem, setSelectedItem] = useState<DeliverableItem | null>(null);

  if (isLoading || !portalData) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-white">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm text-slate-400 font-medium">
          Carregando portal do cliente em tempo real...
        </p>
      </div>
    );
  }

  const totalDeliverables = portalData.deliverables.length;
  const completedDeliverables = portalData.deliverables.filter(
    (d) => d.status === "publicado"
  ).length;

  const handleApprove = async (itemId: string) => {
    try {
      await approveMutation.mutateAsync({ itemId });
      toast({
        title: "✅ Peça Aprovada com Sucesso!",
        description: "A equipe de publicação foi notificada e o vídeo está liberado para veiculação.",
      });
      // Atualiza item selecionado se estiver aberto no modal
      if (selectedItem && selectedItem.id === itemId) {
        setSelectedItem({ ...selectedItem, status: "publicado" });
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Erro ao aprovar",
        description: "Não foi possível registrar a aprovação. Tente novamente.",
      });
    }
  };

  const handleRequestRevision = async (itemId: string, feedback: string) => {
    try {
      await revisionMutation.mutateAsync({ itemId, feedback });
      toast({
        title: "📝 Ajuste Solicitado",
        description: "Sua observação foi encaminhada para a equipe de edição (Santana / Eflen).",
      });
      if (selectedItem && selectedItem.id === itemId) {
        setSelectedItem({
          ...selectedItem,
          status: "ajuste_solicitado",
          feedback,
        });
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Erro ao solicitar ajuste",
        description: "Não foi possível registrar o pedido de ajuste. Tente novamente.",
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-indigo-500 selection:text-white pb-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-8">
        {/* 1. Hero Header */}
        <PortalHeroHeader
          companyName={portalData.companyName}
          tagline={portalData.tagline}
          partnershipBadge={portalData.partnershipBadge}
          period={portalData.period}
          commercialGoal={portalData.commercialGoal}
          whatsappSupportNumber={portalData.whatsappSupportNumber}
        />

        {/* 2. Funnel Progress and Stage Filters */}
        <PortalFunnelProgress
          stages={portalData.funnelStages}
          selectedStage={selectedStage}
          onSelectStage={setSelectedStage}
          totalDeliverables={totalDeliverables}
          completedDeliverables={completedDeliverables}
        />

        {/* 3. Interactive Timeline of Deliverables */}
        <PortalDeliverablesList
          items={portalData.deliverables}
          selectedStage={selectedStage}
          onSelectItem={setSelectedItem}
          onApproveItem={handleApprove}
        />

        {/* 4. Bottom Metrics Summary & Support */}
        <PortalMetricsSummary
          trafficStatus={portalData.trafficStatus}
          weeklyPacing={portalData.weeklyPacing}
          whatsappSupportNumber={portalData.whatsappSupportNumber}
          companyName={portalData.companyName}
        />
      </div>

      {/* Detail Modal for Script Reading & Approval */}
      <PortalItemDetailModal
        item={selectedItem}
        isOpen={Boolean(selectedItem)}
        onClose={() => setSelectedItem(null)}
        onApprove={handleApprove}
        onRequestRevision={handleRequestRevision}
        isApproving={approveMutation.isPending}
      />
    </div>
  );
};

export default ClientPortal;
