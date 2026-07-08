# Setup Webhook Hardcoded Chatbot - Local & Production

## 📍 Endpoints Disponíveis

```
POST /api/hardcoded-chat                    - Chat direto (teste manual)
POST /api/hardcoded-chat-webhook            - Webhook para Evolution (WhatsApp)
POST /api/hardcoded-chat-extract            - Extrai briefing de conversa finalizada
```

---

## 🏠 Testando Localmente com ngrok

### 1. Instalar ngrok

**Windows:**
```bash
choco install ngrok
# ou: https://ngrok.com/download
```

### 2. Iniciar ngrok

Em um terminal diferente:
```bash
ngrok http 3001
```

Você vai ver:
```
Forwarding                    https://xxxx-xx-xxx-xxx-xx.ngrok.io -> http://localhost:3001
```

Copie essa URL: `https://xxxx-xx-xxx-xxx-xx.ngrok.io`

### 3. Configurar na Evolution

No painel Evolution, vá para **Webhook** e configure:

```
URL: https://xxxx-xx-xxx-xxx-xx.ngrok.io/api/hardcoded-chat-webhook
Evento: incoming_messages (ou similar)
Método: POST
```

### 4. Testar Manualmente

```bash
# Iniciar conversa (primeiro mensaje)
curl -X POST https://xxxx-xx-xxx-xxx-xx.ngrok.io/api/hardcoded-chat \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "outlier",
    "phone": "5511999999999"
  }'

# Responder (próximas mensagens)
curl -X POST https://xxxx-xx-xxx-xxx-xx.ngrok.io/api/hardcoded-chat \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "outlier",
    "phone": "5511999999999",
    "message": "Sim"
  }'
```

---

## 🤖 Fluxo de Mensagens

```
WhatsApp (Evolution)
        ↓
[POST /api/hardcoded-chat-webhook]
        ↓
├─ Processa mensagem via chatbot hardcoded
├─ Salva dados em Redis (contexto) + PostgreSQL (histórico)
├─ Se conversa finalizada → Extrai briefing
└─ Retorna resposta para enviar ao WhatsApp
        ↓
WhatsApp (via Evolution)
```

---

## 📊 Exemplo: Conversa Completa via Webhook

### 1️⃣ Lead envia "Oi"

**Você recebe no webhook:**
```json
{
  "phone": "5511999999999",
  "message": "Oi",
  "senderName": "João"
}
```

**Backend processa e responde:**
```json
{
  "success": true,
  "chatbotResponse": {
    "message": "Olá! 👋 Nós da Vexo CRM estamos te contando sobre oportunidades de crédito. Você tem interesse em conhecer nossas soluções? (sim/não)",
    "status": "started",
    "stepId": "situation_interest"
  }
}
```

**Você envia de volta para Evolution:**
```bash
# Evolution API - Send Message
POST https://api.evolution-api.com/message/sendText
{
  "number": "5511999999999",
  "text": "Olá! 👋 Nós da Vexo CRM estamos te contando sobre oportunidades de crédito. Você tem interesse em conhecer nossas soluções? (sim/não)"
}
```

### 2️⃣ Lead responde "Sim"

**Webhook recebe:**
```json
{
  "phone": "5511999999999",
  "message": "Sim"
}
```

**Backend responde:**
```json
{
  "success": true,
  "chatbotResponse": {
    "message": "Qual é seu principal objetivo? (Refinanciar dívidas / Investimento pessoal / Expandir negócio / Reforma / Outro)",
    "status": "next_step",
    "stepId": "situation_objective",
    "collectedData": {
      "interesse": "Sim"
    }
  }
}
```

### ✅ Conversa Finalizada

Após 9 perguntas, quando o lead responde a última:

