// frontend/src/hooks/useSmartLinkAlerts.ts
// Hook de Alertas e Notificações em Tempo Real de Cliques em Smart Links (Vexo OS)
// Executa polling a cada 10s no endpoint live-feed e exibe Toasts prioritários com ação de WhatsApp.

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchApi, readApiJson } from "@/lib/api";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";

export interface SmartLinkLiveClick {
  click_id: string;
  clicked_at: string;
  device_type: "mobile" | "tablet" | "desktop" | "outro" | string;
  ip_address: string | null;
  code: string;
  destination_url: string;
  link_title: string | null;
  clicks_count: number;
  lead_id: string | null;
  lead_nome: string | null;
  lead_telefone: string | null;
  lead_stage: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
}

interface LiveFeedResponse {
  clicks: SmartLinkLiveClick[];
}

/**
 * Toca um sinal sonoro suave via Web Audio API para alertar o operador sem ser estridente.
 */
export function playSoftChime() {
  try {
    if (typeof window === "undefined") return;
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    // Duas notas harmônicas ascendentes suaves (C5 523Hz -> G5 784Hz)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.12);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.45);
  } catch {
    // Falha silenciosa caso o navegador restrinja áudio antes de interação
  }
}

/**
 * Limpa e formata o telefone para link do WhatsApp internacional.
 * @param phone
 * @returns Digitos limpos ou null
 */
export function formatPhoneForWhatsApp(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;

  // Se já tiver DDI (ex: 55...)
  if (digits.startsWith("55") && digits.length >= 12) {
    return digits;
  }
  // Se for celular brasileiro sem DDI (10 ou 11 dígitos)
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return digits;
}

/**
 * Hook global de escuta de cliques em tempo real por tenant.
 */
export function useSmartLinkAlerts() {
  const crmContext = useOptionalCrmClient();
  const clientId = crmContext?.selectedClientId || "";

  const lastSeenTimestampRef = useRef<string | null>(null);
  const seenClickIdsRef = useRef<Set<string>>(new Set());
  const hasInitializedRef = useRef<boolean>(false);

  // Reseta ao trocar de tenant selecionado
  useEffect(() => {
    lastSeenTimestampRef.current = null;
    seenClickIdsRef.current = new Set();
    hasInitializedRef.current = false;
  }, [clientId]);

  const query = useQuery({
    queryKey: ["smart-links", "live-feed", clientId],
    queryFn: async () => {
      if (!clientId) return { clicks: [] };

      const params = new URLSearchParams({
        clientId,
        limit: "15",
      });

      if (lastSeenTimestampRef.current) {
        params.set("since", lastSeenTimestampRef.current);
      }

      const res = await fetchApi(`/api/smart-links/live-feed?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Erro ao buscar feed de links (${res.status})`);
      }
      return readApiJson<LiveFeedResponse>(res, "smart-links live feed");
    },
    enabled: Boolean(clientId),
    refetchInterval: 10000, // Polling a cada 10 segundos
    refetchIntervalInBackground: false,
    staleTime: 5000,
  });

  const clicks = query.data?.clicks || [];

  useEffect(() => {
    if (!clicks || clicks.length === 0) return;

    // Na primeira carga, apenas marca os cliques existentes como vistos
    // para não disparar enxurrada de toasts com acessos antigos
    if (!hasInitializedRef.current) {
      clicks.forEach((c) => {
        seenClickIdsRef.current.add(c.click_id);
      });
      if (clicks[0]?.clicked_at) {
        lastSeenTimestampRef.current = clicks[0].clicked_at;
      }
      hasInitializedRef.current = true;
      return;
    }

    // Identifica novos cliques ainda não notificados (ordena do mais antigo para o mais novo)
    const newClicks = clicks
      .filter((c) => !seenClickIdsRef.current.has(c.click_id))
      .reverse();

    if (newClicks.length === 0) return;

    newClicks.forEach((click) => {
      seenClickIdsRef.current.add(click.click_id);

      const leadNome = click.lead_nome ? click.lead_nome.trim() : "Lead Interessado";
      const linkTitle = click.link_title ? click.link_title.trim() : "Proposta";
      const cleanPhone = formatPhoneForWhatsApp(click.lead_telefone);

      // Toca áudio suave
      playSoftChime();

      // Dispara Toast de alta prioridade
      toast(`🔥 Lead Quente no Link!`, {
        description: `${leadNome} acabou de abrir "${linkTitle}"!`,
        action: cleanPhone
          ? {
              label: "Falar no WhatsApp",
              onClick: () => {
                window.open(`https://wa.me/${cleanPhone}`, "_blank", "noopener,noreferrer");
              },
            }
          : undefined,
        duration: 10000,
        className: "border-amber-500/40 bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100",
      });
    });

    // Atualiza timestamp de corte para próximas requisições
    if (clicks[0]?.clicked_at) {
      lastSeenTimestampRef.current = clicks[0].clicked_at;
    }
  }, [clicks]);

  return {
    clicks,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
