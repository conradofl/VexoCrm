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
const PREVIOUS_CODE_HASH = "547fb58ecaf57abf";

const CONRADO_UID = "sL8d9hr2mXZ5QHeT2ORMQsDEyAi1";
const GABRIEL_UID = "XBkP0DsTL2TvGnLHGEie99CshEf1";
const PRISCILA_UID = "bM2603rX8DhAQUu1XNpJ8LMdr1L2";

const GD_PRISCILA_ID = "73ba3e2a-d8c6-4502-a83c-6d6cf1e82d21";
const GD_GABRIEL_ID = "d0521b27-b3c1-4314-a332-1d2249c84bcb";
const GD_OFICIAL_ID = "a5a76384-6a31-4f1e-a8a1-1ec58dfba421";

async function getIdTokenForUser(uid, customClaims = {}) {
  const customToken = await admin.auth().createCustomToken(uid, customClaims);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const data = await res.json();
  if (!data.idToken) {
    throw new Error(`Failed to get ID token for UID ${uid}: ${JSON.stringify(data)}`);
  }
  return data.idToken;
}

async function verifyLiveContainerVersion() {
  console.log(">>> [ETAPA 1/6] Verificando versão da imagem no Easypanel (/health)...");
  const res = await fetch(`${BASE_URL}/health`);
  if (res.status !== 200) {
    throw new Error(`Endpoint /health retornou HTTP ${res.status}`);
  }
  const data = await res.json();
  const liveCodeHash = data.build?.codeHash;
  const uptime = data.uptimeSeconds;

  console.log(`   Container CodeHash Ativo: "${liveCodeHash}"`);
  console.log(`   Container Uptime: ${Math.round(uptime)} segundos`);
  console.log(`   Migrations Status: ${data.migrations?.status} (${data.migrations?.appliedCount} aplicadas)`);

  if (liveCodeHash === PREVIOUS_CODE_HASH) {
    throw new Error(
      `🛑 TRAVA DE SEGURANÇA: O container de produção AINDA ESTÁ RODANDO A IMAGEM ANTIGA (${PREVIOUS_CODE_HASH})!\n` +
      `   Aguarde o deploy finalizar no Easypanel antes de configurar os chips.`
    );
  }

  console.log(`✅ Novo container confirmado! CodeHash atualizado para "${liveCodeHash}".`);
  return data;
}

