import { describe, expect, it, vi } from "vitest";
import { resolveRequiredAuthorizedClientId } from "../tenantScope.js";

function makeResponse() {
  return {
    headersSent: false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

describe("tenant scope enforcement", () => {
  it("blocks access when the requested tenant is outside the authorized tenant list", () => {
    const req = {
      authAccess: {
        role: "internal",
        scopeMode: "assigned_clients",
        clientIds: ["tenant-a"],
      },
    };
    const res = makeResponse();
    const sendError = vi.fn((response, status, code, message) => {
      response.status(status).json({ error: { code, message } });
    });
    const resolveAuthorizedClientId = vi.fn((request, response, requestedClientId) => {
      if (!request.authAccess.clientIds.includes(requestedClientId)) {
        sendError(response, 403, "FORBIDDEN_CLIENT_SCOPE", "You do not have access to this client");
        response.headersSent = true;
        return null;
      }
      return requestedClientId;
    });

    const clientId = resolveRequiredAuthorizedClientId({
      req,
      res,
      requestedClientId: "tenant-b",
      resolveAuthorizedClientId,
      sendError,
    });

    expect(clientId).toBeNull();
    expect(resolveAuthorizedClientId).toHaveBeenCalledWith(req, res, "tenant-b");
    expect(sendError).toHaveBeenCalledWith(
      res,
      403,
      "FORBIDDEN_CLIENT_SCOPE",
      "You do not have access to this client"
    );
    expect(sendError).toHaveBeenCalledTimes(1);
  });

  it("requires an explicit or derived tenant before continuing", () => {
    const req = { authAccess: { role: "internal", scopeMode: "all_clients", clientIds: [] } };
    const res = makeResponse();
    const sendError = vi.fn();
    const resolveAuthorizedClientId = vi.fn(() => null);

    const clientId = resolveRequiredAuthorizedClientId({
      req,
      res,
      requestedClientId: "",
      resolveAuthorizedClientId,
      sendError,
    });

    expect(clientId).toBeNull();
    expect(sendError).toHaveBeenCalledWith(
      res,
      400,
      "MISSING_CLIENT_SCOPE",
      "clientId is required for this operation"
    );
  });
});
