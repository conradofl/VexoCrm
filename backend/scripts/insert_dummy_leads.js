import dotenv from 'dotenv';
dotenv.config();

import { createDatabasePool } from '../src/pgSupabaseCompat.js';
import crypto from 'crypto';

async function run() {
  const pool = createDatabasePool(process.env.DATABASE_URL);
  
  const dummies = [
    { nome: 'Ana Costa', perfil: 'Sertanejo Universitário', telefone: '5511999990001' },
    { nome: 'Bruno Souza', perfil: 'Eletrônica/House', telefone: '5511999990002' },
    { nome: 'Carlos Mendes', perfil: 'Funk/Trap', telefone: '5511999990003' },
    { nome: 'Daniela Lima', perfil: 'Pagode/Samba', telefone: '5511999990004' },
    { nome: 'Eduardo Silva', perfil: 'Rock Indie', telefone: '5511999990005' },
  ];
  
  for (const lead of dummies) {
    try {
      const q = `INSERT INTO leads_liv_pub (id, client_id, nome, perfil_musical, telefone) VALUES ('${crypto.randomUUID()}', 'umuarama-matcon', '${lead.nome}', '${lead.perfil}', '${lead.telefone}')`;
      await pool.query(q);
      console.log('Inserted dummy lead:', lead.nome);
    } catch(e) {
      console.error(e);
    }
  }
  
  process.exit(0);
}
run();
