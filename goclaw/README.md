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

---

## 👥 Gestão de Usuários, Senhas e Roles

A gestão de acessos e permissões do GoClaw é dividida em dois arquivos:
- `goclaw/users.json`: Mapeamento de usuários, nomes de exibição, papéis (`role`) e hashes de senha HTTP (`http_password_hash`).
- `goclaw/goclaw.json` (e `goclaw.yaml`): Bloco `roles` com as permissões de ferramentas, skills, memória, transcrições e comandos.

### 🔐 Geração Segura de Senhas (Argon2id)

Para gerar hashes de senha compatíveis com o validador interno do GoClaw (`user.VerifyPassword` / `user.parseArgon2Hash`):

```bash
# Modo 1: Interativo (digitação no terminal com máscara de asteriscos)
node goclaw/scripts/gerar-hash.mjs

# Modo 2: Via pipe seguro (sem gravar no histórico do shell)
read -s SENHA && echo -n "$SENHA" | node goclaw/scripts/gerar-hash.mjs
```

O hash gerado segue a especificação exata do GoClaw:
- **Variante**: `Argon2id` (v=19)
- **Memória**: `m=65536` (64 MB)
- **Tempo / Iterações**: `t=1`
- **Paralelismo**: `p=4`
- **Formato**: `$argon2id$v=19$m=65536,t=1,p=4$<salt>$<hash>`

Copie a saída gerada e cole no campo `"http_password_hash"` do usuário em `goclaw/users.json`.

---

## ⚠️ AVISO CRÍTICO: Bug de Validação na Tela Web de Users

> **NÃO utilize a interface web do GoClaw para criar ou editar usuários.**

**Causa Raiz Identificada no Binário (`goclaw_0.1.21`):**
1. **Divergência de Regex**:
   - No frontend web (HTML/JS embutido no binário), o campo username tem `pattern="[a-z0-9_-]+"` e sugere que hífens (`-`) são válidos.
   - No backend Go (`internal/user.ValidateUsername`), a regex compilada é estritamente:
     ```go
     ^[a-z][a-z0-9_]{0,31}$
     ```
   - O backend **rejeita** qualquer username que contenha hífen ou que não se inicie com letra minúscula `[a-z]`.
2. **Falha de Persistência**:
   - A tela web de Users apresenta falhas silenciosas na persistência para o `users.json` e não propaga alterações de senhas/roles de forma íntegra.

**Regra Operacional**:
Qualquer alteração de usuários e permissões DEVE ser feita diretamente nos arquivos de configuração versionados (`goclaw/users.json` e `goclaw/goclaw.json`), seguido de restart do contêiner ou binário.

---

## 🛡️ Configuração do Papel `colaborador`

No `goclaw/goclaw.json` (e `goclaw.yaml`), o papel `colaborador` limita os acessos operacionais da equipe PJ:
- **Ferramentas (`tools`)**: `message`, `web_search`, `web_fetch`, `memory_graph`, `document_extract`.
- **Skills (`skills`)**: `[]` (vazio, sem acesso a skills internas).
- **Acesso à Memória (`memory`)**: `"none"` (isolamento de memória global).
- **Acesso a Transcrições (`transcripts`)**: `"own"` (enxerga apenas o histórico das próprias conversas).
- **Slash Commands (`commands`)**: `false` (comandos administrativos desativados).

