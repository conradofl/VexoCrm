// frontend/src/test/sdrNumbersDialog.test.tsx
//
// "O Editar lista para de jogar o usuário na tela velha" — diálogo inline,
// reaproveitando sdr_whatsapp_numbers (mesmo endpoint de Padrões da
// empresa). Teste central: abrir o diálogo, adicionar um número, salvar, e
// provar que quem lê a lista (o passo 5) mostra o número novo SEM recarregar
// a página — react-query de verdade, não um rerender forçado pelo teste.

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/components/ui/use-toast", () => ({ toast: vi.fn() }));

const getIdTokenMock = async () => "token";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: getIdTokenMock, isAuthenticated: true }),
}));

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// readApiJson exige um Response de verdade (checa content-type) — os mocks
// de fetchApi precisam imitar isso, senão o parse falha silenciosamente e o
// react-query engole o erro num estado vazio.
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("SdrNumbersDialog — isolado", () => {
  let fetchApiMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    fetchApiMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).includes("/n8n-settings") && options?.method === "PATCH") {
        const body = JSON.parse(options.body as string);
        return jsonResponse({ item: { sdr_whatsapp_numbers: body.sdrWhatsappNumbers } });
      }
      return jsonResponse({});
    });
    vi.doMock("@/lib/api", async (importOriginal) => {
      const actual: any = await importOriginal();
      return { ...actual, fetchApi: fetchApiMock };
    });
  });

  it("[TESTE OBRIGATÓRIO] abrir o diálogo, adicionar um número, salvar — chama o MESMO endpoint sdr_whatsapp_numbers, sem rota nova", async () => {
    const { SdrNumbersDialog } = await import("@/components/agente/SdrNumbersDialog");
    renderWithProviders(<SdrNumbersDialog tenantId="sonhare" numbers={["5534910000001"]} />);

    fireEvent.click(screen.getByRole("button", { name: "Editar lista" }));
    expect(screen.getByText("5534910000001")).toBeTruthy();

    const input = screen.getByPlaceholderText("5511999999999");
    fireEvent.change(input, { target: { value: "5534920000002" } });
    const plusButton = screen.getByRole("button", { name: "Adicionar número" });
    fireEvent.click(plusButton!);

    await waitFor(() => expect(fetchApiMock).toHaveBeenCalled());
    const call = fetchApiMock.mock.calls.find(([url]: [string]) => String(url).includes("/n8n-settings"));
    expect(call[0]).toContain("/api/lead-clients/sonhare/n8n-settings");
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.sdrWhatsappNumbers).toEqual(["5534910000001", "5534920000002"]);
  });

  it("número inválido não habilita o botão de adicionar", async () => {
    const { SdrNumbersDialog } = await import("@/components/agente/SdrNumbersDialog");
    renderWithProviders(<SdrNumbersDialog tenantId="sonhare" numbers={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar lista" }));

    const input = screen.getByPlaceholderText("5511999999999");
    fireEvent.change(input, { target: { value: "123" } });

    expect(screen.getByText(/Número inválido/)).toBeTruthy();
    const plusButton = screen.getByRole("button", { name: "Adicionar número" });
    expect(plusButton).toHaveProperty("disabled", true);
  });

  it("remover um número chama o endpoint com a lista filtrada", async () => {
    const { SdrNumbersDialog } = await import("@/components/agente/SdrNumbersDialog");
    renderWithProviders(<SdrNumbersDialog tenantId="sonhare" numbers={["5534910000001", "5534920000002"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar lista" }));

    const row = screen.getByText("5534910000001").closest("div")!;
    fireEvent.click(row.querySelector("button")!);

    await waitFor(() => expect(fetchApiMock).toHaveBeenCalled());
    const call = fetchApiMock.mock.calls.find(([url]: [string]) => String(url).includes("/n8n-settings"));
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.sdrWhatsappNumbers).toEqual(["5534920000002"]);
  });

  it("reabrir o diálogo parte da lista de verdade (prop numbers), não de uma edição anterior não salva", async () => {
    const { SdrNumbersDialog } = await import("@/components/agente/SdrNumbersDialog");
    const { rerender } = renderWithProviders(<SdrNumbersDialog tenantId="sonhare" numbers={["5534910000001"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar lista" }));
    expect(screen.getByText("5534910000001")).toBeTruthy();

    // fecha sem salvar, a prop muda por fora (como aconteceria após um refetch)
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={qc}>
        <SdrNumbersDialog tenantId="sonhare" numbers={["5534910000001", "5534999999999"]} />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Editar lista" }));
    expect(screen.getByText("5534999999999")).toBeTruthy();
  });
});

describe("SdrNumbersDialog + quem lê a lista — integração real de react-query", () => {
  it("[TESTE OBRIGATÓRIO — central] salvar no diálogo atualiza quem lê a lista, sem recarregar a página", async () => {
    vi.resetModules();
    let serverNumbers = ["5534910000001"];
    const fetchApiMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).includes("/api/lead-clients") && (!options || options.method === undefined)) {
        // GET /api/lead-clients — usado por useLeadClients()
        return jsonResponse({
          items: [{ id: "sonhare", name: "Sonhare", n8n_settings: { sdr_whatsapp_numbers: serverNumbers } }],
        });
      }
      if (String(url).includes("/n8n-settings") && options?.method === "PATCH") {
        const body = JSON.parse(options.body as string);
        serverNumbers = body.sdrWhatsappNumbers;
        return jsonResponse({ item: { sdr_whatsapp_numbers: serverNumbers } });
      }
      return jsonResponse({});
    });
    vi.doMock("@/lib/api", async (importOriginal) => {
      const actual: any = await importOriginal();
      return { ...actual, fetchApi: fetchApiMock };
    });

    const { SdrNumbersDialog } = await import("@/components/agente/SdrNumbersDialog");
    const { useLeadClients } = await import("@/hooks/useLeadClients");

    // "quem lê a lista" — o mesmo tipo de leitura que o passo 5 faz
    // (sdrNumbersDoTenant), com o REAL useLeadClients, não mockado.
    function StepFiveNumbersDisplay() {
      const { data: clients = [] } = useLeadClients();
      const numbers = clients.find((c: any) => c.id === "sonhare")?.n8n_settings?.sdr_whatsapp_numbers ?? [];
      return (
        <div data-testid="lista-passo-5">
          {numbers.map((n: string) => (
            <span key={n}>{n}</span>
          ))}
        </div>
      );
    }

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <StepFiveNumbersDisplay />
        <SdrNumbersDialog tenantId="sonhare" numbers={serverNumbers} />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByTestId("lista-passo-5").textContent).toContain("5534910000001"));
    expect(screen.getByTestId("lista-passo-5").textContent).not.toContain("5534977778888");

    fireEvent.click(screen.getByRole("button", { name: "Editar lista" }));
    const input = screen.getByPlaceholderText("5511999999999");
    fireEvent.change(input, { target: { value: "5534977778888" } });
    const plusButton = screen.getByRole("button", { name: "Adicionar número" });
    fireEvent.click(plusButton!);

    // sem chamar render()/rerender() de novo — só esperar o efeito da
    // invalidação de ["lead-clients"] se propagar pelo QueryClient real.
    await waitFor(() => {
      expect(screen.getByTestId("lista-passo-5").textContent).toContain("5534977778888");
    });
  });
});
