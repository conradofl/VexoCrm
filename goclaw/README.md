# Runtime GoClaw · Geração Digital & Vexo OS

Arquitetura de agentes autônomos construída sobre o runtime **GoClaw** (Golang), com concorrência nativa por **Lanes**, persistência de memória em SQLite com busca vetorial e integração multi-canal.

---

## 🏗️ As 3 Lanes Operacionais

1. **Lane Maestro (COO de IA)**:
   - **Modelo**: `anthropic/claude-3-5-sonnet-20241022`
   - **Canal**: Telegram Bot & WhatsApp
   - **Função**: General da operação. Check-in matinal (09h00) e check-out vespertino (18h00) com os sócios (Conrado e Caio). Cobrador implacável de prazos e gargalos.
   - **Prompt**: `prompts/maestro_coo.md`

2. **Lane Onboarding (Gestor Digital)**:
   - **Modelo**: `openai/gpt-4o`
   - **Canal**: WhatsApp & HTTP Webhook
   - **Função**: Acolhimento e onboarding de novos clientes nas primeiras 48h. Coleta de briefing guiado, solicitação de acessos (Meta Ads, Google, Drive) e geração de dossiês estruturados.
   - **Prompt**: `prompts/gestor_digital_onboarding.md`

3. **Lane Gestão de Tarefas (Cron & Auditoria)**:
   - **Modelo**: `openai/gpt-4o`
   - **Agendamento**: Cron 09h00 e 18h00 (Segunda a Sexta)
   - **Função**: Auditoria automática de quadros do Trello e publicação do Daily Report no canal `#01-ops-geral` do Slack.
   - **Prompt**: `prompts/gestor_demandas_auditor.md`

---

## 🚀 Como Rodar o GoClaw

### Opção 1: Via Docker / Docker Compose (Recomendado para Produção / VPS)
```bash
cd goclaw
docker compose up -d
```

### Opção 2: Binário Nativo (Linux x86_64 / ARM64)
O binário pré-compilado oficial do GoClaw para Linux é distribuído via Forgejo:
```bash
curl -fsSL https://git.goclaw.org/roelfdiedericks/goclaw/releases/download/v0.1.21/goclaw_0.1.21_linux_amd64.tar.gz -o goclaw.tar.gz
tar -xzf goclaw.tar.gz
./goclaw
```

### Opção 3: Conector Trello ↔ Slack Integrado (Node.js)
Para disparar a auditoria diária do Trello e despachar direto para o Slack `#01-ops-geral`:
```bash
# Auditoria Matinal (09h00)
node backend/src/scripts/trello-slack-daily-reporter.mjs --morning

# Auditoria Vespertina (18h00)
node backend/src/scripts/trello-slack-daily-reporter.mjs --evening

# Simulação / Teste sem envio real (Dry-run)
node backend/src/scripts/trello-slack-daily-reporter.mjs --morning --dry-run
```
