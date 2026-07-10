const transcriptText = `**Caio:** Fala pessoal, tudo bem? Pra gente finalizar o nosso onboarding aqui da Geração Digital e passar o bastão para a equipe operacional, preciso pegar alguns dados técnicos da Hostery Tech. Primeiro de tudo, qual é o site de vocês?
**Cliente:** Opa Caio, o nosso site é www.hosterytech.com e o nosso domínio DNS está registrado lá na Hostinger.
**Caio:** Perfeito, anotado aqui. Sobre a logomarca, vocês têm alguma pasta no drive?
**Cliente:** Logomarca não se aplica no momento, a gente já passou.
**Caio:** E para a gente solicitar o acesso ao Instagram, Google e Facebook?
**Cliente:** O Instagram será enviado no grupo. O login do Google e do Facebook também serão enviados pelo grupo depois. Ah, e sobre se a gente possui BM, a resposta é não, ainda não temos.
**Caio:** Sem problemas. E o WhatsApp comercial para os leads?
**Cliente:** No momento a gente não possui um número de WhatsApp exclusivo.
**Caio:** Tranquilo. Conta pra mim, quais são os produtos e serviços que vocês fecharam com a gente e que a gente vai anunciar?
**Cliente:** De produtos a gente fechou: Google meu negócio, Google ads, Gestão de redes sociais no Instagram, Facebook e TikTok, além da Gestão de tráfego google e meta ads, Logomarca, Branding, Cartão de visitas e Landing Page/site. A parte de serviços é focada na administração de locação por temporada, envolvendo quartos, apartamentos completos, flats, cobertura, cobertura para eventos corporativos e rancho.
**Caio:** Sensacional. Qual é o público alvo que vocês querem atingir e onde eles estão?
**Cliente:** A nossa localização principal de atuação é em Uberlândia. O público alvo envolve homens e mulheres, com idade de 18 a 60 anos, da classe social B e C. Os interesses deles são hospedagem, airbnb, aluguel por temporada, viagens a trabalho e eventos.
**Caio:** Legal. E quais são os objetivos principais do tráfego?
**Cliente:** O objetivo do tráfego é gerar leads pro whatsapp business, além de ganho de seguidores e visualização para o nosso posicionamento. Nossos produtos de tráfego foco são a locação em si e atrair clientes para hospedagem e para a administração de imóveis.
**Caio:** E vocês já mapearam concorrentes diretos?
**Cliente:** A concorrência ainda não foi mapeada totalmente, mas tem o Flat do bispo talvez? Precisa pesquisar melhor.
**Caio:** Alguma referência ou inspiração de conteúdo que vocês gostam?
**Cliente:** De inspiração a gente gosta muito do perfil "A casa das corgas".
**Caio:** Tem algum assunto bloqueado que não podemos abordar de jeito nenhum? E a verba de mídia e tipo de pagamento já estão certos?
**Cliente:** Assunto bloqueado a gente deixou não preenchido. A verba ainda não foi definida e o tipo de pagamento também deixamos não preenchido por enquanto.
**Caio:** Show! Pra fechar, quais são os temas que vocês querem abordar na linha editorial?
**Cliente:** Nossos temas serão: videos de antes x depois, videos de limpeza, videos de checkout, comodidades da locação, parceiros da locação, os apartamentos, quartos, coberturas, storytelling de transformação dos imóveis, história da empresa, tecnologia aplicada nas hospedagens e a comodidade e tecnologia de checkin e checkout.
**Caio:** Maravilha, tenho tudo que preciso. Vou gerar o dossiê e enviar para o time.`;

