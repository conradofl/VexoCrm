# Pendências — Vexo OS

> Tarefas abertas por prioridade. Só fato confirmado.
> Última atualização: 2026-06-13.

---

## Em validação agora

### Anti-reenvio por disparo — gate live

- Implementado na `main` via `20260612060000_dispatch_runs_lead_claim.sql` + lógica em `backend/src/server.js`.
- Comportamento esperado: ao rodar o mesmo disparo novamente, leads já tocados naquele `dispatch_id` ficam fora da elegibilidade.
- Validação pendente: executar o mesmo disparo 2x em produção/staging e confirmar que a segunda execução retorna 0 elegíveis ou pula todos por claim existente.
- Evidência necessária: print/log do dispatch e consulta/registro em `campaign_dispatch_runs` com `lead_id`.

### Anti-ban 3a v2 — validação live final

- Motor de cota/rotação/delay está na `main`.
- Schema de instâncias Evolution foi memoizado para evitar `ALTER TABLE` no caminho quente.
- Cenário A pendente: `daily_limit_override = 1` em 1 chip, disparar 3 leads, confirmar pausa por cota diária atingida.
- Cenário B pendente: 2 chips conectados, cota do 1º esgota, rotação silenciosa para o 2º.
- Registrar resultado em `_memoria/aprendizados.md` quando validado.

---

## Próximas entregas

### Opt-out por palavra-chave

- Detectar inbound com termos como "pare", "sair", "remover".
- Marcar lead como não contatável para campanhas futuras.
- Alto valor anti-ban: reduz denúncia e bloqueio.

### Aviso de cota aos 80%

- Notificar operador antes do chip bater 100% da cota diária.
- Origem dos dados: `evolution_instance_daily_usage`.
- Pode aparecer no painel de chips e/ou notificações.

### Disparos — tela operacional dedicada

- `frontend/src/pages/Disparos.tsx` ainda é placeholder.
- Construir visão de lotes/disparos em massa, status, falhas e ações.
- Não duplicar `LeadImports.tsx`; decidir se `Disparos` vira visão operacional dos runs ou se `LeadImports` permanece a tela principal de campanha.

### Aquecimento de chip

- `frontend/src/pages/Aquecimento.tsx` ainda é placeholder.
- Regra de negócio pendente: ciclo, volume, janela, promoção de `chip_state = 'cold'` para `'warm'`.
- Ao concluir ciclo, atualizar instância para `warm` para alimentar limite padrão maior.

### QR/status automático

- Hoje há provisionamento/QR e refresh manual.
- Próximo passo: webhook `CONNECTION_UPDATE` da Evolution atualizar `connected/disconnected` no banco e refletir no frontend.
- Não remover legado `whatsapp.js` sem evidência.

### Regerar QR sem recriar instância

- Workaround atual: remover e criar de novo.
- Melhor: endpoint backend chamando `instance/connect` ou equivalente da Evolution para gerar novo QR em instância existente.

---

## Dívidas técnicas e produto

### Excluir instância no Vexo também na Evolution

- `deleteLeadClientEvolutionInstance` remove do banco.
- Pendência: chamar API Evolution para deletar instância remota antes/depois do delete local.
- Evita instâncias zumbi no manager.

### Migrar disparo de campanha para BullMQ

- Hoje o caminho principal de campanha roda no Express como execução em background.
- BullMQ já existe no projeto e dá retry, persistência e visibilidade.
- Não é bloqueador imediato, mas vira prioridade quando volume real crescer.

### Teste automatizado de cota/rotação/concorrência

- Cobrir reserva atômica sob concorrência, rotação round-robin, devolução de cota em falha e status quando todos os chips batem limite.
- Hoje ainda depende de validação manual/harness.

### Pente-fino visual claro/escuro

- Conferir labels cortados, tooltips, contraste e responsividade em `Tenants`, `Conexoes`, `EvolutionChipsPanel`, `Relatorios` e `LeadImports`.
- Erros observados anteriormente: labels truncados sem tooltip e contraste fraco em um dos temas.

### Staging antes de primeiro cliente real

- Hoje muitos gates ainda dependem de main/produção.
- Antes de onboarding real de cliente, definir ambiente staging ou processo equivalente com banco seguro.

### Limpeza de arquivos e lixo local

- Investigar origem de arquivos com sufixo `" 2"` se reaparecerem.
- Comando de auditoria: `find backend -name "* 2*" -not -path "*/node_modules/*"`.

### Limpar instâncias de teste na Evolution

- Instâncias fantasma observadas antes: "teste", "Testando 12", "teste-2-teste-2", "Valor atípico".
- Fazer apenas com acesso ao manager/API correta e confirmação de que não são usadas.

---

## Resolvidos / movidos para estado atual

- Repo local atual confirmado em `main` e `origin/main` atualizado em 2026-06-13.
- `Conexoes.tsx` deixou de ser placeholder e agora renderiza `EvolutionChipsPanel` por tenant.
- `Relatorios.tsx` deixou de ser placeholder e entrega relatório v1 de envios por dia/chip.
- Painel de chips foi extraído para `frontend/src/components/EvolutionChipsPanel.tsx`.
- Sidebar modular Vendas x Disparos está implementada em `AppSidebar.tsx`.
- Lista/QR de instâncias Evolution e bug `parseOptionalUuid` já estavam resolvidos.
- `statement_timeout`/`query_timeout` e memoização de schema mitigaram travamento por lock em `ALTER TABLE`.
- Defeito A anti-reenvio está implementado; permanece só gate live.
