# DIRETRIZES-IA.md — Regras obrigatórias para qualquer IA que edita este repositório

> Este arquivo existe porque erros reais quebraram a produção. Leia inteiro antes de
> tocar em código, banco, deploy ou segredo. As regras não são sugestões: cada uma
> nasceu de um incidente que derrubou o sistema ou vazou credencial.
>
> Companheiro obrigatório: **[INFRA.md](INFRA.md)** (topologia de produção e runbooks).

---

## 0. As 5 leis (se ler só isto, leia isto)

1. **NUNCA** escreva senha, token ou connection string com credencial no código. Sempre `process.env`.
2. **SEMPRE** rode `node --check <arquivo>` em cada arquivo backend alterado, e `tsc` no frontend, **antes** de commitar. Boot que não compila = produção fora.
3. **SEMPRE** valide pela ponta (`crm.vexoia.com`), não só pelo backend direto, antes de dizer que está pronto.
4. **NUNCA** afirme que algo foi corrigido sem ter rodado o comando que prova. "Deve funcionar" não é verificação.
5. **NÃO** adicione código, tabela, seed ou comentário que não seja estritamente necessário para a tarefa. Menos linhas, menos superfície de erro.

---

## 1. Verificar QUAL banco e QUAL backend estão vivos (antes de qualquer diagnóstico)

**Incidente:** horas perdidas depurando o backend errado. O frontend apontava para um
backend antigo (`bks-bk-vexo`, servidor 187.77.52.167) cujo banco tinha sido desligado.
O backend novo e saudável (`vexo/bk-vexo`, 72.61.37.181) estava certo o tempo todo.

**Regra:** antes de investigar qualquer erro 500, confirme o caminho real da requisição:

- **Qual backend o frontend chama?** Veja `frontend/vercel.json` → `rewrites` → `destination`.
  E a env `VITE_API_BASE_URL` na Vercel (hooks que usam `${API_BASE_URL}/api/...` vão por ela,
  não pelo rewrite). Os dois têm que apontar para o **mesmo** backend novo.
- **O backend está vivo e no banco certo?** Abra `https://<backend>/health`. Confira
  `postgresPing: true` e `databaseTarget` (host/porta/database). Se o host não for o banco
  novo, o problema é config, não código.
- **Teste pela ponta:** `crm.vexoia.com/api/health`, não só o backend direto. Isso valida
  front → rewrite → backend → banco.

Se os logs do backend que você olha **não mudam** quando você reproduz o erro, você está
olhando o backend/instância errado. Pare e ache o certo antes de continuar.

**Estado atual correto** (confirme sempre em INFRA.md, pode mudar):
- Backend prod: `https://vexo-backend.xdvm8y.easypanel.host` (porta interna 3001).
- Banco: `vexo_db-vexo:5432/vexo` (host interno, servidor 72.61.37.181).
- Servidor velho `187.77.52.167` (projetos `bks`, `apps`) está **TOTALMENTE DESATIVADO** — não tente conectar nele nunca mais. O acesso de fora/scripts à base de produção é exclusivamente através da API do backend em `https://vexo-backend.xdvm8y.easypanel.host`.

---

## 2. Segredos: nunca no código, nunca no git

**Incidente:** a senha do Postgres foi hardcoded em **3 arquivos** e commitada no GitHub
(`geracaoDigitalRoutes.js`, `superadmin/routes.js` e `SuperAdmin.tsx` — este último ia
inteiro pro bundle do navegador, visível a qualquer usuário). Resultado: senha exposta no
histórico do repo, obrigando rotação de credencial.

**Regras:**
- Credencial (senha, token, API key, connection string com senha) **só** via `process.env`.
  Se precisar de um banco de origem para migração, use `process.env.LEGACY_DB_URL` ou receba
  a URL no corpo da requisição em runtime — **nunca** embutida.
- **JAMAIS** ponha segredo em arquivo do `frontend/`. Tudo em `frontend/src` vai para o
  bundle público. Segredo no frontend = segredo vazado.
- Antes de commitar, rode: `grep -rn "postgres:\|apikey\|secret\|token=" backend/src frontend/src | grep -v process.env`
  e confirme que não há credencial literal.
- Arquivos de exploração/scratch (`scratch_*.js`, dumps) **não** entram no git e **não**
  contêm senha. Apague ao terminar.

---

## 3. Não polua o código nem crie coisa desnecessária

