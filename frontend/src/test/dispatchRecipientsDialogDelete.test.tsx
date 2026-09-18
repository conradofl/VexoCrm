// frontend/src/test/dispatchRecipientsDialogDelete.test.tsx
//
// "A lixeira por lote sai da lista principal. Continua disponível dentro do
// lote aberto" — o delete-lote mora agora só no DispatchRecipientsDialog.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: async () => "token" }),
}));

const recipientsData = {
  dispatchName: "Lote 5",
  campaignName: "Campanha X",
  total: 10,
  sentCount: 10,
  failedCount: 0,
  invalidCount: 0,
  skippedCount: 0,
  pendingCount: 0,
  items: [],
};

vi.mock("@/hooks/useCampanhas", () => ({
  useDispatchRecipients: () => ({ data: recipientsData, isLoading: false, refetch: vi.fn(), isFetching: false }),
  useRetryFailedDispatchLeads: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRunPendingDispatchLeads: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

describe("DispatchRecipientsDialog — Excluir lote", () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    confirmSpy = vi.spyOn(window, "confirm");
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  it("[TESTE OBRIGATÓRIO] botão Excluir lote existe dentro do lote aberto", async () => {
    const { DispatchRecipientsDialog } = await import("@/pages/LeadImports/DispatchRecipientsDialog");
    render(<DispatchRecipientsDialog dispatchId="disp-1" onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Excluir lote/ })).toBeTruthy();
  });

  it("confirmar exclusão chama o DELETE do lote e onDeleted + onClose", async () => {
    confirmSpy.mockReturnValue(true);
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    const { DispatchRecipientsDialog } = await import("@/pages/LeadImports/DispatchRecipientsDialog");
    render(<DispatchRecipientsDialog dispatchId="disp-1" onClose={onClose} onDeleted={onDeleted} />);

    fireEvent.click(screen.getByRole("button", { name: /Excluir lote/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/campaigns/dispatches/disp-1");
    expect(options.method).toBe("DELETE");
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("[TESTE OBRIGATÓRIO] cancelar a confirmação: nada é excluído", async () => {
    confirmSpy.mockReturnValue(false);
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    const { DispatchRecipientsDialog } = await import("@/pages/LeadImports/DispatchRecipientsDialog");
    render(<DispatchRecipientsDialog dispatchId="disp-1" onClose={onClose} onDeleted={onDeleted} />);

    fireEvent.click(screen.getByRole("button", { name: /Excluir lote/ }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
