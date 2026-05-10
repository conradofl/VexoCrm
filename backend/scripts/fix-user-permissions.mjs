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

async function fixUserPermissions(email) {
  try {
    const user = await auth.getUserByEmail(email);

    console.log(`\n🔧 Corrigindo permissões para: ${email}`);
    console.log(`UID: ${user.uid}\n`);

    // Claims de admin interno completo
    const newClaims = {
      role: 'internal',
      isAdmin: true,
      accessPreset: 'internal_admin',
      scopeMode: 'all_clients',
      approvalLevel: 'director',
      clientId: null,
      clientIds: [],
      tenantId: null,
      tenantIds: [],
      allowedViews: [],
      internalPages: [
        'dashboard',
        'leads',
        'planilhas',
        'whatsapp',
        'agente',
        'usuarios',
        'empresas',
        'campanhas'
      ],
      permissions: [
        'dashboard.view',
        'leads.view',
        'leads.export',
        'imports.manage',
        'whatsapp.view',
        'whatsapp.reply',
        'campaigns.manage',
        'agente.view',
        'tenants.manage',
        'users.view',
        'users.manage'
      ],
      companyName: null
    };

    // Antes
    console.log('❌ ANTES (customClaims):');
    console.log(JSON.stringify(user.customClaims || {}, null, 2));

    // Aplicar novas claims
    await auth.setCustomUserClaims(user.uid, newClaims);

    // Depois
    const updatedUser = await auth.getUser(user.uid);
    console.log('\n✅ DEPOIS (customClaims):');
    console.log(JSON.stringify(updatedUser.customClaims, null, 2));

    console.log('\n🎉 Permissões reconstruídas com sucesso!');
    console.log('\n📌 O usuário precisa fazer logout e login novamente para aplicar as mudanças.');

  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }
}

const email = process.argv[2] || 'luizz.felipe.santos17@gmail.com';
fixUserPermissions(email);
