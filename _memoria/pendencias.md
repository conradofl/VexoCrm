# Pendências — Vexo OS

> Tarefas abertas por prioridade. Só fato confirmado.
> Última atualização: 2026-06-10.

---

## 🔬 EM VALIDAÇÃO AGORA

### Fatia 3a v2 — motor anti-ban (memoizado)
- Commit `1aacb0c`. Deploy automático em andamento.
- Fix: `_evolutionInstancesSchemaEnsured` + `_evolutionDailyUsageSchemaEnsured` — ALTER/CREATE rodam uma vez por processo, nunca no caminho quente.
- **Cenário A:** `daily_limit_override = 1` em 1 chip → disparar 3 leads → deve pausar com "Cota diaria atingida em todos os chips ativos."
- **Cenário B:** 2 chips conectados → cota do 1º esgota → rotação silenciosa para o 2º sem pausar.
- Schema no banco já existia (criado pela 3a original `3232ec3`) — ensure pula na inicialização.

---

## 🔴 PRÓXIMAS FATIAS (ordem)

### 3b: UI de configuração de cota — EM CONSTRUÇÃO em Tenants.tsx
- Dropdown frio/aquecido + barra de progresso + campo `daily_limit_override` por chip.
- **Sendo construída em `Tenants.tsx` (Empresas)** por enquanto — é onde os dados de instância já vivem.
- **PENDÊNCIA UX:** mover ou espelhar a gestão de chips para a tela `Conexoes.tsx` (menu Disparos).
  - `Conexoes.tsx` é atualmente um placeholder vazio ("Em construção").
  - O cliente no modo Disparos vai procurar seus chips lá, não em Empresas.
  - `Tenants.tsx` é admin/Sistema; `Conexoes.tsx` é a casa certa para o cliente ver e gerenciar seus chips.
  - Decisão futura: espelhar os chips do tenant logado em Conexões (sem CRUD completo de empresa), ou redirecionar.
- **Depende:** Fatia 3a validada.

### Painel de saúde dos chips (encaixa na 3b)
- Barra por chip: enviadas hoje / limite, estado (frio/aquecido), conectado.
- Dados já existem em `evolution_instance_daily_usage`.
- Transforma anti-ban invisível em feature vendável para o operador.

### Opt-out por palavra-chave
- Detectar "pare / sair / remover" no inbound → marcar lead para não receber.
- Maior redução de denúncia por esforço — denúncia ("Spam"/"Bloquear") é o principal gatilho de ban.

### Aviso proativo de cota aos 80%
- Antes de pausar no 100%, notificar operador que o chip está a 80% do limite do dia.

### Fatia 2 do QR — status automático de conexão
- Webhook `CONNECTION_UPDATE` da Evolution → backend marca instância como `connected/disconnected` → frontend exibe badge.
- **Adiada por decisão** — refresh manual é tolerável por ora. Retomar quando volume de chips justificar.

### Fatia 3 do QR — re-gerar QR sem recriar instância
- Backend chama `instance/connect` (ou equivalente Evolution) para forçar novo QR em instância existente.
- Workaround atual: Remover → Criar de novo. UX ruim mas funciona.

### Disparo recorrente semanal
- Escolher dias da semana + horário; repete toda semana automaticamente.
- Hoje só existem Manual e Agendado (data/hora única).
- Requer nova lógica de agendamento no backend (cron/job) + nova UI.
- **Não implementar antes de E3 validada.**

---

## 🟡 MELHORIAS DE BAIXO CUSTO / ALTO VALOR

### Relatórios de envio
- Gráfico de envios por dia/por chip usando `evolution_instance_daily_usage`.
- Remove o menu de relatórios de placeholder; entrega algo real sem construir infra nova.

### Teste automatizado de cota e concorrência
- A 3a só tem validação manual até agora.
- Cobrir: reserva atômica sob incremento concorrente, rotação round-robin, devolução de cota em falha.

---

## 🔧 DÍVIDAS TÉCNICAS / HIGIENE

### Pente-fino de visualização (UI) — tema claro E escuro
- **Auditoria de textos/labels cortados** nos blocos da UI. Exemplos observados: "Limite cu...", "Nome da ins...", "API Key Evoluti...", "Aquecido...".
- **Solução preferida:** tooltip no hover mostrando o texto completo (melhor que reduzir a fonte — reduzir fonte piora legibilidade).
- **Verificar contraste de cor** dos textos em tema claro E escuro — há palavras pouco legíveis em um ou outro tema.
- É polimento de UX. Fazer numa passada dedicada **depois das features core** (anti-ban 3b/opt-out/relatórios).

### Staging obrigatório antes do primeiro cliente
- Hoje valida direto na `main` — risco tolerável enquanto só temos testes internos.
- **GATILHO:** primeiro onboarding real (Umuarama ou outro). Antes desse dia, definir staging.
- Resolver login local quebrado (Firebase do Repo A) ou criar caminho de staging separado.