**Incidentes:**
- Um bloco de "auto-migração transparente em background" (`setImmediate`) rodava a cada boot,
  embutia senha e copiava tabelas do banco legado — **redundante** (a migração já era pontual
  e manual) e **perigoso**. Removido.
- Tabelas "core" foram criadas automaticamente com **schema errado/mínimo** (ex.: `leads` sem
  as colunas que o chatbot exige), gerando `column ... does not exist`.
- Seeds de propostas/briefings **fabricados** foram inseridos, poluindo dados reais.

**Regras:**
- Migração de dados é **operação pontual**, não código que roda a cada boot. Não deixe rotinas
  de cópia de banco no caminho de inicialização.
- Não crie tabela por conta própria "chutando" o schema. Se uma tabela falta, confirme o
  schema **real** (do banco de origem ou do código que a consome) antes de criar/alterar.
  Preferir `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` sobre recriar.
- **Nunca** insira dados fabricados (seeds falsos de clientes/propostas). Dado inventado é pior
  que dado ausente.
- Cada linha adicionada é superfície de bug. Se não é necessária para a tarefa, não adicione.

---

## 4. Corrija a causa, não o sintoma. E não esconda erro.

**Incidente:** um endpoint que dava 500 foi "estabilizado" com `.catch(() => [])`, devolvendo
lista vazia e escondendo o erro real (o backend estava em crash loop por um `SyntaxError`, e
outras rotas quebravam por schema). O sintoma sumiu do console, a causa continuou.

**Regras:**
- Antes de propor correção, ache a causa raiz. Um 500 em "todas as rotas" quase sempre é uma
  causa única (app não bootou, banco errado, middleware comum), não N bugs.
- Não envolva erro em `try/catch` que engole (`catch (e) {}` ou `.catch(() => [])`) só para o
  console ficar limpo. Logue o erro real e trate de verdade. Fallback silencioso mascara falha.
- Se o app não boota, o problema é boot (sintaxe, import, env), não a rota que aparece no log.

---

## 5. Verificação antes de afirmar (evidência, não achismo)

**Incidente:** correções foram declaradas prontas sem terem sido validadas; informações
"corrigidas" eram na verdade falsas/desatualizadas, custando confiança e tempo.

**Regras — nada é "feito" sem isto:**
- Backend alterado: `node --check` em cada arquivo. Sem exceção.
- Frontend alterado: `npx tsc -p tsconfig.app.json --noEmit` (a raiz tem `files: []`; use o
  `tsconfig.app.json`). Confirme que você não **adicionou** erro novo (compare com o baseline).
- Rota alterada: prove com uma chamada real (curl/fetch/DevTools) que retorna o esperado.
- Migração/coluna: consulte o banco e confirme que a coluna/linha existe (`information_schema`
  ou `SELECT ... LIMIT 0`).
- **DDL que "deu OK" não prova que o objeto existe.** `CREATE TABLE/INDEX ... IF NOT EXISTS` e
  `ALTER ... ADD COLUMN IF NOT EXISTS` retornam sucesso mesmo quando não criam nada (e o objeto
  pode ter sido apagado depois, por um DELETE/DROP em cascata). Sempre confirme o estado real
  com uma consulta de catálogo, e prove o comportamento:
  - índice: `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = '<tabela>';`
  - coluna: `SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = '<tabela>';`
  - se o código usa `ON CONFLICT (a, b)`, rode um INSERT de teste (e apague depois). Sem um índice
    único em `(a, b)` o Postgres responde *"there is no unique or exclusion constraint matching the
    ON CONFLICT specification"* e **todo** upsert falha em silêncio se o erro for engolido.
  Incidente real: nomes de contato não gravavam e a extração retornava 0 porque o índice único
  `(client_id, telefone)` não existia, apesar de o `CREATE ... IF NOT EXISTS` ter reportado OK.
- Ao relatar: diga o comando que rodou e o resultado. Se não rodou, diga "não verificado".
  Não escreva "corrigido" para algo que você só editou.

---

## 6. Commit e deploy

- Commite **apenas** os arquivos que você mudou de propósito. Nunca `git add -A` cego (arrasta
  scratch, dumps, `ops/`). Faça `git add <arquivos específicos>`.
- Repo correto: `~/Documents/vexo-sales-module`, remote `github.com/conradofl/VexoCrm`, branch
  `main`. Confirme com `git remote -v` e `git rev-parse --abbrev-ref HEAD` antes de push.
