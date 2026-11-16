// Harness do formulário de diagnóstico da landing (vexoia.com) em Chromium de verdade.
// Renderiza a PÁGINA real (src/pages/LandingPage.tsx) com o modal real. De mentira só
// quem está logado (stubs/AuthContext) e o servidor (o teste responde a /api/**).
// Os parâmetros de campanha vêm da URL deste HTML, como na chegada por anúncio.
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "@/index.css";
import LandingPage from "@/pages/LandingPage";

createRoot(document.getElementById("root")!).render(
  <MemoryRouter initialEntries={["/"]}>
    <LandingPage />
  </MemoryRouter>
);
