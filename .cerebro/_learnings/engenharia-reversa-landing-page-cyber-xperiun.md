---
tags: [learning, frontend, design, landing-page, canvas, cyber, vexo, vercel]
status: active
created: 2026-10-16
updated: 2026-10-16
---

# Engenharia Reversa & Arquitetura: Landing Page Cyber Minimalist (Padrão Xperiun + 21st.dev)

Guia técnico e conceitual de engenharia reversa e implementação da Landing Page de alta conversão do **Vexo OS**, inspirada no ecossistema Xperiun e aprimorada com componentes interativos de última geração (21st.dev).

---

## 1. Filosofia de Design: "Cosmic Cyber Minimalist"

O objetivo visual é transmitir autoridade corporativa e tecnologia de ponta sem recorrer à estética genérica de SaaS (fundos brancos com cards cinzas) ou ao excesso poluído de temas neon gamer.

* **Fundo Cósmico Contínuo:** Base escura em `#00000A` (quase negro com leve nuance azulada profunda), eliminando cortes secos de seção.
* **Iluminação Volumétrica Suave:** Luz violeta/índigo translúcida estilo lanterna tática que ilumina a tela conforme o usuário move o cursor.
* **Cápsula de Vidro Fosco (Glassmorphism):** Header e elementos de navegação flutuantes com `backdrop-filter: blur(18px)`, bordas sutis (`rgba(255,255,255,0.12)`) e efeito de iluminação neon no hover.
* **Tipografia Elegante:** Títulos leves (`font-weight: 300`) combinados com palavras-chave em **bold com gradiente branco-lilás**, mantendo legibilidade máxima.

---

## 2. Arquitetura em Duas Camadas Desacopladas (Hero vs. Content)

Ao invés de empilhar seções em um fluxo de documento tradicional, a página utiliza uma arquitetura de duas camadas sobrepostas:

```
┌────────────────────────────────────────────────────────┐
│  CAMADA 1: HeroLayer (Fixed Viewport - z-index: 10)    │
│  - LightBeamCanvas (Background interativo em Canvas)   │
│  - Header Cápsula + Headline + CTA + 3 Credenciais     │
│  - Efeito óptico: translateY, scale e blur via scroll  │
└────────────────────────────────────────────────────────┘
                           ▼ (Rolagem da Página)
┌────────────────────────────────────────────────────────┐
│  CAMADA 2: ContentLayer (Flow Stream - z-index: 20)    │
│  - margin-top: 100vh                                   │
│  - Atmospheric Feathering (Degradê de 140px no topo)   │
│  - Linha de horizonte neon sutil                       │
│  - Seções: Manifesto, Método, Módulos (Simulador), FAQ │
└────────────────────────────────────────────────────────┘
```

### O Segredo da Transição Suave (Atmospheric Feathering)
Para que o conteúdo suba sem "cortar" o Hero bruscamente, o topo do `ContentLayer` possui um pseudo-elemento `::before` de 140px de altura com gradiente suave de transparente para `#00000A`. Isso cria uma névoa que dissolve o Hero organicamente.

### 2.1. Barra de Navegação Fixa Global com Glassmorphism Dinâmico (`LandingNavbar.tsx`)
Para que a navegação acompanhe o usuário ao longo de toda a descida da página:
* **Desacoplamento para `z-index: 50`:** A navbar foi desacoplada do `#layer-hero` (que desvanece no scroll) e posicionada na raiz de `LandingPage.tsx` flutuando sobre todas as camadas.
* **Espaçador de Layout no Hero:** Um `<div className="hero-top-spacer h-12 sm:h-14 w-full flex-shrink-0" aria-hidden="true" />` preserva o equilíbrio visual vertical e centralização milimétrica do Hero.
* **Glassmorphism Dinâmico (`.landing-fixed-navbar.is-scrolled`):** No topo (`scrollY < 20`), a barra é transparente; ao rolar (`scrollY >= 20`), ativa automaticamente `backdrop-filter: blur(20px)` e fundo escuro translúcido (`rgba(8, 7, 18, 0.78)`), garantindo legibilidade perfeita sobre qualquer elemento.
* **Scroll Spy com Destaque Neon:** Conforme o visitante rola através de *Posicionamento*, *Método*, *Módulos* e *FAQ*, a cápsula central acende e seleciona automaticamente o item correspondente.
* **Navegação Suave (`scroll-behavior: smooth` com offset de 90px):** Clicar em qualquer item faz a página deslizar suavemente até o destino, com recuo calculado para nunca encobrir os títulos das seções. Clicar no logo VEXO OS rola de volta para o topo.

---

## 3. Iluminação Dinâmica em Canvas 2D (O Holofote 360°)

Arquivo central: `LightBeamCanvas.tsx`

### 3.1. Performance Sem Travamento (60-120 FPS cravados)
* **Zero `ctx.filter`:** Filtros de CSS/Canvas como `blur()` dentro do loop de animação consomem a GPU e causam quedas bruscas de frames. O desfoque óptico foi obtido puramente por **gradientes radiais nativos múltiplos com paradas de opacidade suaves** (`rgba(..., 0.18)` até `rgba(..., 0)`).
* **DPR Clamping:** `Math.min(window.devicePixelRatio || 1, 1.5)` para evitar consumo excessivo de memória em telas Retina 4K.

### 3.2. Cálculo de Mira em Tempo Real
Para que a luz não fique presa apontando para cima e sim acompanhe o mouse em qualquer direção da tela:

```typescript
// Ângulo exato do centro do V até a posição atual do cursor
const angleToMouse = Math.atan2(currentMouseY - cy, currentMouseX - cx);

// Ponto na tela iluminado diretamente pelo holofote
const mouseSpotGrad = ctx.createRadialGradient(
  currentMouseX, currentMouseY, 0,
  currentMouseX, currentMouseY, 260 * scale
);
mouseSpotGrad.addColorStop(0, "rgba(225, 175, 255, 0.15)");
mouseSpotGrad.addColorStop(1, "rgba(0, 0, 10, 0)");
```

### 3.3. Interpolação Lerp Sedosa
Para evitar movimentos bruscos ou teletransporte do feixe, as coordenadas do mouse passam por um filtro lerp (Linear Interpolation):
```typescript
currentMouseX += (targetMouseX - currentMouseX) * 0.046;
currentMouseY += (targetMouseY - currentMouseY) * 0.046;
```

---

## 4. Header em Cápsula com Efeito "Acender" e Seleção

Arquivo: `HeroLayer.tsx` e `landing.css`

* **Cápsula Flutuante:** Navegação reunida em uma barra pílula discreta no topo direito.
* **Efeito Hover:** Ao passar o mouse sobre cada link (*Posicionamento, Método, Módulos, FAQ*), o elemento acende com brilho neon:
  ```css
  .hero-nav-link:hover {
    color: #FFFFFF;
    background: rgba(150, 0, 255, 0.22);
    border-color: rgba(215, 145, 255, 0.45);
    box-shadow: 0 0 18px rgba(180, 75, 255, 0.55);
    transform: translateY(-1px);
  }
  ```
* **Indicador de Seleção Ativa:** Estado `is-selected` ativado pelo hash da URL ou clique, destacando a seção ativa.

---

## 5. Simulador Interativo da IA Comercial (Padrão 21st.dev)

Arquivo: `LiveChatSimulator.tsx`

Ao invés de uma imagem estática ou vídeo decorativo, a landing page possui um **playground funcional**:

1. **Entrada Scroll-Driven Lateral:** O componente desliza suavemente da direita para a esquerda (`slide-in-right`) acionado por `IntersectionObserver` quando a seção entra na tela.
2. **Chips Rápidos de Cenários:** O visitante pode clicar em prompts como *"💬 Preço 8 corretores"* ou *"📄 Gerar Minuta Contratual"*.
3. **Chat em Tempo Real:** Usuário pode digitar qualquer texto na caixa de entrada. O agente simula delay de raciocínio com indicador *"Vexo Commercial Agent consultando acervo..."* e ponto verde pulsante.
4. **Geração Modular de Contrato PDF:** O agente entrega o cartão clicável do arquivo `Minuta_Contratual_Vexo.pdf`.
5. **Modal Renderizado via Portal (`createPortal`):**
   * Como containers animados utilizam `transform: translateX()`, elementos com `position: fixed` ficam confinados ao container pai e podem ser cortados.
   * **Solução:** O modal utiliza `createPortal(modalContent, document.body)`, renderizando diretamente no topo da árvore DOM com backdrop blur de alta densidade.
6. **Simulação de Assinatura ICP-Brasil:** Permite ao usuário clicar em *"Simular Assinatura Digital"* e ver a chancela verde *"Contrato Assinado! ✍️"* ao vivo.

---

## 6. Prevenção de Cortes em Telas de Laptops (Viewport Height Responsiveness)

* **O Erro Comum:** Definir `flex: 0 0 50%` no conteúdo superior e `50%` no conteúdo inferior. Em telas de laptop (ex: 1366x768 ou 1470x732), somando a altura do header (~60px), o rodapé ultrapassa a tela e o texto inferior é cortado.
* **A Solução:**
  * `.hero-inner` usa `display: flex; flex-direction: column; justify-content: space-between; height: 100%;`
  * `.hero-content` usa `flex: 1 1 auto; justify-content: center;`
  * `.hero-bottom` usa `flex-shrink: 0; padding-bottom: clamp(16px, 3vh, 32px);`
  * O texto de autoridade permanece 100% visível, legível e com respiro inferior em qualquer resolução.

---

## 7. Roteamento Inteligente Multidomínio (Vercel)

O repositório utiliza uma estratégia onde o **mesmo build frontend** atende tanto a Landing Page pública quanto o CRM privado:

```typescript
// frontend/src/App.tsx
export function RootRouteHandler() {
  const { isAuthenticated, defaultRoute } = useAuth();
  
  // Se acessado por crm.vexoia.com -> Redireciona para login ou dashboard
  if (isCrmDomain()) {
    return <Navigate to={isAuthenticated ? defaultRoute : "/login"} replace />;
  }
  
  // Se acessado por vexoia.com, www.vexoia.com ou localhost -> Renderiza a Landing Page
  return <LandingPage />;
}
```

* **Vantagem:** Não há necessidade de gerenciar múltiplos repositórios ou múltiplos projetos Vercel. Basta apontar o domínio institucional (`vexoia.com`) e o subdomínio do CRM (`crm.vexoia.com`) para o mesmo projeto na Vercel.

---

## 8. Conexões e Próximos Passos

* [[_knowledge/projects|Projetos]]
* [[_knowledge/business/model|Modelo de Negócio Vexo]]
* [[INFRA|Infraestrutura e Deploy]]