- **Push atualiza o GitHub; não faz deploy do backend sozinho.** O frontend (Vercel) redeploya
  no push. O backend precisa de **Implantar** no Easypanel (`vexo/bk-vexo`). Diga isso ao usuário.
- Nunca desligue/apague recurso antigo (banco, backend) antes de validar o novo pela ponta e
  ter backup. Ver INFRA.md.

---

## 7. Auditoria, métricas e relatórios (Regra permanente: número medido ou não existe)

**Incidente:** Em auditorias da fila de mensagens (aba Espera), um script sofreu timeout de rede ao tentar conectar ao banco e o agente preencheu números fictícios/estimados no relatório ("3 recentes, 143 antigas"); em outra execução, um erro HTTP 403 Forbidden foi convertido silenciosamente em lista vazia (`Array.isArray(x) ? x : []`), reportando falsamente "100% sem lead". Números falsos chegaram até o usuário como fatos e quase foram repassados a clientes em reuniões de decisão.

**Regras permanentes a partir de agora, sem exceção:**

1. **Número em relatório vem de execução real:** Se a consulta falhou ou a ferramenta deu erro, o relatório deve dizer expressamente *"não consegui medir, motivo X"*. **NUNCA** estime, **NUNCA** preencha por dedução, **NUNCA** escreva um valor que não veio diretamente do banco/API.
2. **Erro é REPORTADO, não convertido em lista vazia, zero ou valor padrão:** Erro de conexão, timeout, 401, 403 ou 500 é **REPORTADO**, não convertido em lista vazia, zero ou fallback. Script que faz `Array.isArray(x) ? x : []` sobre resposta de API está escondendo erro — scripts de auditoria devem checar `res.ok` e o corpo do erro explicitamente (`throw new Error(...)` se o status não for 200/204 ou se o payload contiver `{ error }`).
3. **Query e timestamp da execução obrigatórios:** Toda medição ou contagem vem com a query exata executada e o timestamp ISO da execução colados no relatório.
4. **Topologia do banco e proibição do IP legado:**
   - O banco de produção é `vexo_db-vexo:5432`, database `vexo`, no servidor `72.61.37.181`.
   - O acesso de fora/scripts à base de produção é exclusivamente através da API do backend em `https://vexo-backend.xdvm8y.easypanel.host`.
   - O IP `187.77.52.167` está **TOTALMENTE DESATIVADO** — não tente conectar nele nunca mais (porta 5432 ou qualquer outra).
5. **Divergência entre relatórios bloqueia implementação:** Se um relatório contradisser outro relatório anterior (contagens diferentes, faixas temporais em conflito), isso é assunto prioritário obrigatório antes de qualquer implementação. Não siga em frente com dois números.

---

## 8. CHECK constraints: verificar SEMPRE antes de gravar valor novo

**Incidente:** Múltiplas violações consecutivas de `CHECK constraint` derrubaram operações em produção e o boot-recovery de lotes órfãos (ex: `trigger_type = 'auto_resume'`, `origin_type = 'manual'`, `followup_jobs_content`, `access preset`, `lead_source`).

**Regra obrigatória:**
- Toda vez que o backend for gravar, atualizar ou fazer fallback de um valor em uma coluna com `CHECK constraint`, é **obrigatório consultar a definição da constraint** no banco ou nos arquivos de migration antes de alterar o código.
- Se o novo valor for legítimo (ex: novo trigger_type ou status), a migration que atualiza a constraint (`DROP CONSTRAINT IF EXISTS ... ADD CONSTRAINT ... CHECK (...)`) deve ser incluída e registrada em `migrate.js` **no mesmíssimo commit** da alteração do código.
- Nunca assuma que uma coluna aceita qualquer string sem validar se existe `CHECK constraint` associada.

---

## 9. Checklist final (cole mentalmente antes de dizer "pronto")

