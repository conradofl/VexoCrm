// Credenciais do master admin para a suíte E2E.
// NUNCA hardcodar credenciais aqui ou nos specs (já aconteceu; a senha antiga
// está no histórico do git e precisa ser rotacionada).
// Uso: E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npx playwright test

export const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "";
export const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";

if (!E2E_ADMIN_EMAIL || !E2E_ADMIN_PASSWORD) {
  throw new Error(
    "Defina E2E_ADMIN_EMAIL e E2E_ADMIN_PASSWORD no ambiente antes de rodar a suíte E2E."
  );
}
