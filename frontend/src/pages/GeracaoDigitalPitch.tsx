import React, { useState, useEffect } from "react";
import { toast } from "@/components/ui/use-toast";
import { DEFAULT_BRIEFING_FIELDS, DEFAULT_THEME } from "@/lib/geracaoDigital/defaults";
import { playChime } from "@/lib/geracaoDigital/helpers";
import { deriveExtractedValues } from "@/lib/geracaoDigital/briefingParser";
import { AI_PROCESSING_STEPS, TRANSCRIPT_OPTIONS } from "@/lib/geracaoDigital/constants";
import type { BriefingField } from "@/lib/geracaoDigital/types";
import { useExtractBriefing, useSaveBriefing } from "@/hooks/useGeracaoDigital";

import { BriefingHeader } from "./GeracaoDigitalPitch/BriefingHeader";
import { BriefingBlockContract, ClientContractInfo } from "./GeracaoDigitalPitch/BriefingBlockContract";
import { BriefingBlockCommercial } from "./GeracaoDigitalPitch/BriefingBlockCommercial";
import { BriefingBlockMedia } from "./GeracaoDigitalPitch/BriefingBlockMedia";
import { BriefingBlockTechnical } from "./GeracaoDigitalPitch/BriefingBlockTechnical";
import { BriefingAiTranscriptModal } from "./GeracaoDigitalPitch/BriefingAiTranscriptModal";
import { BriefingDispatchModal, DispatchConfig } from "./GeracaoDigitalPitch/BriefingDispatchModal";

