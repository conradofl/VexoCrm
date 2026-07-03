-- Fix: adiciona política permissiva para leitura na tabela leads unificada
-- para que as rotas da API que utilizam supabase-js (com anon key) possam ler os dados.

CREATE POLICY "Allow read leads"
  ON public.leads FOR SELECT
  TO anon, authenticated
  USING (true);
