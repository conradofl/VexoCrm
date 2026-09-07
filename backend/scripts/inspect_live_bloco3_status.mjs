import dotenv from "dotenv";
dotenv.config();

import admin from "firebase-admin";

const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const projectId = process.env.FIREBASE_PROJECT_ID;

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

const API_KEY = "AIzaSyDOkCjNyAF9Y51RbocNg0UOaJlwpjVr-Qs";
const BASE_URL = "https://vexo-backend.xdvm8y.easypanel.host";

async function getIdTokenForUser(uid, customClaims = {}) {
  const customToken = await admin.auth().createCustomToken(uid, customClaims);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const data = await res.json();
  if (!data.idToken) {
    throw new Error(`Failed to get ID token: ${JSON.stringify(data)}`);
  }
  return data.idToken;
}

async function main() {
  console.log("=== INSPEÇÃO PRÉ-DEPLOY BLOCO 3: STATUS DE PRODUÇÃO ===\n");

  // 1. Health check
  const healthRes = await fetch(`${BASE_URL}/health`);
  const healthData = await healthRes.json();
  console.log("1. /health Status:", {
    status: healthRes.status,
    codeHash: healthData.build?.codeHash,
    uptimeSeconds: Math.round(healthData.uptimeSeconds),
    migrations: healthData.migrations,
  });

  const conradoUid = "sL8d9hr2mXZ5QHeT2ORMQsDEyAi1";
  const adminToken = await getIdTokenForUser(conradoUid);

  // 2. Evolution Instances para geracao-digital
  console.log("\n2. Consultando chips/instâncias de geracao-digital...");
  const instRes = await fetch(`${BASE_URL}/api/lead-clients/geracao-digital/evolution-instances`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const instData = await instRes.json();
  const instances = Array.isArray(instData) ? instData : instData?.items || [];
  console.log(`Total de instâncias retornadas: ${instances.length}`);
  for (const inst of instances) {
    console.log(`  - [${inst.name}] ID: ${inst.id} | Default: ${inst.is_default} | Active: ${inst.active} | OwnerUID: ${inst.owner_uid ?? "NULL"}`);
  }

  // 3. Leads de geracao-digital
  console.log("\n3. Verificando leads históricos de geracao-digital...");
  const leadsRes = await fetch(`${BASE_URL}/api/leads?clientId=geracao-digital&limit=2500`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const leadsData = await leadsRes.json();
  const leadsList = Array.isArray(leadsData) ? leadsData : leadsData?.leads || leadsData?.data || leadsData?.items || [];
  console.log(`Total de leads em geracao-digital: ${leadsList.length}`);
  const nullAssigned = leadsList.filter((l) => !l.assigned_to).length;
  console.log(`Leads com assigned_to NULL: ${nullAssigned}`);

  process.exit(0);
}

main().catch(console.error);
