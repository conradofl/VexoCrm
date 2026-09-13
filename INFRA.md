# INFRA — Mapa de produção e runbook de migração

> Leia isto ANTES de migrar banco, backend, ou trocar Firebase. Foi escrito depois de um
> incidente (29/07/2026) em que o frontend apontava para um backend antigo cujo banco
> tinha sido desligado — o sistema inteiro caiu e levou horas para achar a causa.

## Topologia atual

| Peça | Onde | Detalhe |
|---|---|---|
| **Frontend** | Vercel, projeto `vexo-crm` | Domínio `crm.vexoia.com`. Repo `conradofl/VexoCrm`. |
| **Backend (API)** | Easypanel `72.61.37.181`, projeto `vexo`, serviço `bk-vexo` | Domínio `https://vexo-backend.xdvm8y.easypanel.host` → **porta interna 3001**. |
| **Banco** | Easypanel `72.61.37.181`, projeto `vexo`, serviço `db-vexo` | Host interno `vexo_db-vexo:5432`, database `vexo`. |

**Como o frontend fala com o backend:** `frontend/vercel.json` faz rewrite de `/api/*` para o
domínio do backend. É **UMA linha** (`destination`). Trocar de backend = trocar essa linha e
dar push (a Vercel redeploya sozinha).

## Runbook: trocar de backend/servidor
1. Suba o backend novo. Confirme o domínio público dele e a **porta** (o app escuta **3001** —
   o domínio no Easypanel tem que apontar pra 3001, não 80).
2. Teste direto: abra `https://<dominio-novo>/health` → tem que vir `postgresPing:true`.
3. Edite `destination` nos dois `vercel.json` (raiz e `frontend/`) para o domínio novo.
4. `git commit` + `git push origin main`. Espere a Vercel redeployar (~2 min).
5. **Teste pela ponta:** `crm.vexoia.com/api/health` (NÃO só o backend direto). Isso valida a
   corrente toda (front → rewrite → backend → banco).
6. Só depois de tudo ok, **pare** (não delete) o backend antigo.

## Runbook: trocar de banco
1. `DATABASE_URL` do `bk-vexo` fica em Easypanel → serviço bk-vexo → **Ambiente**.
2. O host tem que resolver **na rede do serviço** (ex.: `vexo_db-vexo` só resolve dentro do
   projeto `vexo`). Host errado dá `getaddrinfo ENOTFOUND <host>` e derruba tudo.
3. Depois de mudar env no Easypanel, faça **Deploy** (recria o container). "Restart" pode não
   recarregar o env novo.
4. **SEMPRE tire um dump do banco antigo antes de desligá-lo:**
   `pg_dump "postgresql://user:senha@host:5432/db" -Fc -f backup.dump`
   Guarde ~2 semanas antes de deletar de vez.

## Runbook de Emergência: Restauração de Backup (Guia das 3 da Manhã)

> **REGRA DE OURO DA RESTAURAÇÃO:**  
> **NUNCA** restaure por cima de `db-vexo` em produção para fazer testes ou diagnósticos.  
> O procedimento seguro é **sempre subir um banco temporário/novo**, restaurar nele, conferir os dados e só então virar a chave do backend se for uma substituição definitiva.

### 1. Onde achar o arquivo de backup
Os backups automáticos do Postgres são gerados pelo Easypanel e enviados para o bucket Cloudflare R2:
- **Painel Cloudflare:** Acesse o painel Cloudflare → menu lateral esquerdo **R2** → clique no bucket **`vexo-backups`**.
- **Caminho dentro do bucket:** `vexo/db-vexo/`
- **Nome do arquivo:** Possui o formato `<timestamp>.sql.gz` (exemplo: `2026-09-12T...sql.gz`). Tamanho: aproximadamente 22 MB, tanto compactado quanto descompactado (o formato custom já é comprimido internamente).
- **Identificação do snapshot:** Ordene a listagem por **Last Modified** (Mais recente) para localizar o último dump íntegro.
- *(Alternativa via Easypanel)*: Acesse `http://72.61.37.181:3000` → Projeto `vexo` → Serviço `db-vexo` → Aba **Backups**. O destino configurado é **R2 Backups**.

> ⚠️ **AVISO CRÍTICO 1 — A extensão `.sql.gz` ENGANA (Formato Custom):**  
> Embora o arquivo termine em `.sql.gz`, ele **NÃO** é um script SQL puro compactado. O Easypanel gera o dump via `pg_dump -Fc` (formato binário Custom, magic bytes `PGDMP`).  
> **NUNCA tente rodar `gunzip -c ... | psql`**, pois o `psql` não lê o formato custom binário e falhará imediatamente com erro de encoding ou caracteres nulos. A restauração deve ser feita com **`pg_restore`**.

> ⚠️ **AVISO CRÍTICO 2 — Versão do PostgreSQL (17.x ou superior):**  
> O dump foi gerado no **PostgreSQL 17.10** (formato de arquivo `1.16-0` com diretivas de segurança `\restrict` / `\unrestrict`). O banco de destino e os binários de restauração **PRECISAM ser PostgreSQL 17.x ou superior**.  
> Versões anteriores (Postgres 16, 15, etc.) recusarão o arquivo com erro: `pg_restore: error: unsupported version (1.16) in file header`. No Easypanel, sempre selecione a imagem oficial PostgreSQL 17.

### 2. Como baixar o arquivo
1. No painel do Cloudflare R2 (`vexo-backups` → pasta `vexo/db-vexo/`):
   - Localize o arquivo `.sql.gz` mais recente.
   - Clique nos três pontos laterais (`...`) da linha do arquivo e clique em **Download**.
   - Salve o arquivo na sua máquina ou no servidor (ex: pasta `~/Downloads`).
