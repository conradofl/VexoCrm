# Aprendizados — Vexo OS

> Append-only. O que deu certo/errado e a lição. Só fato confirmado.

## 2026-06-08
- **Renomear "Supabase"→"Postgres" no código quebra migrations.** O Luiz tentou, commitou numa branch e reverteu. Lição: tratar "Supabase" como sinônimo da conexão PostgreSQL atual e só tocar nessas referências com evidência de que não quebra migration.
- **4 terminais em paralelo compartilham o mesmo rate limit da conta.** Rodar T1–T4 juntos esgotou o limite 4× mais rápido e travou todos antes de qualquer um concluir — inclusive o T1 (gate). Lição: priorizar o T1 sozinho até travar o contrato da Conexão; só então abrir T2/T3/T4. Ou subir de plano se for rodar em paralelo de verdade.
- **Diretório canônico de migrations é `backend/supabase/migrations/` (42 arquivos), NÃO `frontend/supabase/migrations/` (19).** Aplicadas via `backend/scripts/conditional-migrate.mjs` nos hooks `predev`/`prestart`. Nova migration vai em `backend/`. (Cheguei a suspeitar que o T1 errou o caminho; estava certo.)
- **Higiene de segredos.** Já houve incidente de key vazada (resolvido). Lição: credenciais nunca em arquivo versionado nem em arquivo de memória — só variável de ambiente com validação na inicialização.
- **Auditar a main do parceiro ANTES de construir qualquer feature.** O Luiz implementou multi-instância Evolution, pause/resume, QR via API REST e onboarding dinâmico (PR #120, PR #119, commit d17462d — tudo em 06–07/jun) sem avisar. Resultado: nosso T1 criou uma tabela (`connections`) e T2 projetou um wrapper que duplicariam trabalho já mergeado. Lição: antes de projetar entidade ou módulo novo, rodar `git log origin/main --oneline -20` e auditar commits recentes do parceiro.
- **Caminho duplo de QR é risco latente em produção.** Luiz adicionou QR via Evolution REST (`server.js:1969–2005`) mas `whatsapp.js` + `whatsapp-web.js` ainda coexiste. Os dois podem conflitar. Remover o legado só com evidência de que não quebra — é E2 do roadmap.
- **Dois checkouts locais do mesmo repo = divergência garantida.** T1 gravou no Repo A, T3/T4 no Repo B, T2 não foi encontrado em nenhum. Lição: definir repo canônico no início da etapa, fixar em ORQUESTRACAO.md, e NÃO deixar terminais em checkouts diferentes.