function deriveExtractedValues(transcriptText) {
    const text = transcriptText;
    
    // We split into speaker turns, and then split each turn into sentences
    const turns = text.split("\n").map(l => l.trim()).filter(Boolean);
    const sentences = [];
    
    turns.forEach((turn, turnIdx) => {
      const cleanTurn = turn.replace(/\*/g, "").trim();
      const speakerMatch = cleanTurn.match(/^(caio|cliente):\s*/i);
      const speaker = speakerMatch ? speakerMatch[1].toLowerCase() : "";
      const content = speakerMatch ? cleanTurn.replace(/^(caio|cliente):\s*/i, "") : cleanTurn;
      
      // Split content into sentences, keeping the speaker context
      const parts = content.split(/\.\s+/);
      parts.forEach(part => {
        if (part.trim()) {
          sentences.push({
            speaker,
            text: part.trim(),
            turnIdx
          });
        }
      });
    });

    const getAnswerForKeywords = (keywords, fallback) => {
      for (let i = 0; i < sentences.length; i++) {
        const item = sentences[i];
        const hasKeyword = keywords.some(kw => item.text.toLowerCase().includes(kw));
        if (hasKeyword) {
          // If this is Caio asking, look for the next client sentence
          if (item.speaker === "caio") {
            for (let j = i + 1; j < sentences.length; j++) {
              if (sentences[j].speaker === "cliente") {
                const hasKw = keywords.some(kw => sentences[j].text.toLowerCase().includes(kw));
                if (hasKw) {
                  return sentences[j].text;
                }
              }
            }
            for (let j = i + 1; j < sentences.length; j++) {
              if (sentences[j].speaker === "cliente") {
                return sentences[j].text;
              }
            }
          }
          if (item.speaker === "cliente") {
            return item.text;
          }
          return item.text;
        }
      }
      return fallback;
    };

    // Auto-detect products from text
    const detectedProds = [];
    const lowerText = text.toLowerCase();
    if (lowerText.includes("google meu negócio") || lowerText.includes("google meu negocio") || lowerText.includes("gmn")) detectedProds.push("Google meu negócio");
    if (lowerText.includes("google ads") || lowerText.includes("google adwords")) detectedProds.push("Google ads");
    if (lowerText.includes("instagram") || lowerText.includes("insta")) detectedProds.push("Gestão de redes sociais (Instagram)");
    if (lowerText.includes("facebook") || lowerText.includes("face")) detectedProds.push("Gestão de redes sociais (Facebook)");
    if (lowerText.includes("linkedin")) detectedProds.push("Gestão de redes sociais (LinkedIn)");
    if (lowerText.includes("tiktok")) detectedProds.push("Gestão de redes sociais (TikTok)");
    if (lowerText.includes("tráfego") || lowerText.includes("trafego") || lowerText.includes("meta ads")) detectedProds.push("Gestão de tráfego google/meta ads");
    if (lowerText.includes("logomarca") || lowerText.includes("logo")) detectedProds.push("Logomarca");
    if (lowerText.includes("branding")) detectedProds.push("Branding");
    if (lowerText.includes("cartão de visitas") || lowerText.includes("cartao de visitas")) detectedProds.push("Cartão de visitas");
    if (lowerText.includes("arte avulsa")) detectedProds.push("Arte avulsa");
    if (lowerText.includes("panfletos")) detectedProds.push("Panfletos");
    if (lowerText.includes("cardápios") || lowerText.includes("cardapios")) detectedProds.push("Cardápios");
    if (lowerText.includes("fachadas") || lowerText.includes("fachada")) detectedProds.push("Fachadas");
    if (lowerText.includes("landing page") || lowerText.includes("site")) detectedProds.push("Landing Page\\site");
    if (lowerText.includes("e-commerce") || lowerText.includes("ecommerce")) detectedProds.push("E-commerce");
    if (lowerText.includes("cobertura de eventos")) detectedProds.push("Cobertura de eventos");
    if (lowerText.includes("vídeo avulso") || lowerText.includes("video avulso")) detectedProds.push("Vídeo avulso");
    
    const produtos = detectedProds.length > 0 ? detectedProds.join(", ") : "Gestão de Tráfego Pago + Social Media";

    const logoAns = getAnswerForKeywords(["logo", "logomarca"], "Não se aplica");
    const logo = logoAns.toLowerCase().includes("não se aplica") || logoAns.toLowerCase().includes("nao se aplica") ? "Não se aplica" : logoAns;

    const siteAns = getAnswerForKeywords(["site", "www."], "");
    const siteMatch = siteAns.match(/([a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+)/);
    const site = siteMatch ? siteMatch[0] : "Não citado no briefing";

    const dnsAns = getAnswerForKeywords(["dns", "domínio", "dominio", "hospedagem"], "Não preenchido");
    let dominios_dns = dnsAns;
    if (dnsAns.toLowerCase().includes("hostinger")) dominios_dns = "Hostinger";
    else if (dnsAns.toLowerCase().includes("cloudflare")) dominios_dns = "Cloudflare";
    else if (dnsAns.toLowerCase().includes("hostgator")) dominios_dns = "Hostgator";
    else if (dnsAns.toLowerCase().includes("registro.br")) dominios_dns = "Registro.br";

    const igAns = getAnswerForKeywords(["instagram", "insta"], "");
    let instagram = "Será enviado no grupo";
    if (igAns && !igAns.toLowerCase().includes("grupo") && !igAns.toLowerCase().includes("enviado")) {
      const match = igAns.match(/@([a-zA-Z0-9._]+)/);
      instagram = match ? `@${match[1]}` : igAns;
    }

    const fbAns = getAnswerForKeywords(["facebook", "face"], "");
    let facebook = "Será enviado no grupo";
    if (fbAns && !fbAns.toLowerCase().includes("grupo") && !fbAns.toLowerCase().includes("enviado")) {
      facebook = fbAns;
    }

    const googleAns = getAnswerForKeywords(["google", "ads"], "");
    let google = "Enviado pelo grupo";
    if (googleAns && !googleAns.toLowerCase().includes("grupo") && !googleAns.toLowerCase().includes("enviado")) {
      google = googleAns;
    }

    let possui_bm = "Não sei";
    const bmAns = getAnswerForKeywords(["bm", "business manager"], "").toLowerCase();
    if (bmAns.includes("não") || bmAns.includes("nao")) possui_bm = "Não";
    if (bmAns.includes("sim")) possui_bm = "Sim";

    const waAns = getAnswerForKeywords(["whatsapp", "whats", "celular", "telefone"], "Não preenchido");
    let whatsapp = "Não possui";
    const numMatch = waAns.match(/(\(?\d{2}\)?\s?\d{4,5}[-.\s]?\d{4})/);
    if (numMatch) {
      whatsapp = numMatch[1];
    } else if (waAns.toLowerCase().includes("não possui") || waAns.toLowerCase().includes("nao possui")) {
      whatsapp = "Não possui";
    }

    let preco = "Não preenchido";
    const concorrentes = getAnswerForKeywords(["concorrente", "concorrentes"], "Não preenchido");
    const inspiracao = getAnswerForKeywords(["inspiração", "inspiracao", "referência", "referencia"], "Não preenchido");
    const servicos = getAnswerForKeywords(["serviços", "servicos"], "Não preenchido");
    
    let atuacao = getAnswerForKeywords(["localização", "localizacao", "atuação", "atuacao", "cidade"], "Local");
    const cityMatch = atuacao.match(/em\s+([A-Z][a-zA-Zãáàâéêíóôúçñ]+)/);
    if (cityMatch) {
      atuacao = cityMatch[1];
    } else {
      atuacao = atuacao.replace(/A nossa localização principal de atuação é em/i, "").trim();
    }

    const publico = getAnswerForKeywords(["público", "publico", "persona"], "Não preenchido");
    
    let bloqueado = getAnswerForKeywords(["bloqueado", "não abordar", "nunca falar"], "Não preenchido");
    if (bloqueado.toLowerCase().includes("bloqueado a gente deixou não preenchido") || bloqueado.toLowerCase().includes("bloqueado a gente deixou nao preenchido")) {
      bloqueado = "Não preenchido";
    }

    const temas = getAnswerForKeywords(["temas", "linha editorial"], "Não preenchido");
    
    let verba = getAnswerForKeywords(["verba", "orçamento", "investimento"], "Não preenchido");
    if (verba.toLowerCase().includes("verba ainda não foi definida") || verba.toLowerCase().includes("verba ainda nao foi definida")) {
      verba = "Ainda não foi definido";
    }

    let tipo_pagamento = getAnswerForKeywords(["tipo de pagamento", "pagamento", "pix", "boleto"], "Não preenchido");
    if (tipo_pagamento.toLowerCase().includes("pagamento também deixamos não preenchido") || tipo_pagamento.toLowerCase().includes("pagamento também deixamos nao preenchido")) {
      tipo_pagamento = "Não preenchido";
    }

    const objetivo_trafego = getAnswerForKeywords(["objetivo"], "Não preenchido");
    const produtos_trafego = getAnswerForKeywords(["produtos de tráfego", "produtos de trafego"], "Não preenchido");

    return {
      produtos,
      logo,
      instagram,
      facebook,
      google,
      possui_bm,
      site,
      dominios_dns,
      whatsapp,
      concorrentes,
      inspiracao,
      servicos,
      localizacao: atuacao,
      publico_alvo: publico,
      bloqueado,
      temas,
      verba,
      tipo_pagamento,
      objetivo_trafego,
      produtos_trafego
    };
}

console.log(deriveExtractedValues(transcriptText));
