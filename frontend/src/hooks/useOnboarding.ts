import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

export interface OnboardingTemplate {
  name: string;
  message: string;
  trigger_type: string;
  trigger_value: number;
  trigger_unit: string;
  trigger_direction: string | null;
  order_index: number;
}

export interface OnboardingPayload {
  company_name: string;
  evolution_instance: string;
  webhook_url: string;
  panel_access: boolean;
  user_email: string;
  user_name: string;
  create_user: boolean;
  campaign_name: string;
  campaign_description: string;
  default_origin: string;
  templates: OnboardingTemplate[];
}

export interface OnboardingResult {
  success: true;
  company_id: string;
  campaign_id: string;
  webhook_url: string;
  webhook_secret: string;
  templates_created: number;
}

export function useOnboarding() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OnboardingResult | null>(null);

  async function submitOnboarding(payload: OnboardingPayload): Promise<OnboardingResult | null> {
    setIsLoading(true);
    setError(null);
    try {
      const token = await user?.getIdToken();
      const body: Record<string, unknown> = {
        company_name: payload.company_name,
        evolution_instance: payload.evolution_instance,
        campaign_name: payload.campaign_name,
        templates: payload.templates,
      };
      if (payload.webhook_url) body.webhook_url = payload.webhook_url;
      if (payload.panel_access) body.panel_access = true;
      if (payload.campaign_description) body.campaign_description = payload.campaign_description;
      if (payload.default_origin) body.default_origin = payload.default_origin;
      if (payload.create_user && payload.user_email) {
        body.user_email = payload.user_email;
        if (payload.user_name) body.user_name = payload.user_name;
      }

      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || "Erro ao criar cliente");
      }

      setResult(data as OnboardingResult);
      return data as OnboardingResult;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  function reset() {
    setError(null);
    setResult(null);
  }

  return { submitOnboarding, isLoading, error, result, reset };
}
