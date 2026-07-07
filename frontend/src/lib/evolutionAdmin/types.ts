export interface EvolutionInstanceRow {
  id: string;
  client_id: string;
  client_name: string;
  name: string;
  dispatch_webhook_url: string | null;
  has_dispatch_webhook_token: boolean;
  has_inbound_bearer_token: boolean;
  active: boolean;
  is_default: boolean;
  chip_state: "cold" | "warm";
  daily_limit_override: number | null;
  updated_at: string | null;
  updated_by_email?: string | null;
}

export interface LegacySettingsRow {
  client_id: string;
  client_name: string;
  dispatch_webhook_url: string | null;
  has_dispatch_webhook_token: boolean;
  has_inbound_bearer_token: boolean;
  active: boolean;
  chatbot_enabled: boolean;
  chatbot_model: string | null;
  sdr_whatsapp_number: string | null;
  updated_at: string | null;
}

export interface FollowupCompanyRow {
  id: string;
  name: string;
  evolution_instance: string | null;
  webhook_url: string | null;
  panel_access: boolean;
  updated_at: string | null;
}

export interface TenantOption {
  id: string;
  name: string;
}

export interface RemoteEvolutionInstanceRow {
  name: string;
  display_name: string | null;
  status: string | null;
  integration: string | null;
  owner_jid: string | null;
  webhook_url: string | null;
  dispatch_webhook_url: string | null;
  updated_at: string | null;
  local_instance_id: string | null;
  local_client_id: string | null;
  local_client_name: string | null;
}

export interface EvolutionInventory {
  env: {
    evolutionApiUrl: string | null;
    hasEvolutionApiKey: boolean;
    dispatchJsonFallbacks: { key: string; configured: boolean }[];
    tenantFallbacks: { key: string; value: string | null; configured: boolean; secret: boolean }[];
  };
  tenants: TenantOption[];
  remoteInstances: {
    configured: boolean;
    error: string | null;
    skipped?: boolean;
    items: RemoteEvolutionInstanceRow[];
  };
  instances: EvolutionInstanceRow[];
  legacySettings: LegacySettingsRow[];
  followupCompanies: FollowupCompanyRow[];
  bulkResult?: {
    evolutionInstancesUpdated: number;
    legacySettingsUpdated: number;
    dispatchTokenUpdated: boolean;
  };
}

export type EditTarget =
  | { type: "instance"; row: EvolutionInstanceRow }
  | { type: "legacy"; row: LegacySettingsRow }
  | { type: "followup"; row: FollowupCompanyRow }
  | { type: "remote"; row: RemoteEvolutionInstanceRow };

export interface EditForm {
  name: string;
  dispatchWebhookUrl: string;
  dispatchWebhookToken: string;
  inboundBearerToken: string;
  active: boolean;
  tenantId: string;
  isDefault: boolean;
  evolutionInstance: string;
  webhookUrl: string;
}
