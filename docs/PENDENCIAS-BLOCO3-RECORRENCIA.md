# Pendências — Bloco 3 (campanha recorrente)

Registradas em 12/10/2026, na entrega do Bloco 3. Cada item tem dono a definir; nenhum bloqueia o uso da recorrência.

## 1. Botão de gerar variações no painel de recorrência

Hoje o painel avisa quando faltam variações do texto (e, com público de planilha, recusa o salvamento) e manda o dono
ao passo da mensagem, onde o gerador (`generateCampaignTemplateVariants`) já existe. Não há botão de gerar dentro do
painel. Regra a manter quando for feito: **nada é gerado sem o dono pedir** — o botão gera, mostra e só entra na
campanha depois que o dono aceitar.

## 2. Roteiro do agente sem cópia por ocorrência

O lote criado pela ocorrência (`materializeDueRecurringOccurrences`) nasce com `campaign_prompt_id = NULL`: quem
responder é atendido pelo roteiro da **campanha**. O lote manual (`POST /api/campaigns/:id/dispatches`) copia o
roteiro para o lote, para que editar a campanha não mude disparo em andamento. Para a recorrência ficar igual,
a ocorrência precisa da mesma cópia.

## 3. Nove testes da tela que já falhavam no HEAD limpo

Conferido em 12/10/2026 rodando a suíte da tela numa worktree limpa do HEAD (`007cf97`) e na árvore com o
Bloco 3: **as mesmas 9 falhas nos dois**. Não são do Bloco 3, e não podem virar ruído que todo mundo aprende a ignorar.

`src/test/planTier.test.ts`
- planTier resolver > recognizes all aliases across modulos_avulsos in n8n_settings or root

`src/test/dashboardCustomPeriodPage.test.tsx`
- Página do dashboard — período personalizado > [TESTE OBRIGATÓRIO] 'Personalizado' sem datas aplicadas não consulta, mantém o seletor e pede as datas; ao aplicar, consulta com o intervalo
- Página do dashboard — período personalizado > [TESTE OBRIGATÓRIO] 'Atualizar agora' recalcula o MESMO intervalo
- Página do dashboard — período personalizado > intervalo recusado pelo servidor: o erro aparece e o seletor continua na tela para escolher outro

`src/test/bancoDeDadosServerList.test.tsx`
- … totais da base degradam POR PARTE … > parte 'summary' falha: as outras três chegam à tela e o aviso fala só dela
- … totais da base degradam POR PARTE … > parte 'channels' falha: as outras três chegam à tela e o aviso fala só dela
- … totais da base degradam POR PARTE … > parte 'sources' falha: as outras três chegam à tela e o aviso fala só dela
- … tags agrupadas por tipo e campanha por planilha > o seletor de tags vem agrupado (Planilhas, Grupos e origem, Rótulos da IA, Minhas), sem perder nenhuma tag

`src/test/academyRecipes.test.tsx`
- Vexo Academy — conteúdo (fundamentos e receitas) > [TESTE OBRIGATÓRIO] os onze segmentos aparecem no filtro
  — passa sozinho; falha por tempo (5 s) só na suíte inteira. Também no HEAD limpo.
