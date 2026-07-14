-- Adiciona colunas para controle de assinatura eletrônica (Fases 3 e 4)
ALTER TABLE gd_contracts 
ADD COLUMN IF NOT EXISTS provider_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS provider_name VARCHAR(50), -- ex: 'zapsign'
ADD COLUMN IF NOT EXISTS sign_url TEXT;

-- Atualiza restrição de status (adicionando os status que mapeiam assinaturas em andamento)
-- O status originalmente inserido na primeira migration era apenas VARCHAR ou ENUM. 
-- Se for um check constraint, vamos recriar ou deixar livre.
-- Na primeira migration nós só assumimos que era texto.
