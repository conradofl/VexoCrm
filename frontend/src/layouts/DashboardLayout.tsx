// frontend/src/layouts/DashboardLayout.tsx
// Layout principal do painel do Vexo OS integrando monitoramento de alertas em tempo real.

import React from "react";
import { useSmartLinkAlerts } from "@/hooks/useSmartLinkAlerts";
import { MainLayout } from "@/components/MainLayout";

export function DashboardLayout() {
  useSmartLinkAlerts();
  return <MainLayout />;
}

export default DashboardLayout;