### Causa raiz dos arquivos " 2"
- Lixo de Finder/iCloud que reaparece (18+ cópias com sufixo " 2" no backend).
- Investigar origem no fluxo de cópia antes de só limpar — pode reaparecer.
- Comando para listar: `find backend -name "* 2*" -not -path "*/node_modules/*"`

### Limpar instâncias de teste na Evolution
- Instâncias fantasma: "teste", "Testando 12", "teste-2-teste-2", "Valor atípico".
- Baixo risco, alta bagunça visual no manager.

### Migrar disparo de loop-no-Express para BullMQ
- Hoje `runCampaignDispatch` roda como fire-and-forget no processo do Express.
- BullMQ dá retry, persistência, visibilidade. Dívida, não urgente — só importa em escala.

### Sincronização de exclusão Vexo↔Evolution
- Excluir instância no Vexo não chama `DELETE /instance/{name}` na Evolution → instâncias zumbi acumulam.
- Fix: endpoint DELETE deve chamar a Evolution antes de remover do banco.

### UX: separar fluxos de criação de instância
- Tela atual mistura "Criar na Evolution" (provision completo) e "Adicionar manual" (só banco).
- Separar em duas seções com intenção clara. Baixa prioridade, funcional hoje.

---

## 🌱 PRODUTO / FUTURO

### CONSELHEIRO.md
- Destilar o modo de trabalho que funcionou: diagnóstico antes de conserto, fatia validável, fumaça antes de leitura, evidência não afirmação.
- Referência interna para novos agentes e para o Conrado orientar sessões futuras.

### Ferramenta de Aquecimento de chip
- Ciclo de 5–7 dias de trocas de mensagens → promove chip de `frio` → `aquecido`.
- Gancho obrigatório com a 3a: ao concluir o ciclo, atualizar `chip_state = 'warm'` na instância — alimenta a cota correta automaticamente.

### Pacotes comerciais + permissão granular (Passo 2)
- Filtro de ferramentas por pacote/cliente no sidebar.
- Placeholder já existe em `AppSidebar.tsx`. Só implementar quando pacotes forem definidos.

### Coleta de leads não-frios
- Formulários opt-in, grupos de interesse, campanhas de captação → lead "quente" antes do primeiro disparo.
- Redução estrutural de ban: denúncia vem quase exclusivamente de contato frio.
- Orientar roadmap de captação quando a operação escalar.

### P4: Paleta de marca
- Código usa `#6366F1` (Electric Indigo) + `#22D3EE` (Cyan Neon).
- Materiais de cliente usam `#ff7a1a` (laranja) como cor primária.
- Decidir paleta oficial antes de qualquer redesign de superfície.

---

## ✅ RESOLVIDOS

- ~~Dois checkouts diferentes~~ → Repo canônico = Repo B. Repo A descartado.
- ~~PAT exposto na URL do origin~~ → PAT revogado e removido.
- ~~Migration `connections` pendente~~ → DESCARTADA (entidade oficial = `lead_client_evolution_instances`, Luiz PR #120).
- ~~Alternador Vendas/Disparos no AppSidebar~~ → Implementado (`e4017cc`). Cores: `#6366F1` Vendas, `#ff7a1a` Disparos.
- ~~Lista de instâncias sempre "0"~~ → Corrigido (`maskN8nSettings`). Commit `7821d20`.
- ~~QR descartado no provision~~ → Corrigido (hook tipado + modal de QR). Commit `7821d20`.
- ~~Bug `parseOptionalUuid` — disparo HTTP 400~~ → Corrigido e validado. Commit `bc7c00e`.
- ~~E1: Disparo ponta a ponta~~ → **✅ VALIDADA em produção (2026-06-09).** 3 mensagens entregues.
- ~~Fatia 3a travada em "running"/0 enviados (ALTER TABLE no caminho quente)~~ → Revertida (`d60d811`) + v2 memoizada subida (`1aacb0c`). Em validação.
- ~~Disparo preso em "running" para sempre (query travada em lock, sem timeout)~~ → `statement_timeout`/`query_timeout` de 30s no pool pg (`e24b5a4`). Query em lock agora morre em 30s → disparo cai em `failed` (visível) em vez de pendurar.
- ~~Defeito A: re-envio do mesmo lead no mesmo disparo~~ → Elegibilidade idempotente por disparo (`8abde88`). `campaign_dispatch_runs` estendida (lead_id, claimed_at, status 'claimed', UNIQUE(dispatch_id,lead_id)); claim ON CONFLICT antes do envio; `buildDispatchLeads` exclui leads já tocados; failed sai do reprocesso; endpoint `GET /api/campaigns/dispatches/:id/failed` (CSV). **Falta gate live:** rodar mesmo disparo 2x → 0 elegíveis (depende do DB de produção).