**Backend responde:**
```json
{
  "success": true,
  "chatbotResponse": {
    "message": "Obrigado! Suas informações foram salvas.",
    "status": "completed",
    "collectedData": {
      "interesse": "Sim",
      "objetivo": "Refinanciar dívidas",
      "estado": "São Paulo",
      "cidade": "São Paulo",
      "crédito": "Bom",
      "parcela": "12",
      "prazo": "Imediato",
      "lance_entrada_fgts": "Sim",
      "melhor_horario": "Manhã"
    }
  },
  "briefing": {
    "cliente": "Não informado",
    "contato": "5511999999999",
    "localizacao": "São Paulo - São Paulo",
    "interesse": "Refinanciar dívidas",
    "creditoDesejado": "Não informado",
    "prazoIntencao": "Imediato",
    "parcelaConfortavel": "12x",
    "lancoEntradaFgts": "Sim",
    "temperatura": "QUENTE 🔴",
    "leituraDoLead": "Lead com interesse explícito. Busca refinanciar dívidas. Prazo curto - alta urgência. Capacidade financeira boa.",
    "ganhoParaConsultor": "Abrir com simulação de cenários. Lead está pronto para decisão - focar em soluções práticas e prazos.",
    "pontosDeAtencao": [
      "Lead aberto - aproveitar para detalhar soluções específicas",
      "Prazo curto - priorizar agilidade na aprovação e envio de documentação simplificada",
      "Lead interessado em usar FGTS - preparar simulações com esse recurso como entrada"
    ],
    "proximoPassoSugerido": "Simulação de cenários personalizados com prazos reais de aprovação"
  }
}
```

**Você notifica o consultor:**
- Via email com briefing
- Via SMS: "Novo lead QUENTE de São Paulo - João - Refinanciar dívidas"
- Via CRM: Criar ticket para consultor

---

## 🔧 Integração com Evolution API

A resposta do chatbot pode ser enviada direto para Evolution:

```javascript
// Pseudocódigo no seu backend/frontend
const chatResponse = await fetch(`https://xxxx.ngrok.io/api/hardcoded-chat-webhook`, {
  method: 'POST',
  body: JSON.stringify({
    phone: userPhone,
    message: userMessage,
    clientId: 'outlier'
  })
});

const result = await chatResponse.json();

// Se há mensagem, enviar para WhatsApp via Evolution
if (result.chatbotResponse?.message) {
  await evolutionAPI.sendText({
    number: userPhone,
    text: result.chatbotResponse.message
  });
}

// Se conversa finalizou, notificar consultor
if (result.briefing) {
  await notifyConsultor({
    lead: result.briefing,
    temperarura: result.briefing.temperatura
  });
}
```

---

## 📱 Configuração na Evolution

### Setup do Webhook

1. Vá para **Settings** → **Webhooks**
2. Clique em **+ Add Webhook**
3. Configure:

```
Nome: Outlier Chatbot
URL: https://xxxx-xx-xxx-xxx-xx.ngrok.io/api/hardcoded-chat-webhook
Eventos: 
  ✓ messages.incoming (ou message_received)
  ✓ messages.sent
Método: POST
Headers adicionais (opcional):
  X-API-Key: seu-token-aqui
```

4. Teste com **Send Test** no painel

---

## 🚀 Deploy em Produção

Quando pronto para produção (não mais localhost):

1. **Fazer push do código:**
```bash
git add .
git commit -m "feat: add hardcoded chatbot with extracto and webhooks"
git push origin main
```

2. **Atualizar URL em Evolution:**
```
De: https://xxxx-xx-xxx-xxx-xx.ngrok.io/api/hardcoded-chat-webhook
Para: https://seu-dominio.com/api/hardcoded-chat-webhook
```

3. **Ou usar EasyPanel diretamente:**
```
https://seu-app-easypanel.com/api/hardcoded-chat-webhook
```

---

## 🐛 Debugging

### Ver logs do chatbot:
```bash
# Terminal do backend
tail -f backend/backend.log | grep hardcoded
```

### Testar extraction de briefing:
```bash
curl -X POST http://localhost:3001/api/hardcoded-chat-extract \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "outlier",
    "phone": "5511999999999"
  }'
```

### Ver conversa salva:
```sql
SELECT id, telefone, status_conversa, status, dados, created_at
FROM leads_outlier
WHERE client_id = 'outlier'
ORDER BY created_at DESC
LIMIT 10;
```

---

## ⚙️ Variáveis de Ambiente Necessárias

Já estão configuradas em `.env`:
- `DATABASE_URL` - Postgres
- `REDIS_HOST` - Redis (opcional, funciona sem)
- `PORT` - Porta do servidor (3001)

---

## 📞 Resumo

| O que | Endpoint | Método | Uso |
|------|----------|--------|-----|
| Chat manual | `/api/hardcoded-chat` | POST | Testar direto |
| Webhook Evolution | `/api/hardcoded-chat-webhook` | POST | Receber de WhatsApp |
| Extrair briefing | `/api/hardcoded-chat-extract` | POST | Recuperar conversa salva |

**Para rodar localmente:** Use ngrok + Evolution configurado apontando para seu webhook público.

**Todos os dados são salvos em PostgreSQL** - mesmo se Redis cair, histórico completo fica no banco.
