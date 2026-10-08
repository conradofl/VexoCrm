-- Migration: 20261008190000_add_lead_campos_index.sql
-- Pilar 4: Índice GIN para consultas e filtros otimizados em dados.campos (campos comerciais customizados e extraídos por IA)

CREATE INDEX IF NOT EXISTS idx_leads_dados_campos ON public.leads USING gin ((dados->'campos'));
COMMENT ON INDEX idx_leads_dados_campos IS 'Índice GIN para filtros de alto desempenho sobre campos personalizados do lead em dados.campos';
