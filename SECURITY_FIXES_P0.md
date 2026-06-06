# 🔒 Plano de Correções de Segurança - P0 (CRÍTICO)

**Prioridade:** MÁXIMA
**Status:** Não implementar em produção até corrigir P0s
**Data:** 23/03/2026

---

## ✅ CHECKLIST P0

### 1. ❌ SSRF em /api/sheets (SEM AUTENTICAÇÃO)

**Localização:** `backend/src/server.js` (~linha 520)

**Problema:**
```javascript
app.get("/api/sheets", async (req, res) => {
  const sheetId = normalizeString(req.body?.sheetId); // SEM VALIDAÇÃO
  const gid = normalizeString(req.body?.gid);

  const exportUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?...`;
  const sheetResponse = await fetch(exportUrl); // SSRF POSSÍVEL
});
```

**Correção:**
```javascript
// ✅ CORREÇÃO
const VALID_GOOGLE_SHEETS_REGEX = /^[a-zA-Z0-9-_]{44}$/; // UUID do Google Sheets

app.get("/api/sheets", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
  const sheetId = normalizeString(req.query?.sheetId);
  const gid = normalizeString(req.query?.gid);

  // Validação de formato
  if (!sheetId || !VALID_GOOGLE_SHEETS_REGEX.test(sheetId)) {
    sendError(res, 400, "INVALID_SHEET_ID", "Invalid Google Sheets ID");
    return;
  }

  if (gid && !/^\d+$/.test(gid)) {
    sendError(res, 400, "INVALID_GID", "Invalid sheet GID");
    return;
  }

  try {
    const exportUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid || "0")}`;

    const sheetResponse = await fetch(exportUrl, {
      timeout: 10000, // Timeout de 10 segundos
      headers: { "User-Agent": "VexoCRM/1.0" }
    });

    if (!sheetResponse.ok) {
      sendError(res, 502, "SHEETS_FETCH_FAILED", "Failed to fetch spreadsheet");
      return;
    }

    const csv = await sheetResponse.text();
    res.setHeader("Content-Type", "text/csv");
    res.send(csv);
  } catch (error) {
    console.error("[SECURITY] Sheets fetch error:", error.message);
    sendError(res, 502, "SHEETS_FETCH_FAILED", "Failed to fetch spreadsheet");
  }
});
```

**Testes:**
```bash
# ❌ DEVE FALHAR (sem auth)
curl http://localhost:3001/api/sheets?sheetId=abc123

# ❌ DEVE FALHAR (ID inválido)
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/sheets?sheetId=invalid

# ✅ DEVE FUNCIONAR (ID válido, auth correto)
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/sheets?sheetId=1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p
```

---

### 2. ❌ Internal Users Acessam Qualquer Cliente

**Localização:** `backend/src/server.js` (linhas 996-1020)

**Problema:**
```javascript
function resolveAuthorizedClientId(req, res, requestedClientId) {
  const authAccess = req.authAccess || { role: "internal", clientId: null, clientIds: [] };

  if (authAccess.role === "client") {
    // Validação correta para clients
    if (requestedClientId && !authAccess.clientIds.includes(requestedClientId)) {
      sendError(res, 403, "FORBIDDEN_CLIENT_SCOPE");
      return null;
    }
    return requestedClientId || authAccess.clientId || authAccess.clientIds[0] || null;
  }

  // ⚠️ PROBLEMA: Internal users SEM validação!
  return requestedClientId || authAccess.clientId || null;
}
```

**Correção:**
```javascript
function resolveAuthorizedClientId(req, res, requestedClientId) {
  const authAccess = req.authAccess || { role: "internal", clientId: null, clientIds: [] };

  if (authAccess.role === "client") {
    // Validação para clients
    if (requestedClientId && !authAccess.clientIds.includes(requestedClientId)) {
      sendError(res, 403, "FORBIDDEN_CLIENT_SCOPE", "You do not have access to this client");
      return null;
    }
    return requestedClientId || authAccess.clientId || authAccess.clientIds[0] || null;
  }

  // ✅ CORREÇÃO: Internal users também precisam validar
  if (authAccess.role === "internal") {
    // Se requestedClientId é especificado, validar se interno tem acesso
    if (requestedClientId) {
      // Opção 1: Admins podem acessar qualquer cliente
      if (authAccess.isAdmin) {
        return requestedClientId;
      }

      // Opção 2: Internos não-admin devem ter clientId na lista
      if (authAccess.clientIds && authAccess.clientIds.length > 0) {
        if (!authAccess.clientIds.includes(requestedClientId)) {
          sendError(res, 403, "FORBIDDEN_CLIENT_SCOPE", "You do not have access to this client");
          return null;
        }
        return requestedClientId;
      }

      // Opção 3: Sem clientIds atribuídos = erro
      sendError(res, 403, "NO_CLIENT_ACCESS", "You do not have access to any client");
      return null;
    }

    // Se nenhum clientId especificado, usar default (se houver)
    return authAccess.clientId || null;
  }

  sendError(res, 403, "FORBIDDEN", "Invalid role");
  return null;
}
```

