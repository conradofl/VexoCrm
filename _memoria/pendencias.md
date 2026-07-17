# Pendências — Vexo OS

> Tarefas abertas por prioridade. Só fato confirmado.
> Última atualização: 2026-07-17.

---

## Próxima fila — módulo GD

### Redesign de pacotes: abordagem ad_hoc + segmento (em andamento)
- Problema: hoje cada proposta cria uma linha em `gd_packages` (biblioteca global) → tela lotando, gambiarra de prefixo de letra por segmento.
- Abordagem escolhida (não snapshot profundo): marcar pacote da proposta como `ad_hoc=true` (some da biblioteca) + coluna `segmento` real. Reaproveita todo o pipeline — `gd_proposals.itens` já é o snapshot do que é vendido; `package_id`/`pacotes_ofertados` são só referências hidratadas por lookup de ID (que NÃO filtra ad_hoc). Public proposal hidrata via `id = ANY(...) AND ativo = true` (sem filtro ad_hoc). Ver `decisoes.md` 2026-07-17.
- **FATIA 1 — FEITA (a shipar):** migration `20260717160000_add_adhoc_segmento_to_packages.sql`; backend (GET filtra `ad_hoc=false` + filtro `?segmento`; POST/PUT aceitam `ad_hoc`/`segmento`); tela Pacotes (campo Segmento + filtro + badge). Mata a gambiarra da letra.
- **FATIA 2 — PENDENTE:** montador inline na tela de Propostas (`GeracaoDigitalProposals.tsx`, 85KB) — botão "Criar pacote pra esta proposta" que faz POST com `ad_hoc=true` + segmento da apresentação, injeta no wizard (`newPacotesOfertados`/`availablePackages`) sem re-fetch. Opcional "salvar como modelo" = PUT `ad_hoc=false`. É a peça que entrega a dor principal (pacote específico da proposta sem sujar a biblioteca). Backend já pronto pra isso.

### Briefings por tenant (opcional)
- `geracao_digital_briefings` não tem `tenant_id` → contador de briefings do dashboard é global. Se quiser por tenant, adicionar coluna + migração de dados + filtro.

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

### Gate Evolution após incidente `/instance/fetchInstances`

- CRM já mitigou loop: `EvolutionAdmin` busca remoto só manualmente e backend usa cache/dedupe.
- Pendente operacional: validar em produção que abrir `EvolutionAdmin` não chama `/instance/fetchInstances` sem clicar "Buscar Evolution".
- Pendente infra Evolution: manter/criar no banco da Evolution o índice `idx_message_instance_remotejid_status_fromme_false` em `public."Message"` para a query de unread/status não varrer tabela inteira.
- Quando a Evolution estabilizar, testar "Buscar Evolution" uma vez e confirmar que retorna instâncias sem saturar CPU/I/O.

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

- Loop do CRM em `/instance/fetchInstances` foi mitigado: busca remota manual (`?remote=true`) + cache/dedupe backend.
- Writer do chatbot alinhado ao schema real de `lead_messages`; não usa mais colunas fantasmas `lead_phone/role/content`.
- Pós-disparo deixou de gravar `status_conversa = "campanha_enviada"` e usa `aguardando_usuario` + `followup_status = "pending"`.
- Inbound de grupo/broadcast descartado cedo.
- Repo local atual confirmado em `main` e `origin/main` atualizado em 2026-06-16.
- `Conexoes.tsx` deixou de ser placeholder e agora renderiza `EvolutionChipsPanel` por tenant.
- `Relatorios.tsx` deixou de ser placeholder e entrega relatório v1 de envios por dia/chip.
- Painel de chips foi extraído para `frontend/src/components/EvolutionChipsPanel.tsx`.
- Sidebar modular Vendas x Disparos está implementada em `AppSidebar.tsx`.
- Lista/QR de instâncias Evolution e bug `parseOptionalUuid` já estavam resolvidos.
- `statement_timeout`/`query_timeout` e memoização de schema mitigaram travamento por lock em `ALTER TABLE`.
- Defeito A anti-reenvio está implementado; permanece só gate live.
