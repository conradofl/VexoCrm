/**
 * Script para listar (e opcionalmente deletar) usuarios de teste do Firebase.
 *
 * USO:
 *   FIREBASE_PROJECT_ID=... FIREBASE_CLIENT_EMAIL=... FIREBASE_PRIVATE_KEY="..." \
 *     node scripts/delete-test-users.mjs
 *
 * Por padrao, apenas lista os usuarios a serem deletados.
 * Para deletar de fato, descomente o bloco marcado com "DESCOMENTE" abaixo.
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;

if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
  console.error(
    "Erro: defina FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY antes de rodar."
  );
  process.exit(1);
}

initializeApp({
  credential: cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

const auth = getAuth();

const PROTECTED_EMAILS = new Set([
  "luizz.felipe.santos17@gmail.com",
  "conradofl@gmail.com",
]);

async function listAndDeleteTestUsers() {
  const allUsers = [];
  let pageToken;

  do {
    const result = await auth.listUsers(1000, pageToken);
    allUsers.push(...result.users);
    pageToken = result.pageToken;
  } while (pageToken);

  const toDelete = allUsers.filter(
    (user) => !PROTECTED_EMAILS.has(user.email?.toLowerCase())
  );

  console.log(`Total de usuarios: ${allUsers.length}`);
  console.log(`Usuarios protegidos: ${allUsers.length - toDelete.length}`);
  console.log(`\nUsuarios a deletar (${toDelete.length}):`);
  toDelete.forEach((user) =>
    console.log(`  - ${user.email || "(sem email)"} | UID: ${user.uid}`)
  );

  // DESCOMENTE apenas apos confirmar a lista acima:
  // for (const user of toDelete) {
  //   await auth.deleteUser(user.uid);
  //   console.log(`Deletado: ${user.email} (${user.uid})`);
  // }
}

listAndDeleteTestUsers().catch(console.error);