**Endpoints afetados a revisar:**
- `GET /api/dashboard?clientId=...`
- `GET /api/leads?clientId=...`
- `GET /api/lead-imports?clientId=...`
- `POST /api/n8n-dispatches` (clientId no body)

---

### 3. ❌ Credenciais Hardcoded FIXED_ADMIN

**Localização:** `backend/src/server.js` (linhas 183-196)

**Problema:**
```javascript
const FIXED_ADMIN_UIDS = new Set([
  "IozfnQTmWHQAxopr3FyNb1SdYs52", // ⚠️ HARDCODED!
  "pKpOKg3Fttf6AnYsTzZD7xjJLaN2",
]);
const FIXED_ADMIN_EMAILS = new Set([
  "luizz.felipe.santos17@gmail.com", // ⚠️ HARDCODED!
  "econradofl@gmail.com",
]);
```

**Correção Imediata (Temporary):**
```javascript
// Mover para variáveis de ambiente
const FIXED_ADMIN_UIDS = new Set(
  (process.env.FIXED_ADMIN_UIDS || "").split(",").filter(Boolean)
);
const FIXED_ADMIN_EMAILS = new Set(
  (process.env.FIXED_ADMIN_EMAILS || "").split(",").filter(Boolean)
);

// .env
FIXED_ADMIN_UIDS=IozfnQTmWHQAxopr3FyNb1SdYs52,pKpOKg3Fttf6AnYsTzZD7xjJLaN2
FIXED_ADMIN_EMAILS=luizz.felipe.santos17@gmail.com,econradofl@gmail.com
```

**Correção Permanente (Recomendada):**
```javascript
// Usar Firebase Custom Roles ou Firestore dynamic admin list
async function isFixedAdmin(uid, email) {
  try {
    const adminListDoc = await supabase
      .from("admin_users")
      .select("uid")
      .eq("uid", uid)
      .maybeSingle();

    return !!adminListDoc.data;
  } catch {
    return false;
  }
}
```

**Criar tabela no Supabase:**
```sql
CREATE TABLE admin_users (
  uid TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  disabled BOOLEAN DEFAULT FALSE
);

INSERT INTO admin_users (uid, email, name) VALUES
  ('IozfnQTmWHQAxopr3FyNb1SdYs52', 'luizz.felipe.santos17@gmail.com', 'Luiz Felipe'),
  ('pKpOKg3Fttf6AnYsTzZD7xjJLaN2', 'econradofl@gmail.com', 'Eduardo Conrado');
```

---

### 4. ❌ User Enumeration em /api/client-signup

**Localização:** `backend/src/server.js` (linhas 1535-1540)

**Problema:**
```javascript
try {
  const user = await auth.createUser({
    email,
    password,
    displayName: `${name} - ${companyName}`,
  });
  res.status(201).json(signupSuccessBody);
} catch (error) {
  if (code === "auth/email-already-exists") {
    res.status(201).json(signupSuccessBody); // ⚠️ Retorna 201 mesmo se email existe!
  }
}
```

**Correção:**
```javascript
const sendError = (res, status, code, message, details) => {
  res.status(status).json({ error: { code, message, ...(details && { details }) } });
};

try {
  const user = await auth.createUser({
    email: email.toLowerCase(),
    password,
    displayName: `${name} - ${companyName}`,
  });

  // ✅ Enviar email de confirmação
  await sendVerificationEmail(email, user.uid);

  res.status(201).json({
    message: "Account created. Please verify your email.",
    email: email, // OK expor email do usuário que criou
  });
} catch (error) {
  const errorCode = error?.code || "";

  // ✅ NÃO revelar se email existe
  if (errorCode === "auth/email-already-exists") {
    // Enviar email de "account already exists" (não revela que existe)
    await sendAccountExistsEmail(email);

    // Retornar sucesso genérico
    res.status(201).json({
      message: "If an account with this email exists, you will receive an email.",
      email: email,
    });
    return;
  }

  if (errorCode === "auth/weak-password") {
    sendError(res, 400, "WEAK_PASSWORD", "Password does not meet security requirements");
    return;
  }

  if (errorCode === "auth/invalid-email") {
    sendError(res, 400, "INVALID_EMAIL", "Please provide a valid email address");
    return;
  }

  // Erro genérico para tudo mais
  console.error("[SECURITY] Signup error:", error);
  sendError(res, 500, "SIGNUP_FAILED", "An error occurred during signup");
}
```

---

### 5. ❌ Password Reset Link Exposto

**Localização:** `backend/src/server.js` (linhas 1443-1453)

