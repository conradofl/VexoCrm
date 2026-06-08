# CLAUDE.md — Regras permanentes do projeto Vexo OS

Este arquivo é lido em TODA sessão. São regras de comportamento que valem sempre, independente da etapa. Mantê-lo curto: cada regra aqui nasceu de um erro real e evita um dano irreversível. Não inflar com preferências de estilo.

## 1. Diff antes de descartar — NUNCA jogue trabalho fora sem comparar

Antes de descartar, sobrescrever ou ignorar QUALQUER branch, arquivo ou trabalho (seu, do Conrado ou do Luiz), faça primeiro o diff/auditoria e mostre o que tem dentro, com evidência (arquivo:linha). Trabalho dado como "perdido" já foi resgatado intacto mais de uma vez neste projeto. Comparar é barato; refazer é caro.

## 2. Audite a main do parceiro antes de construir

O Luiz (LuizApenas) commita na main sem avisar. Antes de construir qualquer feature, verifique os commits recentes da main e confirme o que já existe. Já aconteceu de construirmos algo que ele já tinha feito. Sempre cheque antes.

## 3. Evidência, não afirmação

Nunca diga "funciona", "testado" ou "existe" sem mostrar a prova: log, retorno real, query, diff, arquivo:linha. Quem executa roda o teste e cola a saída real. O orquestrador valida o relato — ele NÃO roda o código e não afirma que testou.

## 4. Escrita destrutiva precisa de autorização explícita

Commit, push, merge, rebase, troca de branch, apagar arquivo, alterar config de git/remote: PARE e peça confirmação ao Conrado antes, a menos que ele já tenha autorizado aquele passo específico nesta sessão. Em dúvida, pergunte.

## 5. Banco é PostgreSQL; "Supabase" no código é nome herdado

O banco é PostgreSQL (Easypanel, db-vexo). Não existe serviço Supabase ativo. O código ainda está nomeado "Supabase" como rótulo herdado apontando pro Postgres. NÃO renomeie Supabase→Postgres em massa — o Luiz já tentou e quebrou migration. Trate "Supabase" no código como sinônimo da conexão PostgreSQL atual.

## 6. Segredos nunca em arquivo

Credenciais, PAT, tokens: só em variável de ambiente, nunca versionado, nunca em `_memoria/`, nunca em URL de remote. Se encontrar um token exposto, não use, não commite, avise o Conrado na hora.

## 7. Repo canônico = Repo B (~/Documents/vexo-sales-module)

Todo trabalho vai pro Repo B, alinhado com a origin/main do Luiz. O Repo A (Desktop/VexoCrm) é descartado — não usar.

## 8. Multi-tenant sempre

Todo dado novo é isolado por tenant/client_id. Nenhuma query nova sem filtro de tenant. Nunca leitura cruzada entre clientes.
