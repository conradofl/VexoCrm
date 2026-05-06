export function resolveRequiredAuthorizedClientId({
  req,
  res,
  requestedClientId,
  resolveAuthorizedClientId,
  sendError,
  missingCode = "MISSING_CLIENT_SCOPE",
  missingMessage = "clientId is required for this operation",
}) {
  const clientId = resolveAuthorizedClientId(req, res, requestedClientId);

  if (!clientId && !res.headersSent) {
    sendError(res, 400, missingCode, missingMessage);
  }

  return clientId;
}