**Problema:**
```javascript
if (sendPasswordReset) {
  passwordResetLink = await auth.generatePasswordResetLink(email);
}

res.status(201).json({
  item: mapAdminUserRecord(createdUser),
  passwordResetLink, // ⚠️ Expõe link sensível na resposta!
});
```

**Correção:**
```javascript
if (sendPasswordReset) {
  const passwordResetLink = await auth.generatePasswordResetLink(email);

  // ✅ Enviar via email, NÃO na resposta
  try {
    await sendPasswordResetEmail(email, passwordResetLink, user.displayName);
  } catch (emailError) {
    console.error("[SECURITY] Failed to send password reset email:", emailError);
    // Falha de email não deve falhar criação de usuário
    // Mas log de auditoria deve registrar
  }
}

res.status(201).json({
  item: mapAdminUserRecord(createdUser),
  passwordResetLinkSent: sendPasswordReset,
  message: sendPasswordReset
    ? "User created. Password reset link sent to email."
    : "User created. Please set password via Firebase console.",
  // ❌ NÃO retornar o link
});
```

---

### 6. ❌ /api/whatsapp/messages/direct Sem Autorização

**Localização:** `backend/src/server.js` (~linha 2000)

**Problema:**
```javascript
app.post("/api/whatsapp/messages/direct", requireFirebaseAuth, requireAppViewAccess("whatsapp"),
  async (req, res) => {
    const phone = normalizeString(req.body?.phone);
    const body = normalizeString(req.body?.body);

    // ⚠️ Nenhuma validação se phone foi autorizado!
    const message = await client.sendMessage(normalizePhoneToWhatsAppId(phone), body);
  }
);
```

**Correção Opção A: REMOVER o endpoint**
```javascript
// ❌ Remover /api/whatsapp/messages/direct
// (Usar apenas POST /api/whatsapp/messages com chatId)
```

**Correção Opção B: ADICIONAR autorização**
```javascript
app.post("/api/whatsapp/messages/direct",
  requireFirebaseAuth,
  requireAdminAccess, // ✅ Apenas admins
  async (req, res) => {
    const phone = normalizeString(req.body?.phone);
    const body = normalizeString(req.body?.body);

    // ✅ Validação de phone
    if (!phone || !/^\d{10,13}$/.test(phone.replace(/\D/g, ""))) {
      sendError(res, 400, "INVALID_PHONE", "Invalid phone number");
      return;
    }

    // ✅ Validação de mensagem
    if (!body || body.length > 4096) {
      sendError(res, 400, "INVALID_MESSAGE", "Message too long or empty");
      return;
    }

    // ✅ Rate limiting por destinatário
    const rateLimitKey = `whatsapp:direct:${phone}`;
    const recentMessages = await redis.get(rateLimitKey);
    if (recentMessages && parseInt(recentMessages) >= 5) {
      sendError(res, 429, "RATE_LIMIT", "Too many messages to this number");
      return;
    }

    try {
      // ✅ Auditoria log
      await auditLog({
        action: "whatsapp_direct_message_sent",
        userId: req.authAccess.uid,
        phone: phone,
        timestamp: new Date(),
      });

      const message = await client.sendMessage(normalizePhoneToWhatsAppId(phone), body);

      // Incrementar rate limit
      await redis.incr(rateLimitKey);
      await redis.expire(rateLimitKey, 3600); // 1 hora

      res.json({ messageId: message.id });
    } catch (error) {
      console.error("[SECURITY] WhatsApp direct message error:", error);
      sendError(res, 500, "MESSAGE_SEND_FAILED", "Failed to send message");
    }
  }
);
```

---

## 📊 VERIFICAÇÃO PÓS-CORREÇÃO

Após corrigir os P0s, executar:

```bash
# 1. Testes de segurança
npm test

# 2. Verificar que /api/sheets requer auth
curl http://localhost:3001/api/sheets -i
# Esperado: 401 Unauthorized

# 3. Verificar que internal user não pode acessar cliente não-autorizado
# (teste manual com token JWT de internal user)

# 4. Revisar logs de produção para tentativas suspeitas

# 5. Fazer audit das custom claims de todos os usuários
firebase-cli: firebase --project vexo getUsers --page-size 100
```

---

## ⚠️ PRÓXIMOS PASSOS (P1)

Após corrigir P0s:

- [ ] Adicionar validação de sourceName/sourceType em POST /api/lead-imports
- [ ] Restringir GET /api/admin/users
- [ ] Implementar HMAC-SHA256 para webhooks
- [ ] Adicionar auditoria logging
- [ ] Encriptar conversações em armazenamento
- [ ] Rate limiting por usuário

---

**Status:** ⏳ Aguardando implementação
**ETA Implementação P0s:** 48 horas
**ETA Testes P0s:** 72 horas
