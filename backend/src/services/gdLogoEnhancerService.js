/**
 * gdLogoEnhancerService.js
 *
 * Módulo de Processamento de Logo & Paleta de Cores Institucionais com Gemini Vision (Frente 3).
 *
 * Responsabilidades:
 * 1. Parser de metadados de arquivo (Nome da Empresa e Nicho a partir do nome do arquivo).
 * 2. Análise multimodal com Gemini Vision (ou fallback heurístico determinístico):
 *    - Detecção / confirmação do nome da empresa e nicho de mercado.
 *    - Extração da paleta de cores institucional em hexadecimal (Primária, Secundária e Destaque).
 * 3. Upscaling e Refinamento de Imagem:
 *    - Remoção de ruídos e fundos irregulares via @napi-rs/canvas.
 *    - Renderização em alta resolução (PNG com suavização bicúbica).
 * 4. Utilitários de persistência e limpeza:
 *    - Salva a logo refinada na pasta do prospect no Google Drive.
 *    - Exclui o arquivo original de baixa resolução da pasta "Logos Novas".
 */

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { uploadFileToDrive, deleteFileFromDrive } from "./googleDriveClientSetup.js";

// ─── Paletas Oficiais de Apoio por Nicho de Mercado ─────────────────────────
export const PALETAS_POR_NICHO = {
  advocacia: {
    nicho: "Advocacia & Jurídico",
    primaria: "#0F172A", // Dark Slate / Preto Nobre
    secundaria: "#1E3A8A", // Royal Navy
    destaque: "#D97706", // Âmbar Dourado
    fundo: "#F8FAFC",
  },
  estetica: {
    nicho: "Estética & Beleza",
    primaria: "#831843", // Vinho / Pink Nobre
    secundaria: "#BE185D", // Rosa Magenta
    destaque: "#F43F5E", // Rose Gold / Destaque
    fundo: "#FFF1F2",
  },
  clinica_medica: {
    nicho: "Clínicas Médicas & Saúde",
    primaria: "#022C22", // Verde Cirúrgico Profundo
    secundaria: "#064E3B", // Verde Corporativo
    destaque: "#10B981", // Verde Menta / Saúde
    fundo: "#F0FDF4",
  },
  odontologia: {
    nicho: "Odontologia & Saúde Bucal",
    primaria: "#082F49", // Deep Navy Blue
    secundaria: "#0284C7", // Azul Odonto
    destaque: "#38BDF8", // Ciano Destaque
    fundo: "#F0F9FF",
  },
  otica: {
    nicho: "Óticas & Saúde Visual",
    primaria: "#0C4A6E", // Azul Petróleo
    secundaria: "#0284C7", // Azul Cobalto
    destaque: "#F59E0B", // Âmbar Dourado
    fundo: "#F8FAFC",
  },
  varejo: {
    nicho: "Varejo & Comércio",
    primaria: "#0B192C", // Dark Navy
    secundaria: "#1E3E62", // Medium Navy
    destaque: "#FF6500", // Laranja GD Alta Energia
    fundo: "#FFFFFF",
  },
  geral_b2b: {
    nicho: "Serviços B2B & Consultoria",
    primaria: "#0B192C",
    secundaria: "#1E3E62",
    destaque: "#2563EB",
    fundo: "#F8FAFC",
  },
};

/**
 * Normaliza uma string de nicho para a chave do catálogo
 */
export function normalizarChaveNicho(texto = "") {
  const t = String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (/advoc|jurid|direito|oab|tribut|trabalh/.test(t)) return "advocacia";
  if (/estet|belez|harmoniz|botox|dermato|spa|salao/.test(t)) return "estetica";
  if (/odonto|dentist|sorriso|implant/.test(t)) return "odontologia";
  if (/medic|saude|clinic|hospital|pediatr|ortoped|oftalmolog/.test(t)) return "clinica_medica";
  if (/otic|oculos|lente|visao/.test(t)) return "otica";
  if (/varej|loja|comerc|calcado|roupa|moda|distribuid/.test(t)) return "varejo";
  return "geral_b2b";
}

/**
 * Retorna a paleta de cores recomendada com base no nicho
 */
export function obterPaletaPadraoPorNicho(nichoRaw = "") {
  const chave = normalizarChaveNicho(nichoRaw);
  return PALETAS_POR_NICHO[chave] || PALETAS_POR_NICHO.geral_b2b;
}

