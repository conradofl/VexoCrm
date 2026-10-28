import { defineConfig } from "vitest/config";

// Sem este arquivo o backend rodava no padrão do vitest (5 s por teste). Os testes em Postgres real (pglite) levam de 1 a
// 6 s quando a máquina está ocupada e, com a suíte em paralelo, estouravam por timeout sem relação com o código. O frontend
// recebeu o mesmo ajuste no PR #162 (testTimeout de 15 s). Não muda quais testes rodam nem o que cada um afirma.
export default defineConfig({
  test: {
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
