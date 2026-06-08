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
1. Leia `_memoria/contexto-vivo.md` → estado atual.
2. Leia `_memoria/pendencias.md` → o que está aberto/bloqueado.
3. Leia `CONTRACT.md` → regras técnicas.
4. Só então responda ao Conrado, já sabendo onde paramos.

---

## 1. Segundo cérebro — leitura e escrita

Vault Obsidian com MCP + RAG. Pasta `_memoria/`:
- `contexto-vivo.md` → estado atual do projeto (sempre atualizado).
- `decisoes.md` → decisões tomadas + data + porquê (append-only).
- `aprendizados.md` → o que deu errado/certo e a lição (append-only).
- `pendencias.md` → tarefas abertas, bloqueios, esperando-confirmação.

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

> **Atualizado 2026-06-08** pós-auditoria do PR #120 do Luiz.
> A fundação multi-instância já existe; o foco agora é validar + corrigir + construir o que falta.

| Prioridade | Etapa | Estado |
|---|---|---|
| P0 | Desbloqueio: keys revogadas + banco PostgreSQL confirmado + repo canônico | **RESOLVIDO** |
| E1 | **Validar** QR ponta-a-ponta real + multi-instância em disparo (já implementado pelo Luiz, não testado) | **a fazer — PRIMEIRO** |
| E2 | **Resolver caminho duplo de QR** (REST novo vs legado `whatsapp.js`) — escolher um, isolar/remover o outro com evidência | a fazer |
| E3 | **Anti-ban REAL**: cota por número (≤200/nº/dia) + lotes + delay aleatório + tratamento de ban | a fazer — **MAIOR VALOR** |
| E4 | **Webhook fan-in**: confirmar/garantir que ouve TODAS as instâncias com roteamento por tenant | a fazer |
| E5 | **Nav Vendas × Disparos** (em cima dos arquivos novos do Luiz no Repo B) | a fazer |
| E6 | **Bugs UI**: scroll import (10/509) + status variação vermelho→verde (verificar se `LeadImports.tsx` reescrito já resolveu) | a fazer |
| — | Aquecimento de chip | aguardando regra de negócio do Conrado |

Notas permanentes:
- Banco é PostgreSQL (Easypanel, `db-vexo`/`vexo-data`). Código está nomeado "Supabase" — rótulo herdado. NÃO renomear (já quebrou migrations).
- Repo canônico = **Repo B** (`~/Documents/vexo-sales-module`). Repo A (`Desktop/.../VexoCrm`) é lixo — não usar.
- Entidade de conexão = `lead_client_evolution_instances` (Luiz, PR #120). Migration `connections` do T1 **DESCARTADA**.
- P4 Copiloto dashboard: bônus condicionado ao fechamento da Liv Pub (prazo era 06/06). Perguntar status antes de priorizar.
- Existe fila separada do dashboard (`CONTRACT-dashboard.md`, commit `dd806b1`). NÃO confundir.

---

## 4. Estado atual — Etapa 1 em 4 terminais

Lógica: T1 é o GATE (camada de dados, trava o contrato). T2/T3/T4 trabalham em
domínios que não tocam dados, então rodam em paralelo sem esperar.

| Terminal | Domínio (arquivos) | Tarefa | Status |
|---|---|---|---|
| T1 | backend / DB | Fundação multi-tenant + tabela `connections` + atualizar CONTRACT | _registre aqui_ |
| T2 | módulo novo Evolution | Cliente REST isolado (createInstance/QR/status/delete) | _registre aqui_ |
| T3 | navegação / shell / rotas | Menu Vendas × Disparos | _registre aqui_ |
| T4 | apresentação tela campanha | Status vermelho→verde + bug scroll import | _registre aqui_ |

**Regra de não-colisão (faça cumprir):** cada terminal declara os arquivos que
vai tocar ANTES de codar e para se invadir o domínio de outro. Se dois quiserem
o mesmo arquivo, você decide quem fica e adia o outro.

**Gate:** T2/T3/T4 podem rodar já; mas a integração Evolution↔banco (Etapa 2) só
começa depois que T1 travar a interface da entidade Conexão no CONTRACT.

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
