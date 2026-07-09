# Relatório de Arquitetura de Navegação - Vexo OS

## 1. Mapeamento de Rotas (React Router)

| Rota | Componente | Acesso | Descrição / Função Principal |
|---|---|---|---|
| `/` e `/home` | `LandingPage` | Público | Página inicial de apresentação pública do sistema. |
| `/login` | `Login` | Público | Autenticação de usuários. |
| `/cadastro-cliente` | `ClientSignup` | Público | Registro self-service de novos clientes (empresas). |
| `/set-password` | `SetPassword` | Autenticado | Definição de senha inicial no primeiro login. |
| `/aguardando-aprovacao` | `PendingApproval` | Usuário Pendente | Tela de espera para usuários aguardando liberação manual. |
| `/crm/dashboard` | `Dashboard` | Admin/Interno | Visão geral de métricas, kpis e relatórios gerais da operação. |
| `/crm/leads` | `Leads` | Admin/Interno | Gestão e listagem da base de leads, com ações individuais e de edição. |
| `/crm/planilhas` | `LeadImports` | Admin/Interno | Importação de contatos via planilha e distribuição para campanhas. |
| `/crm/inteligencia-comercial`| `CommercialIntelligence`| Admin/Interno | Análise de performance da equipe e parametrização de regras de distribuição de IA. |
| `/crm/agente` | `Agente` | Admin/Interno | Visão geral ou interface de teste/monitoramento do Agente de IA. |
| `/crm/chatbot` | `ChatbotKanban` | Admin/Interno | Gestão visual (formato Kanban) do funil de leads atendidos pelo Chatbot. |
| `/crm/inbound-agents` | `InboundAgentConfig` | Admin/Interno | Configuração de comportamento de agentes IA para atendimento receptivo (Inbound). |
| `/crm/chatbot-settings` | `ChatbotSettings` | Admin/Interno | Configurações avançadas, edição de prompts e templates do Chatbot de vendas. |
| `/crm/chatbot-docs` | `ChatbotDocs` | Admin/Interno | Documentação interativa e visualização da arquitetura de fluxos de conversa. |
| `/crm/followup` | `FollowupQueue` | Admin/Interno | Fila de engajamento de leads, análise de cadência e aprovação de sugestões. |
| `/crm/usuarios` | `UserAccessManagement` | Admin/Interno | Gerenciamento de acessos e permissões granulares de usuários internos/clientes. |
| `/crm/empresas` | `Tenants` | Admin/Interno | Criação e gestão do cadastro de clientes (empresas/tenants) no sistema. |
| `/crm/integracoes` | `WebhooksIntegrations`| Admin/Interno | Configuração de webhooks e integrações com N8N ou CRMs terceiros. |
| `/crm/conexoes` | `Conexoes` | Admin/Interno | Gestão e QR Code para instâncias de WhatsApp e canais de atendimento. |
| `/crm/aquecimento` | `Aquecimento` | Admin/Interno | Painel de controle da rotina e cadência de aquecimento de chips de WhatsApp. |
| `/crm/relatorios` | `Relatorios` | Admin/Interno | Geração, filtros e exportação de relatórios gerenciais avançados. |
| `/crm/livpub` | `LivPub` | Admin/Interno | Módulo específico de publicação e automações da LivPub. |
| `/crm/eventos` | `Eventos` | Admin/Interno | Gestão de disparos e tracking relacionados a fluxos de eventos presenciais/online. |
| `/crm/relacionamento` | `Relacionamento` | Admin/Interno | Módulo focado no engajamento e relacionamento com uma base de clientes de catálogo. |
| `/crm/onboarding` | `OnboardingWizard` | Admin/Interno | Wizard passo a passo para setup inicial simplificado da conta. |
| `/crm/apresentacao` | `VexoPitch` | Admin/Interno | Tela de apresentação comercial interativa (Pitch) para prospectar clientes Vexo. |
| `/crm/apresentacao-gd`| `GeracaoDigitalPitch`| Admin/Interno | Tela de apresentação interativa específica para prospects do produto Geração Digital. |
| `/crm/briefings-gd` | `GeracaoDigitalBriefings`| Admin/Interno | Listagem e visualização dos dossiês/briefings que a IA construiu para a GD. |
| `/crm/evolution-admin`| `EvolutionAdmin` | Admin Exclusivo | Painel técnico administrativo para visão global das instâncias do Evolution API. |
| `/clientes/:clientId/dashboard`| `ClientPortalDashboard`| Cliente/Interno | Painel restrito ao cliente final com métricas simplificadas e filtradas. |
| `/clientes/:clientId/leads` | `ClientPortalLeads` | Cliente/Interno | Base de leads com visão restrita unicamente aos contatos daquele cliente. |
| `/clientes/:clientId/planilhas`| `ClientPortalPlanilhas`| Cliente/Interno | Área para o cliente final realizar suas próprias importações de leads. |
| `/clientes/:clientId/whatsapp`| `ClientPortalWhatsApp` | Cliente/Interno | Inbox de caixa de entrada em tempo real focado no cliente final. |

---

## 2. Dependências e Fluxos em Sequência (Jornadas do Usuário)

