#!/usr/bin/env node
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const firebase = {
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
};

initializeApp({
  credential: cert(firebase),
});

const auth = getAuth();

async function checkUserPermissions(email) {
  try {
    const user = await auth.getUserByEmail(email);

    console.log('\n📋 DADOS DO USUÁRIO');
    console.log('==================');
    console.log(`Email: ${user.email}`);
    console.log(`UID: ${user.uid}`);
    console.log(`Status: ${user.disabled ? '🔴 DESATIVADO' : '🟢 ATIVO'}`);
    console.log(`Criado em: ${new Date(user.metadata.creationTime).toLocaleString('pt-BR')}`);
    console.log(`Último login: ${user.metadata.lastSignInTime ? new Date(user.metadata.lastSignInTime).toLocaleString('pt-BR') : 'Nunca'}`);

    console.log('\n🔐 CUSTOM CLAIMS');
    console.log('================');
    const claims = user.customClaims || {};
    console.log(JSON.stringify(claims, null, 2));

    if (claims.accessPreset) {
      console.log('\n✅ Preset de Acesso:', claims.accessPreset);
    }
    if (claims.permissions) {
      console.log('\n✅ Permissões:', claims.permissions);
    }
    if (claims.clientIds) {
      console.log('\n✅ Clientes Associados:', claims.clientIds);
    }
    if (claims.internalPages) {
      console.log('\n✅ Páginas Internas:', claims.internalPages);
    }

  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }
}

const email = process.argv[2] || 'conrado.cfl@gmail.com';
console.log(`\n🔍 Verificando permissões para: ${email}\n`);
checkUserPermissions(email);