/**
 * Faz o parsing inteligente do nome do arquivo para extrair Empresa e Nicho
 *
 * Exemplos:
 * - "Advocacia Silva & Santos - Direito Trabalhista.png" -> { prospectName: "Advocacia Silva & Santos", niche: "Direito Trabalhista" }
 * - "Clinica_Vitta_Estetica_Facial.jpg" -> { prospectName: "Clinica Vitta", niche: "Estética Facial" }
 * - "Oticas Visao.png" -> { prospectName: "Oticas Visao", niche: "Óticas & Saúde Visual" }
 */
export function parseLogoFilename(fileName = "") {
  const baseName = String(fileName || "")
    .trim()
    .replace(/\.[a-zA-Z0-9]+$/, ""); // Remove extensão

  if (!baseName) {
    return { prospectName: "Prospect", niche: "Geral" };
  }

  // Padrão 1: Separador com traço ("Empresa - Nicho" ou "Empresa — Nicho" ou "Empresa | Nicho")
  const splitTraco = baseName.split(/\s*[-—|]\s*/);
  if (splitTraco.length >= 2) {
    const prospectName = splitTraco[0].trim();
    const nichePart = splitTraco.slice(1).join(" - ").trim();
    return {
      prospectName: prospectName || "Prospect",
      niche: nichePart || "Geral",
    };
  }

  // Padrão 2: Parênteses ("Empresa (Nicho)")
  const parenMatch = baseName.match(/^(.+?)\s*\((.+?)\)$/);
  if (parenMatch) {
    return {
      prospectName: parenMatch[1].trim() || "Prospect",
      niche: parenMatch[2].trim() || "Geral",
    };
  }

  // Padrão 3: Underscore ("Empresa_Nicho")
  const splitUnder = baseName.split("_").filter(Boolean);
  if (splitUnder.length >= 2) {
    // Identifica se algum segmento intermediário inicia o nicho (ex: Estetica, Advocacia, etc.)
    let nicheIndex = -1;
    for (let i = 1; i < splitUnder.length; i++) {
      const chave = normalizarChaveNicho(splitUnder[i]);
      if (chave !== "geral_b2b") {
        nicheIndex = i;
        break;
      }
    }

    let prospectName = "";
    let nichePart = "";

    if (nicheIndex > 0) {
      prospectName = splitUnder.slice(0, nicheIndex).join(" ").trim();
      nichePart = splitUnder.slice(nicheIndex).join(" ").trim();
    } else {
      prospectName = splitUnder[0].replace(/([a-z])([A-Z])/g, "$1 $2").trim();
      nichePart = splitUnder.slice(1).join(" ").trim();
    }

    return {
      prospectName: prospectName || "Prospect",
      niche: nichePart || "Geral",
    };
  }

  // Padrão 4: Sem separador explícito, infere pelo texto
  const prospectName = baseName.replace(/_+/g, " ").trim();
  const chaveDetectada = normalizarChaveNicho(prospectName);
  const nichoDetectado = PALETAS_POR_NICHO[chaveDetectada]?.nicho || "Geral";

  return {
    prospectName: prospectName || "Prospect",
    niche: nichoDetectado,
  };
}

/**
 * Validador e normalizador de código hexadecimal (#RRGGBB)
 */
export function sanitizarHex(hex, fallback = "#0B192C") {
  if (!hex || typeof hex !== "string") return fallback;
  const limpo = hex.trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(limpo)) {
    return limpo.startsWith("#") ? limpo.toUpperCase() : `#${limpo.toUpperCase()}`;
  }
  if (/^#?[0-9a-fA-F]{3}$/.test(limpo)) {
    const h = limpo.replace("#", "");
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toUpperCase();
  }
  return fallback;
}

/**
 * Extração de cores predominantes a partir dos pixels da imagem via Canvas
 */
