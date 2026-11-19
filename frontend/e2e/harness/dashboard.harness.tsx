// Harness do Dashboard (página REAL, com os hooks reais) para abrir em Chromium de verdade.
// O servidor é de mentira: o teste responde a /api/** pelo Playwright.
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import Dashboard from "@/pages/Dashboard";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <MemoryRouter>
      <Dashboard fixedClientId="geracao-digital" fixedClientName="Geração Digital" />
    </MemoryRouter>
  </QueryClientProvider>
);