* **Criação de Conta e Liberação de Acesso**: 
  O fluxo começa passando por **Empresas (`/crm/empresas`)** para provisionar o cliente, seguindo para **Usuários (`/crm/usuarios`)** para vincular o dono à empresa dando-lhe permissões, e finalizando em **Conexões (`/crm/conexoes`)** para escanear o QR Code do WhatsApp.
* **Execução de Disparos em Massa (Campanhas)**: 
  O operador realiza o upload de uma base na tela de **Planilhas (`/crm/planilhas`)**, mapeando as colunas. Em seguida, as mensagens são processadas e começam a aparecer na fila de cadência dentro da tela de **Followup (`/crm/followup`)** ou podem ser conferidas unitariamente em **Leads (`/crm/leads`)**.
* **Configuração do Cérebro de IA (Agente IAM)**: 
  O fluxo se inicia ajustando parâmetros de persona e prompts em **Chatbot Settings (`/crm/chatbot-settings`)**, conferindo a árvore de decisão visualmente em **Chatbot Docs (`/crm/chatbot-docs`)**, e no dia-a-dia a operação monitora a triagem na tela de **Chatbot Kanban (`/crm/chatbot`)**.

---

## 3. Componentes Reutilizados entre Múltiplas Telas

* **`PageShell`**: O invólucro (layout container) de 100% das páginas internas (`/crm/*`), que garante título, breadcrumbs, subtítulo e ações padrão sempre alinhadas no topo.
* **`EvolutionChipsPanel` / `EvolutionInstanceCard`**: Reutilizados nativamente nas telas de *Aquecimento*, *Conexões* e *EvolutionAdmin* para centralizar todo o controle de conexões com o WhatsApp (incluindo renderização unificada de QR Code).
* **`EmptyState`**: Exibido em listagens vazias em quase todos os domínios para instruir o usuário (Leads, Followup, Empresas, etc).
* **`InternalPagesHierarchyPanel`**: O checklist de hierarquia e acessos a módulos, reutilizado fortemente na tela de controle de Usuários Internos.
* **`PageBanner` / `PresentationHeader`**: Banners de navegação dinâmicos focados nas telas interativas (Onboarding Wizard e Pitches Comerciais).

---

## 4. Oportunidades de Consolidação (Telas com < 2 Funções vs. Abas)

Analisando a arquitetura atual, identificamos telas que orbitam uma mesma área de negócios e possuem poucas subfunções isoladas, caracterizando grandes candidatos a se tornarem **abas (`Tabs`)** de uma única tela controladora:

1. **Unificação do Ecossistema de IA (Agente/Chatbot)**:
   * **Problema:** As telas `/crm/agente`, `/crm/chatbot`, `/crm/chatbot-settings`, `/crm/chatbot-docs` e `/crm/inbound-agents` ficam dispersas no menu lateral.
   * **Solução:** Deveriam ser consolidadas na tela primária `/crm/agente` contendo sub-abas (Ex: *Operação/Kanban*, *Configuração/Prompts*, *Inbound* e *Documentação*).
2. **Unificação de Configurações Técnicas Base**:
   * **Problema:** `/crm/integracoes` (N8N/Webhooks) e `/crm/conexoes` (WhatsApp) são configurações pontuais e diretas.
   * **Solução:** Consolidação em uma única página genérica de `Configurações da Empresa` com abas para *Canais de Mensagem* e *Integrações*, reduzindo a carga do menu de navegação lateral.
3. **Unificação de Modelos de Pitch**:
   * **Problema:** `/crm/apresentacao` e `/crm/apresentacao-gd` são clones de layout para fins discursivos levemente diferentes.
   * **Solução:** Fundir ambas em uma única tela `/crm/apresentacao` com um select ou abas no topo permitindo trocar o "Modelo de Deck" (Vexo ou Geração Digital).

---

## 5. Proposta de Arquitetura Consolidada (Hierarquia Visual)

Baseada nas oportunidades acima e contemplando todos os módulos do ecossistema:

**━━ OPERAÇÃO ━━**
* **Dashboard**
* **Conversas** ← Leads + Kanban como toggle de visão (lista/kanban/inbox)
* **Follow-up**
* **Campanhas** ← funde Planilhas (import) + disparo + Relatórios de envio

**━━ INTELIGÊNCIA ━━**
* **Int. Comercial**
* **Relatórios**

**━━ AGENTE IA ━━** ← UMA tela, `/crm/agente`, com abas:
* Operação (Kanban) | Treinamento & Prompts | Inbound | Documentação

**━━ CANAIS ━━**
* **Chips WhatsApp** ← Conexões + Aquecimento + Evolution Admin (aba admin-only)

**━━ MÓDULOS ━━** ← renderizado dinamicamente por tenant
* **[Geração Digital]** → Apresentação | Briefings | Onboarding Slack
* **[LivPub]** → Painel | Relacionamento | Eventos

**━━ AJUDA & SETUP ━━**
* **Treinamento Vexo** ← O antigo Onboarding Wizard, focado em educar o cliente humano.

**━━ ADMIN ━━** ← visão restrita interna
* **Empresas | Usuários | Integrações**
* **Apresentação Vexo** ← pitch unificado com seletor de deck (Vexo/GD/white-label)