2. *(Opcional via terminal se tiver CLI/R2 configurado)*:
   ```bash
   aws s3 cp s3://vexo-backups/vexo/db-vexo/<nome-do-arquivo>.sql.gz ./backup-latest.sql.gz \
     --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   ```

### 3. Como restaurar em um banco novo (SEM tocar em produção)

#### Método Recomendado: Subir um serviço temporário no Easypanel (1 minuto)
1. Acesse o Easypanel em `http://72.61.37.181:3000`.
2. Entre no projeto **`vexo`**.
3. No canto superior direito, clique em **+ Serviço** → selecione **PostgreSQL** (garanta que é PostgreSQL 17+).
4. Defina o nome do serviço:
   - Se for teste descartável: **`db-temp`**.
   - Se for substituição definitiva de emergência: **`db-vexo-novo`**.
5. Clique em **Criar**. O Easypanel subirá um container Postgres novo em instantes.
6. **Restaurar os dados no novo banco:**
   - **Opção A (Pelo Easypanel - Backups):**
     1. Na página do novo serviço (`db-temp` ou `db-vexo-novo`), vá na aba **Backups**.
     2. Vincule o destino **R2 Backups** e aponte para o arquivo correspondente.
     3. Clique no botão **Restaurar**.
   - **Opção B (Pelo Console do Easypanel via pg_restore — COMANDO TESTADO):**
     1. Na página do novo serviço, clique no ícone de terminal **`>_` (Console)**.
     2. Execute a restauração direta via pipe com `pg_restore`:
        ```bash
        gunzip -c /caminho/backup.sql.gz | pg_restore -U postgres -d vexo --no-owner --no-privileges
        ```
     *(Alternativa descompactando antes para arquivo `.dump`):*
     ```bash
     gunzip -c /caminho/backup.sql.gz > /tmp/backup.dump
     pg_restore -U postgres -d vexo --no-owner --no-privileges /tmp/backup.dump
     ```
     *(Se por qualquer motivo precisar converter para texto SQL plano legível pelo psql):*
     ```bash
     gunzip -c /caminho/backup.sql.gz | pg_restore -f - | psql -U postgres -d vexo
     ```

### 4. Como validar e comparar o banco restaurado
Antes de apontar qualquer tráfego, abra o console (`>_`) do banco restaurado e compare as contagens com produção:
```sql
SELECT 'leads' AS tabela, count(*) AS contagem, clock_timestamp() AS horario FROM public.leads
UNION ALL
SELECT 'lead_messages', count(*), clock_timestamp() FROM public.lead_messages
UNION ALL
SELECT 'gd_contracts', count(*), clock_timestamp() FROM public.gd_contracts
UNION ALL
SELECT 'gd_proposals', count(*), clock_timestamp() FROM public.gd_proposals
UNION ALL
SELECT 'campaigns', count(*), clock_timestamp() FROM public.campaigns;
```
> **Nota operacional:** Pequenas variações em `lead_messages` são esperadas devido a mensagens recebidas pelo webhook entre a hora do dump e o momento da consulta. Tabelas zeradas ou diferenças drásticas indicam problema no dump ou na restauração.

### 5. Como apontar o backend para o banco restaurado
Se o teste de integridade passou e você precisa colocar o banco restaurado no ar:
1. No Easypanel (`http://72.61.37.181:3000`) → Projeto `vexo` → Serviço **`bk-vexo`**.
2. Vá na aba **Ambiente** (Environment Variables).
3. Localize a variável `DATABASE_URL`:
   - Altere o host para o novo serviço (na rede interna do Easypanel o host é `vexo_<nome-do-serviço>`):
     ```env
     DATABASE_URL=postgresql://<usuario>:<senha>@vexo_db-vexo-novo:5432/vexo?sslmode=disable
     ```
   *(Obs: os dados de `<usuario>`, `<senha>` e porta do novo banco ficam visíveis na aba **Ambiente** ou **Credenciais** do próprio serviço novo).*
4. Clique em **Salvar**.
5. **OBRIGATÓRIO:** Clique no botão **Deploy** no topo do serviço `bk-vexo`.  
   *(Atenção: Apenas clicar em "Restart" NÃO recria o container com o novo env; é estritamente necessário dar **Deploy**).*
6. **Validar a conexão na ponta:**
   - Teste direto na API: `curl https://vexo-backend.xdvm8y.easypanel.host/health`
   - Verifique se o JSON retorna `"postgresPing": true`.
   - Teste final: acesse `https://crm.vexoia.com/api/health` e faça login no CRM para confirmar a listagem dos leads.
7. Se foi apenas um teste em banco descartável (`db-temp`), após coletar as contagens basta excluir o serviço `db-temp` no Easypanel (ícone de lixeira) para liberar recursos do servidor.

## Regra de ouro
Nunca desligue/apague o recurso antigo antes de validar o novo **pela ponta** (`crm.vexoia.com`).
Sempre com backup do banco antigo em mãos.

## Servidor antigo (a desativar)
Easypanel `187.77.52.167`: projeto `bks/bk-vexo` (backend antigo) e `apps/db-vexo`
(database `vexo-data`, user `dbvexo`). Não confundir com `bks/bk-gestao` (produto separado
LF Soluções, usa Supabase — nada a ver com o VexoCrm).

## Segredos
Rotacionar periodicamente e nunca commitar/printar: senha do Postgres, GROQ_API_KEY,
tokens Slack/Evolution/Resend, FIREBASE_PRIVATE_KEY. Ficam em Easypanel → bk-vexo → Ambiente.