async function main() {
  console.log("================================================================================");
  console.log(" 📌 BLOCO 3: ATRIBUIÇÃO REAL DE LEAD POR CHIP — CONFIGURAÇÃO E TESTE AO VIVO");
  console.log("================================================================================\n");

  // 1. Trava de versão
  await verifyLiveContainerVersion();

  // 2. Tokens de acesso
  console.log("\n>>> [ETAPA 2/6] Gerando tokens de autenticação reais...");
  const adminToken = await getIdTokenForUser(CONRADO_UID);
  const priscilaToken = await getIdTokenForUser(PRISCILA_UID);
  const gabrielToken = await getIdTokenForUser(GABRIEL_UID);
  console.log("   Tokens gerados com sucesso para Conrado (Admin), Priscila (Operador) e Gabriel (Operador).");

  // 3. Configurar Mapeamento dos Chips
  console.log("\n>>> [ETAPA 3/6] Configurando Mapeamento de Donos nos Chips de Geração Digital...");

  // Chip Priscila
  console.log("   Configurando 'GD Priscila' -> UID da Priscila...");
  const patchPriscilaRes = await fetch(`${BASE_URL}/api/lead-clients/geracao-digital/evolution-instances/${GD_PRISCILA_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ownerUid: PRISCILA_UID }),
  });
  if (!patchPriscilaRes.ok) {
    throw new Error(`Falha ao atribuir GD Priscila: HTTP ${patchPriscilaRes.status} ${await patchPriscilaRes.text()}`);
  }

  // Chip Gabriel
  console.log("   Configurando 'Gabriel - Comercial Agência GD' -> UID do Gabriel...");
  const patchGabrielRes = await fetch(`${BASE_URL}/api/lead-clients/geracao-digital/evolution-instances/${GD_GABRIEL_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ownerUid: GABRIEL_UID }),
  });
  if (!patchGabrielRes.ok) {
    throw new Error(`Falha ao atribuir Gabriel GD: HTTP ${patchGabrielRes.status} ${await patchGabrielRes.text()}`);
  }

  // Chip Oficial
  console.log("   Configurando 'Número oficial - Agência GD' -> NULL (sem dono / Caio)...");
  const patchOficialRes = await fetch(`${BASE_URL}/api/lead-clients/geracao-digital/evolution-instances/${GD_OFICIAL_ID}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ownerUid: null }),
  });
  if (!patchOficialRes.ok) {
    throw new Error(`Falha ao atribuir Oficial GD: HTTP ${patchOficialRes.status} ${await patchOficialRes.text()}`);
  }

  // 4. Releitura e Validação dos Chips
  console.log("\n>>> [ETAPA 4/6] Releitura das instâncias gravadas...");
  const verifyInstRes = await fetch(`${BASE_URL}/api/lead-clients/geracao-digital/evolution-instances`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const instData = await verifyInstRes.json();
  const instances = Array.isArray(instData) ? instData : instData?.items || [];
  for (const inst of instances) {
    console.log(`   - [${inst.name}] ID: ${inst.id} | Owner: ${inst.owner_uid ?? "NULL"}`);
  }

  const pInst = instances.find((i) => i.id === GD_PRISCILA_ID);
  const gInst = instances.find((i) => i.id === GD_GABRIEL_ID);
  const oInst = instances.find((i) => i.id === GD_OFICIAL_ID);

  if (pInst?.owner_uid !== PRISCILA_UID) {
    throw new Error(`GD Priscila owner_uid incorreto: esperado ${PRISCILA_UID}, obtido ${pInst?.owner_uid}`);
  }
  if (gInst?.owner_uid !== GABRIEL_UID) {
    throw new Error(`Gabriel GD owner_uid incorreto: esperado ${GABRIEL_UID}, obtido ${gInst?.owner_uid}`);
  }
  if (oInst?.owner_uid != null) {
    throw new Error(`Oficial GD owner_uid incorreto: esperado NULL, obtido ${oInst?.owner_uid}`);
  }
  console.log("✅ Mapeamento de chips confirmado 100% no banco!");

  // 5. Blindagem dos 2.126 leads históricos
  console.log("\n>>> [ETAPA 5/6] Verificando integridade dos 2.126 leads históricos...");
  const leadsRes = await fetch(`${BASE_URL}/api/leads?clientId=geracao-digital&limit=2500`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const leadsData = await leadsRes.json();
  const leadsList = Array.isArray(leadsData) ? leadsData : leadsData?.leads || leadsData?.data || leadsData?.items || [];
  const nullAssigned = leadsList.filter((l) => !l.assigned_to).length;
  console.log(`   Total de leads de GD: ${leadsList.length}`);
  console.log(`   Leads com assigned_to NULL: ${nullAssigned}`);
  if (nullAssigned < 2126) {
    throw new Error(`Alerta: Quantidade de leads com assigned_to NULL (${nullAssigned}) abaixo dos 2.126 históricos!`);
  }
  console.log("✅ Histórico 100% preservado sem backfill indevido.");

  // 6. Teste de Isolamento de Leads e Barreiras de 403
  console.log("\n>>> [ETAPA 6/6] Testes de Isolamento e Barreiras de Permissão...");

  // A. Criar lead de teste atribuído à Priscila
  const testPhone = "5511999990099";
  console.log(`   Criando lead temporário atribuído à Priscila (${testPhone})...`);
  const createLeadRes = await fetch(`${BASE_URL}/api/leads/create`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientId: "geracao-digital",
      phone: testPhone,
      nome: "Lead Teste Bloco 3 - Priscila",
      assigned_to: PRISCILA_UID,
    }),
  });
  const createData = await createLeadRes.json();
  const createdLeadId = createData.lead?.id || createData.id;
  console.log(`   Lead criado: ID ${createdLeadId}`);

  try {
    // B. Priscila consulta leads -> DEVE VER o lead
    const priscilaLeadsRes = await fetch(`${BASE_URL}/api/leads?clientId=geracao-digital&limit=2500`, {
      headers: { Authorization: `Bearer ${priscilaToken}` },
    });
    const priscilaLeads = await priscilaLeadsRes.json();
    const priscilaList = Array.isArray(priscilaLeads) ? priscilaLeads : priscilaLeads?.leads || [];
    const priscilaSeesTestLead = priscilaList.some((l) => l.id === createdLeadId || l.telefone === testPhone);
    console.log(`   Priscila vê o lead criado para ela? ${priscilaSeesTestLead ? "SIM ✅" : "NÃO ❌"}`);
    if (!priscilaSeesTestLead) throw new Error("Priscila não viu o lead atribuído a ela!");

    // C. Gabriel consulta leads -> NÃO DEVE VER o lead da Priscila
    const gabrielLeadsRes = await fetch(`${BASE_URL}/api/leads?clientId=geracao-digital&limit=2500`, {
      headers: { Authorization: `Bearer ${gabrielToken}` },
    });
    const gabrielLeads = await gabrielLeadsRes.json();
    const gabrielList = Array.isArray(gabrielLeads) ? gabrielLeads : gabrielLeads?.leads || [];
    const gabrielSeesTestLead = gabrielList.some((l) => l.id === createdLeadId || l.telefone === testPhone);
    console.log(`   Gabriel vê o lead da Priscila? ${gabrielSeesTestLead ? "SIM (VAZOU!) ❌" : "NÃO (ISOLADO!) ✅"}`);
    if (gabrielSeesTestLead) throw new Error("Vazamento: Gabriel viu o lead exclusivo da Priscila!");

    // D. Ambos continuam vendo os históricos (assigned_to NULL)
    const gabrielSeesHistorical = gabrielList.length >= 2126;
    const priscilaSeesHistorical = priscilaList.length >= 2126;
    console.log(`   Gabriel vê os ${gabrielList.length} leads históricos? ${gabrielSeesHistorical ? "SIM ✅" : "NÃO ❌"}`);
    console.log(`   Priscila vê os ${priscilaList.length} leads históricos? ${priscilaSeesHistorical ? "SIM ✅" : "NÃO ❌"}`);
    if (!gabrielSeesHistorical || !priscilaSeesHistorical) throw new Error("Um dos operadores perdeu visão dos leads históricos!");

    // E. Teste Negativo: Operador tenta reatribuir chip -> DEVE DAR 403
    console.log("   Testando tentativa de operador reatribuir chip...");
    const badChipRes = await fetch(`${BASE_URL}/api/lead-clients/geracao-digital/evolution-instances/${GD_PRISCILA_ID}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${gabrielToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ownerUid: GABRIEL_UID }),
    });
    console.log(`   Status tentativa chip por operador: ${badChipRes.status} (esperado 403)`);
    if (badChipRes.status !== 403) throw new Error(`Operador conseguiu alterar chip ou retornou HTTP ${badChipRes.status}!`);

    // F. Teste Negativo: Operador tenta reatribuir lead -> DEVE DAR 403
    console.log("   Testando tentativa de operador reatribuir lead...");
    const badLeadRes = await fetch(`${BASE_URL}/api/leads/${createdLeadId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${gabrielToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ assigned_to: GABRIEL_UID }),
    });
    console.log(`   Status tentativa lead por operador: ${badLeadRes.status} (esperado 403)`);
    if (badLeadRes.status !== 403) throw new Error(`Operador conseguiu reatribuir lead ou retornou HTTP ${badLeadRes.status}!`);

    // G. Teste Ponta a Ponta: Criação via WhatsApp Inbox (/api/whatsapp/chats/create-lead) do chip da Priscila SEM assigned_to
    const inboundPriscilaPhone = "5511999990088";
    console.log(`\n   Testando atribuição automática via /api/whatsapp/chats/create-lead (GD Priscila, phone ${inboundPriscilaPhone})...`);
    const autoPriscilaRes = await fetch(`${BASE_URL}/api/whatsapp/chats/create-lead`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId: "geracao-digital",
        phone: inboundPriscilaPhone,
        name: "Lead Automático GD Priscila",
        instanceName: "GD Priscila",
        // NÃO envia assigned_to: o backend DEVE resolver sozinho pelo chip
      }),
    });
    const autoPriscilaData = await autoPriscilaRes.json();
    const autoPriscilaLead = autoPriscilaData.lead || autoPriscilaData.item;
    const autoPriscilaLeadId = autoPriscilaLead?.id;
    console.log(`   Lead criado: ID ${autoPriscilaLeadId} | assigned_to: ${autoPriscilaLead?.assigned_to}`);
    if (!autoPriscilaLead || autoPriscilaLead.assigned_to !== PRISCILA_UID) {
      throw new Error(
        `Falha na atribuição automática: esperado ${PRISCILA_UID}, obtido ${autoPriscilaLead?.assigned_to}`
      );
    }
    console.log("   ✅ Lead de inbound nasceu atribuído à Priscila automaticamente!");

    // Confere se Gabriel vê esse lead automático
    const gCheckRes = await fetch(`${BASE_URL}/api/leads?clientId=geracao-digital&limit=2500`, {
      headers: { Authorization: `Bearer ${gabrielToken}` },
    });
    const gCheckData = await gCheckRes.json();
    const gCheckList = Array.isArray(gCheckData) ? gCheckData : gCheckData?.leads || [];
    const gSeesAuto = gCheckList.some((l) => l.id === autoPriscilaLeadId || l.telefone === inboundPriscilaPhone);
    console.log(`   Gabriel vê o lead atribuído automaticamente à Priscila? ${gSeesAuto ? "SIM (VAZOU!) ❌" : "NÃO (ISOLADO!) ✅"}`);
    if (gSeesAuto) throw new Error("Vazamento: Gabriel viu o lead atribuído automaticamente à Priscila!");

    // Remove o lead de teste da Priscila
    if (autoPriscilaLeadId) {
      await fetch(`${BASE_URL}/api/leads/${autoPriscilaLeadId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }

    // H. Teste Ponta a Ponta: Criação via WhatsApp Inbox (/api/whatsapp/chats/create-lead) do chip sem dono (Número oficial)
    const inboundOficialPhone = "5511999990077";
    console.log(`\n   Testando atribuição automática via /api/whatsapp/chats/create-lead (Número oficial, phone ${inboundOficialPhone})...`);
    const autoOficialRes = await fetch(`${BASE_URL}/api/whatsapp/chats/create-lead`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        clientId: "geracao-digital",
        phone: inboundOficialPhone,
        name: "Lead Automático GD Oficial",
        instanceName: "Número oficial – Agência GD",
        // NÃO envia assigned_to
      }),
    });
    const autoOficialData = await autoOficialRes.json();
    const autoOficialLead = autoOficialData.lead || autoOficialData.item;
    const autoOficialLeadId = autoOficialLead?.id;
    console.log(`   Lead criado: ID ${autoOficialLeadId} | assigned_to: ${autoOficialLead?.assigned_to ?? "NULL"}`);
    if (!autoOficialLead || autoOficialLead.assigned_to != null) {
      throw new Error(
        `Falha na atribuição de chip oficial: esperado NULL, obtido ${autoOficialLead?.assigned_to}`
      );
    }
    console.log("   ✅ Lead de inbound do chip oficial nasceu com assigned_to = NULL (compartilhado)!");

    // Remove o lead de teste oficial
    if (autoOficialLeadId) {
      await fetch(`${BASE_URL}/api/leads/${autoOficialLeadId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }

  } finally {
    // Limpar lead de teste manual
    if (createdLeadId) {
      console.log(`\n   Limpando lead temporário de teste manual (ID: ${createdLeadId})...`);
      await fetch(`${BASE_URL}/api/leads/${createdLeadId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      console.log("   Lead de teste removido.");
    }
  }

  console.log("\n================================================================================");
  console.log(" 🎉 SUCESSO TOTAL: BLOCO 3 100% OPERACIONAL E TESTADO AO VIVO!");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("\n❌ ERRO NO PROCESSO:", err);
  process.exit(1);
});
