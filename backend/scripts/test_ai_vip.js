import dotenv from 'dotenv';
dotenv.config();

import { createDatabasePool } from '../src/pgSupabaseCompat.js';
import { generateCampaignCopySuggestion, VIP_SALES_TECHNIQUE } from '../src/campaign-ai.js';

async function run() {
  const pool = createDatabasePool(process.env.DATABASE_URL);
  
  try {
    console.log("Buscando 5 leads com perfil musical na tabela leads_liv_pub...");
    const res = await pool.query(`
      SELECT id, nome, perfil_musical, telefone 
      FROM leads_liv_pub 
      WHERE perfil_musical IS NOT NULL AND perfil_musical != '' 
      LIMIT 5
    `);
    
    const leads = res.rows;
    if (leads.length === 0) {
      console.log("Nenhum lead com perfil_musical encontrado.");
      return;
    }

    console.log(`Encontrados ${leads.length} leads. Iniciando simulação VIP_SALES_TECHNIQUE...`);

    for (const lead of leads) {
      console.log(`\n=================================================`);
      console.log(`Lead: ${lead.nome} | Perfil Musical: ${lead.perfil_musical}`);
      
      const aiInput = {
        campaignName: "Camarote VIP - Venda Exclusiva",
        goal: `Criar uma mensagem de venda para o Camarote VIP. O lead se chama ${lead.nome} e tem o perfil musical focado em: ${lead.perfil_musical}. Personalize a mensagem citando o nome dele e o perfil musical para gerar conexao. Crie um argumento forte de exclusividade e escassez.`,
        style: VIP_SALES_TECHNIQUE.name,
      };

      try {
        console.log("Gerando prompt via LLM (Groq)...");
        const suggestion = await generateCampaignCopySuggestion(aiInput);
        console.log(`\n[Copy Sugerida]:\n${suggestion.copy}\n`);
        console.log(`[Justificativa (Rationale) da IA]:\n${suggestion.rationale}`);
      } catch (err) {
        console.error(`Erro ao gerar copy para ${lead.nome}:`, err.message);
      }
    }
  } catch (err) {
    console.error("Erro no script:", err);
  } finally {
    await pool.end();
  }
}

run();
