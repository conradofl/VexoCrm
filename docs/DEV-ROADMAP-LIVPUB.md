# Roadmap de Desenvolvimento Interno — Vexo × LivPub

Este documento detalha tecnicamente a execução do projeto LivPub, traduzindo o cronograma de negócios em **arquivos e tarefas de código específicas**, divididas exatamente nas 4 semanas do setup.

> **Estratégia de Produto (Fork / White-label):**
> O serviço da LivPub será algo "à parte". Vamos utilizar a base atual do VexoCRM para acelerar o desenvolvimento inicial, mas, ao final deste cronograma, **o projeto será "forkado" para rodar em servidores e bancos de dados próprios exclusivos do cliente.**
> Isso significa que **não precisamos de abstrações extremas para multi-tenancy** nas lógicas específicas da LivPub (podemos "hardcodar" regras de negócio da LivPub em módulos dedicados sem medo de sujar o Vexo genérico, pois esta base se tornará a base oficial deles).

---

## 👥 Organização do Time

| Dev | Papel / Track | Foco Técnico |
|---|---|---|
| **Conrado** | **Track A** | Módulo de Eventos (Backend), Integrações (Pagamentos) e Esteiras 1, 2 e 5. |
| **Luiz** | **Track B** | Extensão de Leads, Catálogo de Segmentação, Frontend Base e Esteiras 3 e 4. |

---

## 📅 SEMANA 01: Fundação Técnica e Base de Dados
**Foco:** Deixar a estrutura pronta para que o restante do projeto flua sem bloqueios. 
*Nota: A refatoração do Motor de Follow-up (Jornadas Event-driven) já foi concluída na `main` remota pelo Conrado.*

### Conrado (Foco Backend Core / Track A)
- **[x] [Fase 0] Refatoração do Motor de Follow-up (Jornadas Event-Driven)**
  - *Status:* Já implementado (`fup_journeys`, `EventDispatcherController.js`).
- **[Fase 0] Stub de Pagamentos**
  - *Arquivo:* `backend/src/payments/paymentLink.js` (Novo)
  - *Ação:* Criar interface genérica de pagamentos (integração real travada pela Cl. 5ª).
- **[Track A] Banco de Dados e Backend**
  - *Arquivo:* `backend/supabase/migrations/YYYYMMDD_create_events_table.sql` (Tabela `events`).
  - *Arquivo:* `backend/src/domains/eventos/routes.js` (CRUD básico de eventos e injeção no router principal).

### Luiz (Foco Dados e Interface / Track B)
- **[Fase 0] Placeholders no Frontend (Navegação Base)**
  - *Arquivos:* `frontend/src/App.tsx`, `frontend/src/components/AppSidebar.tsx`
  - *Ação:* Criar rotas `/crm/eventos` e `/crm/relacionamento` e stubs em `frontend/src/pages/`.
- **[Track B] Extensão do Modelo de Lead (Migração)**
  - *Ação:* Como será um fork, garantir que a tabela `leads_infinie` (ou a nova `leads_livpub`) possua os atributos: `data_nascimento`, `ultima_visita`, `perfil_musical`.
- **[Track B] Catálogo de Segmentação**
  - *Arquivo:* `backend/src/server.js` (Função `buildDefaultSegmentationConfig`)
  - *Ação:* Adicionar preset `livpub`:
    ```javascript
    livpub: [
      { id: "perfil", label: "Perfil Musical", field: "perfil_musical", type: "category", enabled: true },
      { id: "visita", label: "Última Visita", field: "ultima_visita", type: "date", enabled: true },
      { id: "nascimento", label: "Nascimento", field: "data_nascimento", type: "date", enabled: true }
    ]
    ```

---

## 📅 SEMANA 02: Início das Esteiras Core e Automação
**Foco:** Lógica das campanhas principais baseada na nova estrutura de Jornadas (`fup_journeys`).

### Conrado (Track A)
- **Esteira 1 (Pré-venda de eventos)**
  - *Ação:* Lógica de dispatch de jornada baseada no cadastro do evento, enviando mensagens automáticas N dias antes da data, injetando o stub de pagamentos.

### Luiz (Track B)
- **Início da Esteira 4 (Reativação)**
  - *Arquivo:* `backend/src/followup/automationEngine.js`
  - *Ação:* Estruturar filtro da automação usando o catálogo de segmentação (ex: `ultima_visita < NOW - X dias`).

---

## 📅 SEMANA 03: Esteiras Complexas e Inteligência Artificial
**Foco:** Finalizar as jornadas automatizadas e aplicar prompts específicos de IA.

### Conrado (Track A)
- **Esteira 2 (Camarote VIP / High-ticket)**
  - *Arquivos:* `backend/src/campaign-ai.js` ou interface de IA da jornada.
  - *Ação:* Prompts de negociação VIP focados em venda assistida.
- **Esteira 5 (Pós-evento)**
  - *Ação:* Lógica de gatilho `after_event` para agradecimento e cupom.

### Luiz (Track B)
- **Esteira 3 (Aniversariantes)**
  - *Arquivo:* `backend/src/followup/automationEngine.js` (ou job específico).
  - *Ação:* Validação diária (`data_nascimento == hoje`) gerando sugestões automáticas.
- **Finalizar Esteira 4 (Reativação)**
  - *Ação:* Acoplar engine à IA de abordagem para reengajamento.

---

## 📅 SEMANA 04: Frontend, Integração e Go-Live
**Foco:** Entregar as interfaces funcionais, testar e homologar para o Fork.

### Conrado (Track A)
- **Interface de Eventos**
  - *Arquivo:* `frontend/src/pages/Eventos.tsx`
  - *Ação:* Tela listando eventos, CRUD completo e dashboard visual do status das Esteiras 1, 2 e 5 acopladas a cada evento.

### Luiz (Track B)
- **Interface de Relacionamento**
  - *Arquivo:* `frontend/src/pages/Relacionamento.tsx`
  - *Ação:* Tela listando segmentos dinâmicos e configuração das Esteiras 3 e 4.

### Conrado & Luiz (Testes / QA Compartilhado)
- **[QA]** Testes end-to-end (E2E) simulando eventos e validando as Jornadas.
- **[Operação]** Integrações Zig/Sympla se acordadas.
- **[Go-Live]** Realização do **Fork do repositório** para a infraestrutura dedicada da LivPub.
