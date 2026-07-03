import dotenv from "dotenv";
dotenv.config();
import { createDatabasePool } from "../src/pgSupabaseCompat.js";

const pool = createDatabasePool(process.env.DATABASE_URL);
const query = (text, params) => pool.query(text, params);

// Números reais da equipe para recebimento dos testes
const TEAM_NUMBERS = [
  { nome: "Conrado Finzi", telefone: "5534997817660" },
  { nome: "Luiz", telefone: "5534991614690" },
  { nome: "Caio", telefone: "5534997719779" },
  { nome: "Priscila", telefone: "5534996554075" }
];

const PERFIS = ["Sertanejo", "Eletrônica", "Funk", "Rock", "Pagode"];

// Função para gerar data aleatória
function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

async function seedDatabase() {
  console.log("Iniciando geração de 10.000 leads mockados direto na tabela unificada 'leads'...");
  const leads = [];

  // Adiciona a equipe primeiro (Forçando inatividade e aniversário para testes)
  const hoje = new Date();
  TEAM_NUMBERS.forEach(member => {
    leads.push({
      nome: member.nome,
      telefone: member.telefone,
      perfil_musical: PERFIS[Math.floor(Math.random() * PERFIS.length)],
      ultima_visita: new Date(hoje.getFullYear(), hoje.getMonth() - 7, 1), // Inativo há 7 meses (Ativa Esteira 4)
      data_nascimento: new Date(1990, hoje.getMonth(), hoje.getDate()), // Aniversário hoje (Ativa Esteira 3)
      client_id: "livpub" // <-- CORRIGIDO PARA O NOME EXATO!
    });
  });

  // Gera os 10k fictícios
  for (let i = 0; i < 10000; i++) {
    const ddd = "34";
    const num = Math.floor(Math.random() * 90000000) + 10000000; 
    
    leads.push({
      nome: `Lead Teste ${i}`,
      telefone: `55${ddd}9${num}`, // Higienização padrão DDI + DDD
      perfil_musical: PERFIS[Math.floor(Math.random() * PERFIS.length)],
      ultima_visita: randomDate(new Date(2025, 0, 1), hoje),
      data_nascimento: randomDate(new Date(1980, 0, 1), new Date(2005, 0, 1)),
      client_id: "livpub" // <-- CORRIGIDO!
    });
  }

  // Insere em blocos de 1.000 para não travar o banco
  const chunkSize = 1000;
  for (let i = 0; i < leads.length; i += chunkSize) {
    const chunk = leads.slice(i, i + chunkSize);
    const values = chunk.map(l => `('${l.nome}', '${l.telefone}', '${l.perfil_musical}', '${l.ultima_visita.toISOString()}', '${l.data_nascimento.toISOString()}', '${l.client_id}')`).join(',');
    
    await query(`
      INSERT INTO leads (nome, telefone, perfil_musical, ultima_visita, data_nascimento, client_id)
      VALUES ${values}
      ON CONFLICT (client_id, telefone) DO NOTHING;
    `);
    console.log(`Lote inserido: ${Math.min(i + chunkSize, leads.length)} / ${leads.length}`);
  }

  console.log("✅ Seed finalizado com sucesso!");
  process.exit(0);
}

seedDatabase();
