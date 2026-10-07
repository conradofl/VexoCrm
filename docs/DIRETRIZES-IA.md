# Diretrizes para Agentes de IA & Engenharia — Vexo OS

## 1. Regra de Build Limpo & Validação de Tipos Obrigatória (MANDATÓRIO)
- `vite build` **NÃO FAZ** verificação de tipos estática (usa Rollup/Esbuild que apenas faz strip de tipos).
- Variáveis não declaradas (como `ReferenceError: isSelected is not defined`) e erros de escopo passam despercebidos pelo `vite build` se não for executado o compilador TypeScript.
- **Definição de "Build Limpo"**: Todo commit/PR de frontend DEVE rodar e passar com 0 erros em:
  1. `npm --prefix frontend exec tsc -- --noEmit -p frontend/tsconfig.app.json` (ou `npx tsc --noEmit -p tsconfig.app.json` dentro da pasta `frontend/`)
  2. `npm --prefix frontend run build`
  3. `npm --prefix frontend run test -- --run`
- **Nenhum código vai para commit ou produção sem a aprovação explícita do `tsc --noEmit`.**

## 2. Boot Recovery & Controle de Lotes
- Lotes de disparo com status `'paused'` **NUNCA** podem ser retomados automaticamente pelo servidor ou pelo worker de boot-recovery. A pausa é uma decisão explícita e irrevogável do usuário até que ele clique manualmente em "Retomar".
- Lotes órfãos com status `'running'` (quando o servidor reiniciou durante a execução) devem ser colocados em `'paused'` com motivo legível ao usuário (*"Pausado — servidor reiniciou durante o envio. Retome quando quiser."*), exigindo ação do usuário para retomar com segurança.

## 3. Isolamento Multi-Tenant
- Toda query e mutação no banco de dados deve filtrar obrigatoriamente por `client_id` via `resolveAuthorizedClientId(req, res, clientId)`.
- Nenhuma leitura ou escrita cruzada entre clientes é permitida.

## 4. Exclusão em Massa de Leads (Proteção por Padrão)
- A exclusão em massa de leads é irreversível e o sistema não tem desfazer.
- A proteção por padrão fica mantida: leads que vieram de mais de uma importação ou que já trocaram mensagem continuam protegidos por padrão (`includeMultiImport: false`, `includeWithMessages: false`).
- Para incluí-los na exclusão, o usuário precisa declarar explicitamente marcando as respectivas caixas de seleção na interface.