- [ ] Confirmei qual backend/banco a produção usa (health + vercel.json + VITE_API_BASE_URL).
- [ ] `node --check` passou em todos os `.js` backend alterados.
- [ ] `tsc` no frontend sem erro novo.
- [ ] Zero credencial literal no diff (`grep` por senha/token).
- [ ] Não adicionei tabela/seed/rotina de migração desnecessária.
- [ ] Não escondi erro com catch vazio nem converti erro em lista vazia.
- [ ] Se mexi em schema: confirmei coluna/índice no catálogo (não confiei no "OK" do `IF NOT EXISTS`).
- [ ] Se gravei valor em coluna com CHECK: confirmei a constraint e inclui migration no mesmo commit.
- [ ] Se apresentei métricas/contagens: reproduzi medição real, colei query e timestamp, zero dedução.
- [ ] Testei a rota/tela afetada de verdade e tenho o resultado.
- [ ] `git add` só dos arquivos certos; branch e remote conferidos.
- [ ] Avisei o usuário se precisa **Deploy** no Easypanel (backend não sobe no push).
- [ ] Nenhum script meu emite token em nome de uma pessoa; nenhuma credencial ou identificador fixo de pessoa entrou no código (seção 10).
- [ ] Se escrevi ou alterei SQL: rodei a consulta num Postgres real (pglite, seção 11), não só contra mock; se ela não rodou lá por limitação da ferramenta, disse qual e por quê, sem mudar a consulta.

---

## 10. Identidade nas chamadas, medição em produção e identificadores fixos

**Incidente:** `backend/src/scripts/measure5500Leads.js` emitia um token do Firebase no UID do Conrado, usando a credencial de administrador, e chamava a produção **como se fosse ele**. Era uma ferramenta de personificação versionada no repositório. Isso invalida a auditoria: a exclusão em massa e a correção de origem registram **quem executou**, e um script assim faz qualquer execução aparecer como sendo do dono. O arquivo foi removido (commit `4e9daa8`).

**Regras permanentes, sem exceção:**

1. **Nenhum script emite token no UID de uma pessoa.** Nem `createCustomToken`, nem ID token, nem cookie de sessão, nem JWT, na identidade do Conrado ou de qualquer ser humano — para a API de produção ou de qualquer ambiente. Precisando chamar a API com identidade, use uma **conta de serviço própria**, criada para isso, que apareça na auditoria como tal. Nunca a identidade de uma pessoa.
2. **Medição em produção é SQL só de leitura, imprimindo o host a que se conectou.** Só `SELECT`: nenhuma transação de escrita, nenhum `UPDATE`/`DELETE`/`INSERT`. O script imprime host, porta e banco no começo, para ninguém medir o banco errado sem perceber (o IP legado da seção 7 segue proibido — se o host impresso for ele, pare). Modelo: `backend/src/scripts/originFixPreviewAllTenants.js`.
3. **Credencial ou identificador fixo de pessoa não vai em código versionado.** Nem chave, nem senha, nem token, nem UID/e-mail de uma pessoa embutido para "agir como" ela. Tudo vem de `process.env` ou do corpo da requisição em runtime (seção 2 vale também para isso).
4. **A regra não é sobre leitura ou escrita: é sobre quem executa.** O agente **nunca conecta na produção** nem recebe a credencial dela; ferramenta de medição é entregue pronta para o **dono do sistema** rodar, no ambiente dele, com um `DATABASE_URL` que ele mesmo fornece. O script de medição **não é exceção à seção 7.4** (acesso do agente à produção só pela API do backend; IP legado desativado): a 7.4 continua valendo inteira para o agente.

**Nota sobre o histórico:** o histórico do git **não foi reescrito**. A chave de API do Firebase é pública por natureza e o UID não é segredo; o que dá poder é a credencial da conta de serviço, que nunca esteve no arquivo. Não reescreva o histórico por causa disso.

---

## 11. SQL escrita à mão se testa num Postgres real, não num mock

**Incidente:** três defeitos de SQL chegaram à produção aprovados por teste simulado, e os três foram pegos depois por Postgres de verdade: (1) a comparação `uuid = text` que derrubou o dashboard; (2) o erro de tipo mascarado como "tabela ausente" (`isMissingSchemaError`); (3) `NULL IN (...)` no Relatório & Auditoria, que dá NULL em vez de falso e jogava o envio do CRM em "pendente". Mock responde o que o autor da consulta espera; o banco responde o que a consulta de fato faz. Com tanta SQL escrita à mão e com a deriva de schema já mapeada, testar consulta sem banco é testar a si mesmo.

**Regra:** consulta nova ou alterada tem teste contra Postgres real. O projeto tem `@electric-sql/pglite` (Postgres compilado para WASM, em memória) como dependência de desenvolvimento do backend; o helper é `backend/src/test/helpers/pgliteDb.js` e o exemplo de referência é `backend/src/test/importAuditPostgres.test.js`, que importa a SQL do produto em vez de copiá-la. Use os tipos de produção no esquema do teste (uuid, text, jsonb, timestamptz) — um tipo mais frouxo no teste esconde justamente o `uuid = text`.

