import { TRANSCRIPT_OPTIONS } from "./constants";

// Extraído de src/pages/GeracaoDigitalPitch.tsx (Onda 4 Run F5) — movimento puro, sem alteração de forma.
// Lógica pura de derivação dos valores do briefing a partir da transcrição (parte não-estatal de processBriefingWithGemini).
export function deriveExtractedValues(transcriptText: string): Record<string, string> {
    const matchedPreset = TRANSCRIPT_OPTIONS.find((t) => transcriptText.includes(t.text.substring(0, 30)));
    
    let extractedValues: Record<string, string> = {};
    if (matchedPreset) {
      extractedValues = matchedPreset.extractedValues;
    } else {
      // Heuristic parsing on custom transcript text
      const text = transcriptText;
      
      // We split into speaker turns, and then split each turn into sentences
      const turns = text.split("\n").map(l => l.trim()).filter(Boolean);
      const sentences: { speaker: string; text: string; turnIdx: number }[] = [];
      
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

      const getAnswerForKeywords = (keywords: string[], fallback: string): string => {
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
      const detectedProds: string[] = [];
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

      // Subcampos do Público Alvo. O parser devolvia só `publico_alvo` como um
      // texto único, mas a tela renderiza esse campo em subcampos (gênero,
      // faixa etária, classe, interesses, outros). Sem chave por subcampo eles
      // ficavam vazios mesmo com a transcrição colada. As chaves usam o formato
      // "publico_alvo.<id>" e são aplicadas em GeracaoDigitalPitch.
      const genero = getAnswerForKeywords(["gênero", "genero", "homens", "mulheres"], "");
      const idade = getAnswerForKeywords(["idade", "faixa etária", "faixa etaria", "anos"], "");
      const classe = getAnswerForKeywords(["classe social", "classe", "poder aquisitivo"], "");
      const interesses = getAnswerForKeywords(["interesses", "comportamento", "comportamentos", "hobbies"], "");
      const outros_detalhes = getAnswerForKeywords(["outros detalhes", "detalhes do público", "detalhes do publico"], "");

      // Campos novos do briefing expandido.
      const ticket_margem = getAnswerForKeywords(["ticket médio", "ticket medio", "ticket", "margem"], "Não preenchido");
      const diferencial = getAnswerForKeywords(["diferencial", "diferenciais", "vantagem competitiva"], "Não preenchido");
      const dores_publico = getAnswerForKeywords(["dor", "dores", "necessidade", "necessidades", "problema"], "Não preenchido");
      const base_existente = getAnswerForKeywords(["base de clientes", "lista de e-mail", "lista de email", "seguidores", "remarketing", "lookalike"], "Não preenchido");
      const divisao_verba = getAnswerForKeywords(["divisão da verba", "divisao da verba", "google e meta", "meta e google"], "Não preenchido");
      const sazonalidade = getAnswerForKeywords(["sazonalidade", "datas comemorativas", "lançamento", "lancamento", "promoção", "promocao"], "Não preenchido");

      const trafegoAns = getAnswerForKeywords(["já rodou tráfego", "ja rodou trafego", "tráfego pago antes", "trafego pago antes", "agência anterior", "agencia anterior"], "");
      let ja_rodou_trafego = "Não sei";
      if (/\bn[ãa]o\b/i.test(trafegoAns)) ja_rodou_trafego = "Não";
      if (/\bsim\b/i.test(trafegoAns)) ja_rodou_trafego = "Sim";
      const trafego_historico = trafegoAns || "Não preenchido";

      const verbaPeriodoAns = getAnswerForKeywords(["verba é", "verba e", "mensal", "semanal", "por campanha"], "").toLowerCase();
      let verba_periodicidade = "Mensal";
      if (verbaPeriodoAns.includes("semanal")) verba_periodicidade = "Semanal";
      else if (verbaPeriodoAns.includes("campanha") || verbaPeriodoAns.includes("período") || verbaPeriodoAns.includes("periodo")) verba_periodicidade = "Por campanha/período";
      
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

      extractedValues = {
        produtos: produtos.substring(0, 150),
        logo: logo.substring(0, 100),
        instagram: instagram.substring(0, 100),
        facebook: facebook.substring(0, 100),
        google: google.substring(0, 100),
        possui_bm,
        site: site.substring(0, 100),
        dominios_dns: dominios_dns.substring(0, 100),
        whatsapp: whatsapp.substring(0, 50),
        concorrentes: concorrentes.substring(0, 150),
        inspiracao: inspiracao.substring(0, 150),
        servicos: servicos.substring(0, 250),
        localizacao: atuacao.substring(0, 100),
        publico_alvo: publico.substring(0, 250),
        "publico_alvo.genero": genero.substring(0, 120),
        "publico_alvo.idade": idade.substring(0, 120),
        "publico_alvo.classe": classe.substring(0, 120),
        "publico_alvo.interesses": interesses.substring(0, 200),
        "publico_alvo.outros_detalhes": outros_detalhes.substring(0, 200),
        ticket_margem: ticket_margem.substring(0, 150),
        diferencial: diferencial.substring(0, 250),
        ja_rodou_trafego,
        trafego_historico: trafego_historico.substring(0, 300),
        dores_publico: dores_publico.substring(0, 250),
        base_existente: base_existente.substring(0, 250),
        verba_periodicidade,
        divisao_verba: divisao_verba.substring(0, 120),
        sazonalidade: sazonalidade.substring(0, 250),
        bloqueado: bloqueado.substring(0, 150),
        temas: temas.substring(0, 250),
        verba: verba.substring(0, 100),
        tipo_pagamento: tipo_pagamento.substring(0, 100),
        objetivo_trafego: objetivo_trafego.substring(0, 150),
        produtos_trafego: produtos_trafego.substring(0, 150)
      };
    }

  return extractedValues;
}
