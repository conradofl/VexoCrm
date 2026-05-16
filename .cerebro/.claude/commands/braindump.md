---
name: Braindump Command
type: command
tags: [#command, #universal, #quick]
created: 2026-05-09
---

# /braindump

**Executa:** Captura rápida de ideias, logs, bugs encontrados  
**Frequência:** Sempre que algo acontece (várias vezes/dia)  
**Tempo:** 30 segundos  
**Argumentos:** Sim, opcionais (texto da ideia/log)

---

## Identidade

Sou seu gravador de voz. Jogues ideias, descobertas, bugs, aprendizados aqui e eu salvo tudo em logs de sessão. Sem estrutura, sem filtro — puro fluxo de consciência que fica registrado.

---

## Argumentos

### Sem argumentos
```
/braindump
```
Abre input para você digitar/colar.

### Com argumentos
```
/braindump Descobri que tenantScope.js tem vazamento de memória
/braindump Bug: campaign-outbound retorna undefined em prod
/braindump Ideia: usar Redis para cache de leads
```

---

## Passos (execução interna)

1. Ler input (argumentos ou texto digitado)
2. Timestamp automático
3. Detectar tipo: #bug, #idea, #learning, #insight, #block
4. Salvar em `_sessions/[DATA].md`
5. Confirmar: "✅ Registrado"

---

## Output esperado

```markdown
# Sessão — 9 de maio 2026

[14:32] 🐛 Bug: campaign-outbound retorna undefined em prod
→ Possível causa: DATABASE_URL não definida em deploy
→ Action: Verificar EasyPanel env vars

[14:45] 💡 Ideia: usar Redis para cache de leads
→ Benefício: Query ao Postgres cai 80%
→ Trade-off: Infraestrutura extra
→ Ao: Testar em staging antes

[15:20] 📚 Learning: Edge Functions precisam de middleware custom
→ Aplicação: Migrar conversation-memory para novo pattern
→ Fonte: Erro de timeout que descobri testando

[15:45] 🚧 Bloqueador: Aguardando review de tenantScope.js
→ Depende: @alguém fazer review
→ Workaround: Comecei a documentar entretanto
```

---

## Regras

- ✅ **Sem filtro** — jogues como é, não precisa ficar perfeito
- ✅ **Timestamp automático** — sabe exatamente quando aconteceu
- ✅ **Tags automáticas** — detecto #bug, #idea, #block
- ✅ **Rápido** — 5 segundos, não vai atrasar seu fluxo
- ✅ **Vai pro log** — historicamente rastreável em `_sessions/`

---

## Use quando

- Encontrou um bug
- Teve uma ideia rápida
- Descobriu algo novo (learning)
- Ficou bloqueado
- Fez uma descoberta
- Quer lembrar daqui a 2 meses

---

## Exemplo de sessão

```
09:15 — /daily-briefing
        → Prioridades carregadas

09:30 — /braindump Começando bug em campaign-outbound.js

10:15 — /braindump Descobri: falta validação de phoneNumber
        → Causa: schema mudou e rota não atualizada

10:45 — /braindump Ideia: criar middleware genérico de validation

11:00 — /decide Vou criar validadores em src/validators.js
        → Raciocínio: Reutilizável, testável, centralizado

14:30 — /braindump Done: Bug fixado e validação implementada
        → Teste: Passou 15 casos

18:00 — /end-session
        → Consolida tudo (incluindo logs de /braindump)
```

---

## Próximo: consolidar com /end-session

No final do dia, `/end-session` lê todos os `/braindump` e consolida:
- Bugs → vira decisão ou learning
- Ideias → vai para `_pipeline/`
- Blockers → vai para `current-state.md`

