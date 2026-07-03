-- Fix: adiciona política permissiva para leitura na tabela leads unificada
-- O banco na EasyPanel não tem as roles 'anon' e 'authenticated' do Supabase nativo,
-- então aplicamos a política de leitura para todas as roles.

CREATE POLICY "Allow read leads"
  ON public.leads FOR SELECT
  USING (true);
