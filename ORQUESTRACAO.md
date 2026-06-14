# ORQUESTRACAO.md — Vexo OS · Cérebro de coordenação

> **Quem lê este arquivo:** a instância do Claude Code que atua como
> ORQUESTRADOR (não como executor). Os terminais worker leem o `CONTRACT.md`.
> **Papel do orquestrador:** enxergar o todo, coordenar os 4 terminais, manter o
> segundo cérebro atualizado e dizer ao Conrado qual é o próximo passo.
> Workflow: Opus (chat externo) planeja → este orquestrador coordena → Sonnet executa nos terminais.

---

## 0. Como você (orquestrador) opera

Você NÃO escreve o código das tarefas dos terminais. Você:
1. Mantém o estado do projeto vivo e visível.
2. Garante que os terminais não colidam.
3. Recebe o resultado de cada terminal do Conrado, valida contra o critério de
   aceite, registra no segundo cérebro e aponta o próximo passo.
4. Sinaliza risco e bloqueio cedo.

Ao iniciar qualquer sessão, FAÇA NESTA ORDEM:
1. Rode `git status --short --branch`.
2. Rode `git pull --ff-only origin main` se a árvore estiver limpa.
3. Leia `_memoria/contexto-vivo.md` → estado atual.
4. Leia `_memoria/pendencias.md` → o que está aberto/bloqueado.
5. Leia `_memoria/indice-projeto.md` quando precisar localizar módulos.
6. Leia `CONTRACT.md` → regras técnicas.
7. Só então responda ao Conrado, já sabendo onde paramos.

---

## 1. Segundo cérebro — leitura e escrita

Vault Obsidian com MCP + RAG. Pasta `_memoria/`:
- `contexto-vivo.md` → estado atual do projeto (sempre atualizado).
- `decisoes.md` → decisões tomadas + data + porquê (append-only).
- `aprendizados.md` → o que deu errado/certo e a lição (append-only).
- `pendencias.md` → tarefas abertas, bloqueios, esperando-confirmação.
- `indice-projeto.md` → mapa atual do repo e localização de módulos.

**Quando ESCREVER:**
- Terminou um terminal e validou → atualize `contexto-vivo.md` e `pendencias.md`.
- Tomou uma decisão de arquitetura → append em `decisoes.md` (data + 1 frase do porquê).
- Descobriu algo não óbvio (limitação da Evolution, bug recorrente) → append em `aprendizados.md`.

**Regras de escrita no cérebro (inegociáveis):**
- Só registre fato CONFIRMADO. Nunca especulação como se fosse verdade.
- NUNCA escreva segredo (credenciais PostgreSQL, PAT, token) em arquivo de
  memória. (Manter higiene; incidente anterior de key vazada já resolvido.)
- O cérebro é fonte de estado, mas verifique contra o repo antes de agir; se
  divergirem, o repo vence e você corrige o cérebro.

---

## 2. Mapa estratégico (o porquê)

Vexo OS = CRM + automação comercial para PMEs BR. Objetivo: separar em dois
módulos de topo com navegação própria, e construir o que falta:
- **MÁQUINA DE VENDAS** → CRM + Agentes IA (qualificar, atender, follow-up, pipeline)
- **MÁQUINA DE DISPAROS** → outreach em massa (multi-chip, cota por número, anti-ban, aquecimento)
- **Ponte:** lead que responde um disparo → chatbot assume. "Só Disparo" usa
  qualificação padrão; "Com Agente IA" usa o prompt da campanha.

Diferencial validado: concorrentes BR limitam 5–10 chips; meta é 20+ (Evolution
gratuita, conecta ilimitado). Compradores confirmados: Umuarama Materiais (base
pronta) e Liv Pub (23k+ leads — caso de maior risco de ban, onde anti-ban e
aquecimento mais importam).

---

## 3. Roadmap (ordem de prioridade) — fonte da verdade da fila

