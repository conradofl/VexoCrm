import React from "react";
import { PageShell } from "@/components/PageShell";
import { GeracaoDigitalTabs } from "@/components/GeracaoDigitalTabs";
import { ContractsList } from "./ContractsList";

export default function GeracaoDigitalContracts() {
  return (
    <PageShell
      title="Contratos GD"
      description="Gerenciamento de contratos gerados a partir das propostas."
    >
      <GeracaoDigitalTabs />
      
      <div className="mt-6">
        <ContractsList />
      </div>
    </PageShell>
  );
}