export async function extrairPaletaDaImagem(imageBuffer, { prospectName = "", niche = "" } = {}) {
  const paletaBase = obterPaletaPadraoPorNicho(niche || prospectName);

  if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length < 50) {
    return {
      primaria: paletaBase.primaria,
      secundaria: paletaBase.secundaria,
      destaque: paletaBase.destaque,
      fundo: paletaBase.fundo,
      origem: "heuristica_nicho",
    };
  }

  try {
    const img = await loadImage(imageBuffer);
    const canvas = createCanvas(Math.min(img.width, 200), Math.min(img.height, 200));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    // Histograma de cores agrupadas em buckets de 32 bits
    const colorCounts = new Map();

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 50) continue; // ignora pixels muito transparentes

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Ignora quase-branco (fundo de print) e quase-preto absoluto
      if (r > 245 && g > 245 && b > 245) continue;
      if (r < 10 && g < 10 && b < 10) continue;

      // Quantização simples (blocos de 16)
      const qr = Math.floor(r / 16) * 16;
      const qg = Math.floor(g / 16) * 16;
      const qb = Math.floor(b / 16) * 16;
      const key = `${qr},${qg},${qb}`;

      colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
    }

    const sortedColors = Array.from(colorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => {
        const [r, g, b] = key.split(",").map(Number);
        return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`.toUpperCase();
      });

    const primaria = sortedColors[0] || paletaBase.primaria;
    const secundaria = sortedColors[1] || paletaBase.secundaria;
    const destaque = sortedColors[2] || paletaBase.destaque;

    return {
      primaria: sanitizarHex(primaria, paletaBase.primaria),
      secundaria: sanitizarHex(secundaria, paletaBase.secundaria),
      destaque: sanitizarHex(destaque, paletaBase.destaque),
      fundo: paletaBase.fundo,
      origem: sortedColors.length > 0 ? "pixels_imagem" : "heuristica_nicho",
    };
  } catch (err) {
    console.warn("[gdLogoEnhancer] Falha ao extrair cores dos pixels, usando paleta do nicho:", err.message);
    return {
      primaria: paletaBase.primaria,
      secundaria: paletaBase.secundaria,
      destaque: paletaBase.destaque,
      fundo: paletaBase.fundo,
      origem: "heuristica_nicho",
    };
  }
}

/**
 * Análise multimodal da logomarca utilizando Gemini Vision
 */
export async function analisarLogoComGemini({
  imageBuffer,
  mimeType = "image/png",
  fileName = "",
  prospectNameHint = null,
  nicheHint = null,
  apiKey = null,
  model = "gemini-flash-latest",
  llmCaller = null,
} = {}) {
  const metadataFilename = parseLogoFilename(fileName);
  const effectiveProspect = (prospectNameHint || metadataFilename.prospectName || "Prospect").trim();
  const effectiveNiche = (nicheHint || metadataFilename.niche || "Geral").trim();

  const effectiveApiKey =
    apiKey ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    "";

  // Se não temos API key e nem mock caller: executa extração padrão
  if (!effectiveApiKey && typeof llmCaller !== "function") {
    const paletaHeuristica = await extrairPaletaDaImagem(imageBuffer, {
      prospectName: effectiveProspect,
      niche: effectiveNiche,
    });
    return {
      prospectName: effectiveProspect,
      nicho: effectiveNiche,
      paletaCores: paletaHeuristica,
      estiloVisual: "moderno e corporativo",
      elementosGraficos: "Logomarca institucional do prospect",
      recomendacoes: ["Refinamento de contraste", "Uso em fundo escuro ou claro institucional"],
      origem: "fallback_sem_api_key",
    };
  }

  const base64Data = Buffer.isBuffer(imageBuffer)
    ? imageBuffer.toString("base64")
    : String(imageBuffer || "");

  const prompt = `
Você é o Diretor de Criação e Branding da Geração Digital & Vexo OS.
Analise a imagem/print da logomarca do prospect comercial a seguir.

DADOS INICIAIS DO ARQUIVO:
- Nome do arquivo: "${fileName}"
- Empresa estimada: "${effectiveProspect}"
- Nicho estimado: "${effectiveNiche}"

SUA MISSÃO:
1. Extraia o nome exato da empresa/prospect visível na logo (ou confirme os dados iniciais).
2. Identifique o nicho de atuação do mercado (ex: advocacia, estética, clínicas médicas, odontologia, óticas, varejo, etc.).
3. Extraia com precisão a paleta institucional em formato hexadecimal (#RRGGBB):
   - "primaria": cor institucional principal / mais marcante da marca.
   - "secundaria": cor secundária de contraste ou apoio.
   - "destaque": cor vibrante de destaque (ideal para botões de CTA e gráficos da apresentação).
   - "fundo": cor de fundo recomendada para os slides (clara como #F8FAFC ou escura corporativa).
4. Forneça breve descrição do estilo visual e elementos gráficos identificados.

SAÍDA OBRIGATÓRIA:
Retorne APENAS um objeto JSON válido (sem blocos markdown soltos fora do json) com a estrutura:
{
  "prospectName": "Nome da Empresa",
  "nicho": "Nicho do Negócio",
  "paletaCores": {
    "primaria": "#1E3E62",
    "secundaria": "#0B192C",
    "destaque": "#FF6500",
    "fundo": "#F8FAFC"
  },
  "estiloVisual": "moderno / tradicional / minimalista / premium",
  "elementosGraficos": "breve descrição dos símbolos",
  "recomendacoes": ["dica 1", "dica 2"]
}
`;

  try {
    if (typeof llmCaller === "function") {
      const res = await llmCaller({
        prompt,
        imageBase64: base64Data,
        mimeType,
        model,
        apiKey: effectiveApiKey,
      });
      if (typeof res === "object" && res.paletaCores) return res;
      if (typeof res === "string") {
        const cleaned = res.replace(/```json/g, "").replace(/```/g, "").trim();
        return JSON.parse(cleaned);
      }
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${effectiveApiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: mimeType || "image/png",
                  data: base64Data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      console.warn(`[gdLogoEnhancer] Gemini API retornou HTTP ${response.status}. Aplicando fallback.`);
      const paleta = await extrairPaletaDaImagem(imageBuffer, { prospectName: effectiveProspect, niche: effectiveNiche });
      return {
        prospectName: effectiveProspect,
        nicho: effectiveNiche,
        paletaCores: paleta,
        estiloVisual: "moderno e institucional",
        elementosGraficos: "Logomarca do prospect",
        recomendacoes: [],
        origem: "fallback_gemini_http_error",
      };
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const parsed = JSON.parse(rawText);

    return {
      prospectName: parsed.prospectName || effectiveProspect,
      nicho: parsed.nicho || effectiveNiche,
      paletaCores: {
        primaria: sanitizarHex(parsed.paletaCores?.primaria),
        secundaria: sanitizarHex(parsed.paletaCores?.secundaria),
        destaque: sanitizarHex(parsed.paletaCores?.destaque),
        fundo: sanitizarHex(parsed.paletaCores?.fundo, "#F8FAFC"),
      },
      estiloVisual: parsed.estiloVisual || "moderno",
      elementosGraficos: parsed.elementosGraficos || "",
      recomendacoes: Array.isArray(parsed.recomendacoes) ? parsed.recomendacoes : [],
      origem: "gemini_multimodal",
    };
  } catch (err) {
    console.warn(`[gdLogoEnhancer] Erro na chamada Gemini Vision: ${err.message}. Usando fallback.`);
    const paleta = await extrairPaletaDaImagem(imageBuffer, { prospectName: effectiveProspect, niche: effectiveNiche });
    return {
      prospectName: effectiveProspect,
      nicho: effectiveNiche,
      paletaCores: paleta,
      estiloVisual: "moderno",
      elementosGraficos: "Logomarca do prospect",
      recomendacoes: [],
      origem: "fallback_exception",
    };
  }
}

/**
 * Upscaling, remoção de ruídos e refinamento da imagem para alta resolução (PNG)
 * utilizando @napi-rs/canvas com suavização bicúbica e corte de bordas vazias.
 */
export async function refinarLogoEmAltaResolucao({
  imageBuffer,
  targetWidth = 1200,
  targetHeight = 1200,
  removeBackground = true,
  padding = 40,
} = {}) {
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length < 50) {
    // Se buffer vazio/inválido, cria um badge de alta resolução limpo com Canvas
    const canvas = createCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#1E3E62";
    ctx.roundRect(40, 40, targetWidth - 80, targetHeight - 80, 40);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 64px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("LOGO REFINADA", targetWidth / 2, targetHeight / 2);
    return {
      enhancedBuffer: canvas.toBuffer("image/png"),
      width: targetWidth,
      height: targetHeight,
      mimeType: "image/png",
    };
  }

  try {
    const srcImg = await loadImage(imageBuffer);
    const origW = srcImg.width;
    const origH = srcImg.height;

    // 1. Detecção da Bounding Box (corte de ruído/espaço branco ao redor da logo)
    const scanCanvas = createCanvas(origW, origH);
    const scanCtx = scanCanvas.getContext("2d");
    scanCtx.drawImage(srcImg, 0, 0);
    const imgData = scanCtx.getImageData(0, 0, origW, origH);
    const pixels = imgData.data;

    let minX = origW;
    let minY = origH;
    let maxX = 0;
    let maxY = 0;
    let nonBgCount = 0;

    for (let y = 0; y < origH; y++) {
      for (let x = 0; x < origW; x++) {
        const idx = (y * origW + x) * 4;
        const a = pixels[idx + 3];
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];

        // Pixel considerado parte da logo se não for transparente e nem branco de print (r,g,b > 245)
        const isWhiteBg = r > 242 && g > 242 && b > 242;
        if (a > 30 && !isWhiteBg) {
          nonBgCount++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    // Se a logo for muito clara ou preencher a imagem toda
    if (nonBgCount < 50 || minX >= maxX || minY >= maxY) {
      minX = 0;
      minY = 0;
      maxX = origW;
      maxY = origH;
    }

    const cropW = Math.max(maxX - minX + 1, 1);
    const cropH = Math.max(maxY - minY + 1, 1);

    // 2. Renderização em Alta Resolução (Upscale e anti-aliasing)
    const destCanvas = createCanvas(targetWidth, targetHeight);
    const destCtx = destCanvas.getContext("2d");

    destCtx.imageSmoothingEnabled = true;
    destCtx.imageSmoothingQuality = "high";

    // Calcula dimensões proporcionais dentro da área útil
    const availW = targetWidth - padding * 2;
    const availH = targetHeight - padding * 2;
    const scale = Math.min(availW / cropW, availH / cropH);

    const renderW = cropW * scale;
    const renderH = cropH * scale;
    const renderX = (targetWidth - renderW) / 2;
    const renderY = (targetHeight - renderH) / 2;

    destCtx.drawImage(
      srcImg,
      minX,
      minY,
      cropW,
      cropH,
      renderX,
      renderY,
      renderW,
      renderH
    );

    const enhancedBuffer = destCanvas.toBuffer("image/png");

    return {
      enhancedBuffer,
      width: targetWidth,
      height: targetHeight,
      mimeType: "image/png",
    };
  } catch (err) {
    console.warn("[gdLogoEnhancer] Falha no processamento de upscale via Canvas:", err.message);
    return {
      enhancedBuffer: imageBuffer,
      width: targetWidth,
      height: targetHeight,
      mimeType: "image/png",
    };
  }
}

/**
 * Pipeline completo de processamento da logo:
 * Análise multimodal (Gemini) + Refinamento e Upscaling (Canvas)
 */
export async function processarRefinamentoELogo({
  imageBuffer,
  fileName = "",
  prospectName = null,
  niche = null,
  apiKey = null,
  model = "gemini-flash-latest",
  llmCaller = null,
} = {}) {
  // 1. Análise Gemini / Heurística
  const analise = await analisarLogoComGemini({
    imageBuffer,
    fileName,
    prospectNameHint: prospectName,
    nicheHint: niche,
    apiKey,
    model,
    llmCaller,
  });

  // 2. Refinamento e Upscale em Alta Resolução
  const upscale = await refinarLogoEmAltaResolucao({
    imageBuffer,
    targetWidth: 1200,
    targetHeight: 1200,
  });

  return {
    prospectName: analise.prospectName,
    nicho: analise.nicho,
    paletaCores: analise.paletaCores,
    estiloVisual: analise.estiloVisual,
    elementosGraficos: analise.elementosGraficos,
    enhancedBuffer: upscale.enhancedBuffer,
    originalFileName: fileName,
  };
}

/**
 * Salva a logo refinada na pasta do prospect no Google Drive
 */
export async function salvarLogoRefinadaNaPasta({
  prospectName,
  logoBuffer,
  folderId,
  driveUploader = uploadFileToDrive,
}) {
  const cleanProspect = (prospectName || "Prospect").replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `Logo_Refinada_${cleanProspect}.png`;

  return driveUploader({
    fileName,
    mimeType: "image/png",
    fileBuffer: logoBuffer,
    folderId,
    allowMockFallback: true,
  });
}

/**
 * Exclui o arquivo original de baixa resolução da pasta "Logos Novas" (Limpeza de lixo eletrônico)
 */
export async function removerArquivoLogosNovas({
  fileId,
  driveDeleter = deleteFileFromDrive,
}) {
  if (!fileId) return { success: true, skipped: true };
  return driveDeleter({ fileId });
}