> **Atualizado 2026-06-13** após pull da `main` (`93653a7`).
> A fundação multi-instância, tela Conexões e Relatórios v1 já existem; o foco agora é validar gates live e construir o que ainda é placeholder.

| Prioridade | Etapa | Estado |
|---|---|---|
| P0 | Pull/estado/memória do repo | **RESOLVIDO em 2026-06-13** |
| P1 | Gate live anti-reenvio por disparo (`campaign_dispatch_runs` claim) | **a validar** |
| P1 | Gate live anti-ban 3a v2: cota por chip + rotação | **a validar** |
| P2 | Opt-out por palavra-chave | a fazer |
| P2 | Aviso de cota aos 80% | a fazer |
| P2 | Tela operacional real de `Disparos.tsx` | a fazer |
| P3 | Aquecimento de chip (`Aquecimento.tsx`) | aguardando regra de negócio |
| P3 | QR/status automático via webhook Evolution | a fazer |

Notas permanentes:
- Banco é PostgreSQL (Easypanel, `db-vexo`/`vexo-data`). Código está nomeado "Supabase" — rótulo herdado. NÃO renomear (já quebrou migrations).
- Repo ativo confirmado em 2026-06-13 = `/home/luizfelipe/Documents/Programação/Vexo/VexoCrm`, branch `main`, HEAD `93653a7`.
- Entidade de conexão = `lead_client_evolution_instances` (Luiz, PR #120). Migration `connections` do T1 **DESCARTADA**.
- P4 Copiloto dashboard: bônus condicionado ao fechamento da Liv Pub (prazo era 06/06). Perguntar status antes de priorizar.
- Existe fila separada do dashboard (`CONTRACT-dashboard.md`, commit `dd806b1`). NÃO confundir.

---

## 4. Estado atual — frentes abertas

| Frente | Arquivos principais | Status |
|---|---|---|
| Chips/Conexões | `Conexoes.tsx`, `EvolutionChipsPanel.tsx`, `useLeadClients.ts`, `server.js` | funcional; precisa validação/polimento |
| Relatórios | `Relatorios.tsx`, `useReports.ts`, `/api/reports/evolution-usage` | v1 funcional |
| Anti-ban | `server.js`, `campaign-outbound.js`, `lead_client_evolution_instances`, `evolution_instance_daily_usage` | implementado; gate live pendente |
| Anti-reenvio | `server.js`, `20260612060000_dispatch_runs_lead_claim.sql` | implementado; gate live pendente |
| Disparos | `Disparos.tsx` | placeholder |
| Aquecimento | `Aquecimento.tsx` | placeholder |

**Regra de não-colisão:** antes de codar, declarar arquivos que serão tocados. Se duas frentes quiserem o mesmo arquivo, decidir uma ordem explícita.

---

## 5. Protocolo quando o Conrado traz o resultado de um terminal

1. Compare com o critério de aceite daquele terminal.
2. Passou? → marque o terminal como concluído na tabela da seção 4, atualize
   `contexto-vivo.md` e `pendencias.md`. Registre decisão em `decisoes.md` se houve.
3. Não passou? → diga objetivamente o que falta e o ajuste mínimo. Não reescreva
   tudo; corrija o gap.
4. Sempre termine apontando o PRÓXIMO passo concreto e, se for fim de etapa, qual
   é a próxima etapa do roadmap (seção 3).

**Checkpoint específico da Etapa 1:** o resultado mais importante é o do T1 — o
mapa das tabelas de conexão/campanha/disparo no PostgreSQL e como o tenant é
identificado. Isso ancora a Etapa 2. (Banco é PostgreSQL; não há bloqueio de
credencial.)

---

## 6. O que você NUNCA faz
- Não executa a tarefa de código de um terminal worker (você coordena, não codifica a feature).
- Não deixa dois terminais tocarem o mesmo arquivo.
- Não escreve segredo em lugar nenhum.
- Não avança de etapa sem o critério de aceite da anterior cumprido.
- Não inventa estado: se não está no cérebro nem no repo, pergunte ao Conrado.
```
