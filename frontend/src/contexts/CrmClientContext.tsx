import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLeadClients, type LeadClient } from "@/hooks/useLeadClients";
import { CrmClientContext, type CrmClientContextValue } from "@/contexts/crm-client-context";

const STORAGE_KEY = "vexo.crm.selected-client";

export function CrmClientProvider({ children }: { children: ReactNode }) {
  const { isInternalUser, clientId, clientIds, canAccessClient } = useAuth();
  const { data: clients = [], isLoading, error } = useLeadClients();
  const [selectedClientId, setSelectedClientIdState] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(STORAGE_KEY) || "";
  });

  const visibleClients = useMemo(() => {
    if (!isInternalUser) return [];
    return clients.filter((item) => canAccessClient(item.id));
  }, [canAccessClient, clients, isInternalUser]);

  useEffect(() => {
    if (isLoading) return;

    if (!visibleClients.length) {
      const fallbackClientId = clientId || clientIds[0] || "";
      setSelectedClientIdState((current) => current || fallbackClientId);
      return;
    }

    const storedValue =
      typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    const preferredId = storedValue || clientId || visibleClients[0]?.id || "";
    const resolvedClient = visibleClients.find((item) => item.id === preferredId) || visibleClients[0];

    setSelectedClientIdState((current) => {
      if (current && visibleClients.some((item) => item.id === current)) {
        return current;
      }
      return resolvedClient?.id || "";
    });
  }, [clientId, clientIds, isLoading, visibleClients]);

  useEffect(() => {
    if (!selectedClientId || typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, selectedClientId);
  }, [selectedClientId]);

  const setSelectedClientId = (nextClientId: string) => {
    setSelectedClientIdState(nextClientId);
  };

  const value = useMemo<CrmClientContextValue>(
    () => ({
      clients: visibleClients,
      selectedClientId,
      selectedClient: visibleClients.find((item) => item.id === selectedClientId) || null,
      isLoading,
      error: error instanceof Error ? error : null,
      setSelectedClientId,
    }),
    [error, isLoading, selectedClientId, visibleClients],
  );

  return <CrmClientContext.Provider value={value}>{children}</CrmClientContext.Provider>;
}