**Duas regras de uso, para o pglite não virar falsa segurança:**

1. **Passar no pglite é necessário, não é garantia.** O pglite diverge do Postgres do servidor em extensões, funções e alguns tipos. Ele prova que a consulta faz o que se espera num Postgres; não prova que roda em produção. Consulta que toca extensão, função específica da versão ou comportamento de tipo exótico ainda precisa de conferência no banco de verdade — feita pelo dono do sistema (seção 10), nunca pelo agente.
2. **Consulta que não roda no pglite por limitação dele: diga qual e por quê — nunca mude a consulta para caber na ferramenta.** A consulta é a do produto; a ferramenta é que tem limites. Registre no próprio teste qual recurso falta e por que, e cubra o resto. Adaptar a SQL à ferramenta é o jeito de a ferramenta começar a mentir.


---

## 12. Código que depende de migration tem que funcionar nos DOIS estados do schema

**Incidente (05/10/2026):** o `d657449` passou nos 2005 testes e derrubou a produção. O commit trocou a consulta de instâncias para `u.instance_id = i.id::text`, assumindo `evolution_instance_daily_usage.instance_id` já convertida para `text`. A migration que converteria não rodou no deploy, e a coluna em produção seguia `uuid`: toda consulta que carrega chips estourou `operator does not exist: uuid = text`. O salvar-configurações do tenant deu 500 (o plano não salvava), a lista de empresas do admin falhou e a Saúde dos chips quebrou. Pior: o primeiro deploy da cota por mensagem (`fdd8146`) deixaria o disparo de campanha inteiro cair, porque o erro do `INSERT` subia sem tratamento. Os testes passavam porque **todo teste rodava depois da conversão**: chamava `ensureEvolutionInstanceDailyUsageTable` à mão antes de ler, ou passava um pool próprio (o que pula o caminho de produção, `db === pgDatabasePool`). Mediam o pós-condição ("depois de converter, funciona"), não o estado do deploy ("código novo, schema antigo").

**Regras permanentes:**

1. **Código que depende de uma migration não vai no mesmo deploy que ela sem funcionar nos dois estados do schema.** Ou a consulta tolera o schema antigo e o novo (cast dos dois lados — `a::text = b::text` —, parâmetro sem cast para a coluna inferir o tipo), ou a migration vai **sozinha** num deploy anterior, confirmada em produção antes do código que a usa. Nunca "a migration roda junto, então está tudo bem": migration pode não rodar, pode falhar, pode ser recusada por permissão.
2. **Não suponha que a migration rodou.** Existem dois executores (`scripts/conditional-migrate.mjs` no `start.sh`, que derruba o container se falhar; `src/migrate.js` no boot do servidor, que NÃO derruba e só deixa o estado em `/health` → `migrations`). Qual deles rodou, ou se algum rodou, se confirma por leitura em produção (`app_schema_migrations`, `/health`, log do deploy), não por suposição.
3. **Todo teste de código que lê ou escreve coluna afetada por migration roda contra o schema ANTIGO, sem converter antes e sem chamar a rotina de conversão à mão.** Matriz código × schema: cada leitor e cada escritor reais contra cada estado em que a tabela existe em bancos reais (inclusive as FKs e os tipos de criações antigas do código), com a conversão (DDL) bloqueada. Modelos: `backend/src/test/chipQuotaSchemaMatrix.test.js` e `backend/src/test/chipQuotaDeployState.test.js` (este último usa o pool de produção, o caminho que o teste anterior pulava).
4. **Mutação que prova o requisito, não só a existência:** a mutação "tirar o cast" tem que morrer **em cada estado** em que o cast é necessário. Se ela só morre porque o teste já converteu a tabela, o teste não está medindo o que importa.
5. **Erro de infraestrutura de um contador, métrica ou cota nunca derruba o fluxo do cliente.** Trate-o à parte do resultado de negócio ("esgotada" pausa o lote; "indisponível" segue sem a cota, com o erro registrado e contado). Contador que derruba o disparo é pior que a falta do contador.
6. **DDL que falha não pode ser engolido.** `.catch(() => {})` em ALTER escondeu por semanas que a conversão nunca tinha funcionado (a FK criada em junho a impedia). Registre a falha; e quem depende do resultado tem que continuar funcionando sem ele (regra 1).
