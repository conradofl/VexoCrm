  CREATE TABLE public.access_profiles (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    description TEXT,
    role TEXT NOT NULL,
    scope_mode TEXT NOT NULL DEFAULT 'assigned_clients',
    approval_level TEXT NOT NULL DEFAULT 'none',
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    internal_pages JSONB NOT NULL DEFAULT '[]'::jsonb,
    allowed_views JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_system BOOLEAN NOT NULL DEFAULT false,
    is_locked BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  INSERT INTO public.access_profiles (
    key,
    label,
    description,
    role,
    scope_mode,
    approval_level,
    permissions,
    internal_pages,
    allowed_views,
    is_system,
    is_locked
  )
  VALUES
    (
      'internal_admin',
      'Admin interno',
      'Acesso total ao CRM e administracao do ambiente.',
      'internal',
      'all_clients',
      'director',
      '["dashboard.view","leads.view","leads.export","imports.manage","whatsapp.view","whatsapp.reply","campaigns.manage","agente.view","users.view","users.manage"]'::jsonb,
      '["dashboard","leads","planilhas","whatsapp","agente","usuarios","campanhas"]'::jsonb,
      '[]'::jsonb,
      true,
      true
    ),
    (
      'internal_manager',
      'Gestor interno',
      'Gestao operacional com acesso ampliado aos modulos internos.',
      'internal',
      'assigned_clients',
      'manager',
      '["dashboard.view","leads.view","leads.export","imports.manage","whatsapp.view","whatsapp.reply","campaigns.manage","agente.view","users.view"]'::jsonb,
      '["dashboard","leads","planilhas","whatsapp","agente","usuarios","campanhas"]'::jsonb,
      '[]'::jsonb,
      true,
      false
    ),
    (
      'internal_operator',
      'Operacao interna',
      'Operacao padrao do CRM para times internos.',
      'internal',
      'assigned_clients',
      'operator',
      '["dashboard.view","leads.view","imports.manage","whatsapp.view","whatsapp.reply"]'::jsonb,
      '["dashboard","leads","planilhas","whatsapp"]'::jsonb,
      '[]'::jsonb,
      true,
      false
    ),
    (
      'client_manager',
      'Gestor do cliente',
      'Perfil de cliente com acesso expandido ao portal.',
      'client',
      'assigned_clients',
      'manager',
      '["dashboard.view","leads.view","leads.export","imports.manage","whatsapp.view","whatsapp.reply"]'::jsonb,
      '[]'::jsonb,
      '["dashboard","leads","planilhas","whatsapp"]'::jsonb,
      true,
      false
    ),
    (
      'client_operator',
      'Operador do cliente',
      'Perfil de cliente operacional para uso diario.',
      'client',
      'assigned_clients',
      'operator',
      '["dashboard.view","leads.view","whatsapp.view","whatsapp.reply"]'::jsonb,
      '[]'::jsonb,
      '["dashboard","leads","whatsapp"]'::jsonb,
      true,
      false
    ),
    (
      'client_viewer',
      'Leitura do cliente',
      'Perfil de cliente com acesso de leitura.',
      'client',
      'assigned_clients',
      'none',
      '["dashboard.view","leads.view"]'::jsonb,
      '[]'::jsonb,
      '["dashboard","leads"]'::jsonb,
      true,
      false
    ),
    (
      'pending',
      'Aguardando aprovacao',
      'Conta ainda sem liberacao operacional.',
      'pending',
      'no_client_access',
      'none',
      '[]'::jsonb,
      '[]'::jsonb,
      '[]'::jsonb,
      true,
      false
    )
  ON CONFLICT (key) DO NOTHING;

  ALTER TABLE public.access_profiles ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "Deny all direct access to access_profiles"
  ON public.access_profiles
  FOR ALL
  USING (false);