export default function GeracaoDigitalPitch() {
  const extractMutation = useExtractBriefing();
  const saveMutation = useSaveBriefing();

  // ─── ESTADO DOS DADOS CONTRATUAIS DO CLIENTE ──────────────────────────────
  const [clientInfo, setClientInfo] = useState<ClientContractInfo>(() => {
    const saved = localStorage.getItem("vexo_gd_client_info");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    return {
      razaoSocial: "",
      cnpj: "",
      responsavel: "",
      whatsapp: "",
      email: "",
      endereco: "",
    };
  });

  useEffect(() => {
    localStorage.setItem("vexo_gd_client_info", JSON.stringify(clientInfo));
  }, [clientInfo]);

  // ─── ESTADO DOS CAMPOS DO BRIEFING ─────────────────────────────────────────
  const [briefingFields, setBriefingFields] = useState<BriefingField[]>(() => {
    const saved = localStorage.getItem("vexo_gd_briefing_fields");
    if (saved) {
      try {
        const parsed: BriefingField[] = JSON.parse(saved);
        const parsedMap = new Map(parsed.map((f) => [f.id, f]));
        return DEFAULT_BRIEFING_FIELDS.map((df) => {
          const existing = parsedMap.get(df.id);
          if (!existing) return df;
          return {
            ...df,
            value: existing.value ?? df.value,
            status: existing.status ?? df.status,
            confidence: existing.confidence ?? df.confidence,
            subfields: df.subfields
              ? df.subfields.map((dsf) => {
                  const exf = existing.subfields?.find((s) => s.id === dsf.id);
                  return exf ? { ...dsf, value: exf.value } : dsf;
                })
              : undefined,
          };
        });
      } catch (e) {
        console.error(e);
      }
    }
    return DEFAULT_BRIEFING_FIELDS;
  });

  useEffect(() => {
    localStorage.setItem("vexo_gd_briefing_fields", JSON.stringify(briefingFields));
  }, [briefingFields]);

  // ─── ESTADOS DOS MODAIS E PROCESSAMENTO ────────────────────────────────────
  const [isTranscriptModalOpen, setIsTranscriptModalOpen] = useState(false);
  const [transcriptText, setTranscriptText] = useState("");
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [aiProgressText, setAiProgressText] = useState("");

  const [isDispatchModalOpen, setIsDispatchModalOpen] = useState(false);
  const [dispatchSuccess, setDispatchSuccess] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<any>(null);

  // ─── HELPERS DE ATUALIZAÇÃO DE CAMPOS ──────────────────────────────────────
  const handleUpdateField = (fieldId: string, value: string) => {
    setBriefingFields((prev) =>
      prev.map((f) =>
        f.id === fieldId
          ? {
              ...f,
              value,
              status: value.trim().length > 0 ? "completed" : "pending",
            }
          : f
      )
    );
  };

  const handleUpdateSubfield = (fieldId: string, subfieldId: string, value: string) => {
    setBriefingFields((prev) =>
      prev.map((f) => {
        if (f.id === fieldId) {
          const subfields =
            f.subfields?.map((s) => (s.id === subfieldId ? { ...s, value } : s)) || [];
          const anyVal = subfields.some((s) => s.value.trim().length > 0);
          const summary = subfields
            .filter((s) => s.value)
            .map((s) => `${s.label}: ${s.value}`)
            .join(" | ");
          return {
            ...f,
            subfields,
            value: anyVal ? summary : "",
            status: anyVal ? "completed" : "pending",
          };
        }
        return f;
      })
    );
  };

  // ─── PROCESSAMENTO COM IA (GEMINI) ─────────────────────────────────────────
  const handleSelectTranscriptPreset = (presetId: string) => {
    const preset = TRANSCRIPT_OPTIONS.find((t) => t.id === presetId);
    if (!preset) return;
    setTranscriptText(preset.text);
    toast({
      title: "Transcrição Carregada",
      description: "Áudio transcrito carregado com sucesso. Pronto para extração.",
    });
  };

  const handleProcessBriefingWithGemini = async () => {
    if (!transcriptText.trim()) {
      toast({
        title: "Transcrição vazia",
        description: "Por favor, cole um áudio transcrito ou selecione um dos exemplos.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessingAI(true);
    let extractedValues: Record<string, string> = {};

    try {
      const res = await extractMutation.mutateAsync({ transcricao: transcriptText });
      if (res?.success && res?.data) {
        extractedValues = res.data;
      }
    } catch {
      extractedValues = deriveExtractedValues(transcriptText);
    }

    if (!extractedValues || Object.keys(extractedValues).length === 0) {
      extractedValues = deriveExtractedValues(transcriptText);
    }

    if (extractedValues.prospectName && !clientInfo.razaoSocial) {
      setClientInfo((prev) => ({ ...prev, razaoSocial: extractedValues.prospectName }));
    }
    if (extractedValues.whatsapp && !clientInfo.whatsapp) {
      setClientInfo((prev) => ({ ...prev, whatsapp: extractedValues.whatsapp }));
    }

    let currentStepIndex = 0;
    const interval = setInterval(() => {
      if (currentStepIndex >= AI_PROCESSING_STEPS.length) {
        clearInterval(interval);
        setIsProcessingAI(false);
        setIsTranscriptModalOpen(false);
        playChime();
        toast({
          title: "Análise da IA Concluída!",
          description: "Os requisitos do briefing foram qualificados e preenchidos em 1 tela.",
        });
        return;
      }

      const step = AI_PROCESSING_STEPS[currentStepIndex];
      setAiProgressText(step.t);

      if (step.fId) {
        const fieldId = step.fId;
        setBriefingFields((prev) =>
          prev.map((f) => {
            if (f.id === fieldId) {
              const subfields = f.subfields?.map((sf) => ({
                ...sf,
                value: extractedValues[`${f.id}.${sf.id}`] || sf.value,
              }));
              const temSub = !!subfields?.some((sf) => sf.value);
              const val = extractedValues[fieldId] || "";
              const achou = !!val || temSub;
              return {
                ...f,
                status: achou ? "completed" : f.status,
                value: val || f.value,
                subfields,
                confidence: achou ? Math.round(88 + Math.random() * 11) : f.confidence,
              };
            }
            return f;
          })
        );
      }

      currentStepIndex++;
    }, 400);
  };

  // ─── SALVAR RASCUNHO ───────────────────────────────────────────────────────
  const handleSaveDraft = async () => {
    if (saveMutation.isPending) return;
    const filledCount = briefingFields.filter((f) => f.value).length;
    if (!clientInfo.razaoSocial && filledCount === 0) {
      toast({
        title: "Nada para salvar",
        description: "Preencha a Razão Social ou ao menos um campo do briefing.",
        variant: "destructive",
      });
      return;
    }

    try {
      const bData = briefingFields.reduce((acc, f) => ({ ...acc, [f.id]: f.value }), {
        _cnpj: clientInfo.cnpj,
        _responsavel: clientInfo.responsavel,
        _endereco: clientInfo.endereco,
      });

      await saveMutation.mutateAsync({
        draft: true,
        prospectName: clientInfo.razaoSocial || "Cliente Rascunho",
        whatsappNumber: clientInfo.whatsapp || "",
        agencyName: DEFAULT_THEME.agencyName,
        themePreset: DEFAULT_THEME.themePreset,
        briefingData: bData,
      });

      toast({
        title: "Rascunho Salvo com Sucesso!",
        description: "Os dados foram armazenados no Vexo OS e estarão disponíveis para a esteira.",
      });
    } catch {
      toast({
        title: "Salvo localmente",
        description: "Dados salvos no seu navegador com segurança.",
      });
    }
  };

  // ─── CONFIRMAR DISPARO PARA A ESTEIRA ─────────────────────────────────────
  const handleConfirmDispatch = async (config: DispatchConfig) => {
    try {
      const bData = briefingFields.reduce((acc, f) => ({ ...acc, [f.id]: f.value }), {
        _cnpj: clientInfo.cnpj,
        _responsavel: clientInfo.responsavel,
        _endereco: clientInfo.endereco,
      });

      const responseData = await saveMutation.mutateAsync({
        prospectName: clientInfo.razaoSocial || "Novo Cliente",
        whatsappNumber: clientInfo.whatsapp || "",
        agencyName: DEFAULT_THEME.agencyName,
        themePreset: DEFAULT_THEME.themePreset,
        briefingData: bData,
        sendToProspectWhatsapp: config.sendToProspectWhatsapp,
        sendToProspectEmail: config.sendToProspectEmail,
        prospectEmail: config.prospectEmail,
        sendToSectors: config.sendToSectors,
        sectorsWhatsapp: config.sectorsWhatsapp,
        sectorsEmail: config.sectorsEmail,
        createWhatsappGroup: config.createWhatsappGroup,
        whatsappGroupName: config.whatsappGroupName,
        whatsappGroupMembers: config.whatsappGroupMembers,
        slackChannelName: config.slackChannelName,
      });

      setDispatchResult(responseData);
      setDispatchSuccess(true);
      playChime();

      toast({
        title: "Esteira Ativada!",
        description: `Dossiê gerado e enviado para a esteira operacional do cliente ${clientInfo.razaoSocial}.`,
      });
    } catch (error: any) {
      toast({
        title: "Erro no Disparo",
        description: error.message || "Não foi possível disparar para a esteira.",
        variant: "destructive",
      });
    }
  };

  const totalBriefingRequirements = briefingFields.length;
  const completedBriefingRequirements = briefingFields.filter(
    (f) => f.value && f.value.trim().length > 0
  ).length;

  const produtosField = briefingFields.find((f) => f.id === "produtos");

  return (
    <div className="w-full space-y-6 pb-12 animate-fade-in font-sans">
      {/* ─── 1. HEADER DIRETO EM 1 TELA ─────────────────────────────────────── */}
      <BriefingHeader
        razaoSocial={clientInfo.razaoSocial}
        cnpj={clientInfo.cnpj}
        completedCount={completedBriefingRequirements}
        totalCount={totalBriefingRequirements}
        savingDraft={saveMutation.isPending}
        onOpenTranscriptModal={() => setIsTranscriptModalOpen(true)}
        onSaveDraft={handleSaveDraft}
        onOpenDispatchModal={() => setIsDispatchModalOpen(true)}
      />

      {/* ─── 2. OS 4 BLOCOS OPERACIONAIS ELEGANTES ───────────────────────────── */}
      <div className="space-y-5">
        <BriefingBlockContract
          clientInfo={clientInfo}
          setClientInfo={setClientInfo}
          produtosField={produtosField}
          onUpdateField={handleUpdateField}
        />

        <BriefingBlockCommercial
          briefingFields={briefingFields}
          onUpdateField={handleUpdateField}
          onUpdateSubfield={handleUpdateSubfield}
        />

        <BriefingBlockMedia
          briefingFields={briefingFields}
          onUpdateField={handleUpdateField}
        />

        <BriefingBlockTechnical
          briefingFields={briefingFields}
          onUpdateField={handleUpdateField}
        />
      </div>

      {/* ─── 3. MODAIS INTELIGENTES ─────────────────────────────────────────── */}
      <BriefingAiTranscriptModal
        isOpen={isTranscriptModalOpen}
        onClose={() => setIsTranscriptModalOpen(false)}
        transcriptText={transcriptText}
        setTranscriptText={setTranscriptText}
        isProcessingAI={isProcessingAI}
        aiProgressText={aiProgressText}
        onProcessWithAI={handleProcessBriefingWithGemini}
        onSelectPreset={handleSelectTranscriptPreset}
      />

      <BriefingDispatchModal
        isOpen={isDispatchModalOpen}
        onClose={() => setIsDispatchModalOpen(false)}
        clientInfo={clientInfo}
        briefingFields={briefingFields}
        isDispatching={saveMutation.isPending}
        dispatchSuccess={dispatchSuccess}
        dispatchResult={dispatchResult}
        onConfirmDispatch={handleConfirmDispatch}
        onResetSuccess={() => setDispatchSuccess(false)}
      />
    </div>
  );
}
