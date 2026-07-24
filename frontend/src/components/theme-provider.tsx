import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextThemesProvider
      attribute="class"
      // Claro é o padrão do produto. Telas como o pitch da Geração Digital são
      // desenhadas só em claro (nenhuma variante `dark:`), então um usuário novo
      // caindo em escuro via tokens globais escurecerem inputs e painéis dentro
      // de uma página branca. Quem já usa o sistema tem a preferência salva no
      // localStorage e não é afetado.
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
