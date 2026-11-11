/**
 * gdBrandingAvatarService.js
 *
 * Geração de imagem de perfil padronizada para grupos de WhatsApp
 * "MÁQUINA DE VENDAS: {CLIENTE}" da Geração Digital & Vexo OS.
 *
 * Características da Imagem:
 * - Resolução: 500x500 pixels (compatível com visualização circular do WhatsApp).
 * - Fundo ilustrado/decorativo de alta resolução representativo do nicho / identidade do cliente.
 * - Tarja preta centralizada com 50% de opacidade (rgba(0, 0, 0, 0.50)).
 * - Texto padronizado: "MÁQUINA DE VENDAS | MARKETING | {NOME DO CLIENTE}".
 * - Integração via Evolution API (/group/updateGroupPicture) em base64.
 * - Arquivamento na pasta "01_Identidade_e_Logos" do Google Drive do cliente.
 */

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { updateEvolutionGroupPicture } from "./evolution.js";
import { uploadFileToDrive } from "./googleDriveClientSetup.js";

// Paletas de gradientes modernos de alta resolução baseadas em nicho ou hash
const GRADIENT_PALETTES = [
  // Azul tecnológico / Corporativo
  ["#0f172a", "#1e1b4b", "#1e3a8a", "#0284c7"],
  // Violeta / Criativo / Agência
  ["#09090b", "#3b0764", "#581c87", "#7c3aed"],
  // Verde / Saúde / Clínicas
  ["#022c22", "#064e3b", "#0f766e", "#059669"],
  // Âmbar / Premium / Negócios
  ["#1c1917", "#451a03", "#78350f", "#d97706"],
  // Rubro / Vendas / Alta performance
  ["#18181b", "#4c0519", "#881337", "#e11d48"],
  // Ciano / Odonto / Estética
  ["#082f49", "#164e63", "#0e7490", "#06b6d4"],
];

function selectPalette(clientName = "") {
  let hash = 0;
  for (let i = 0; i < clientName.length; i++) {
    hash = (hash << 5) - hash + clientName.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % GRADIENT_PALETTES.length;
  return GRADIENT_PALETTES[idx];
}

/**
 * Renderiza o avatar de perfil padrão em 500x500 pixels.
 *
 * @param {Object} options
 * @param {string} options.clientName - Nome da empresa / cliente
 * @param {string} [options.niche] - Nicho de atuação (opcional)
 * @param {Buffer} [options.logoBuffer] - Buffer de logo (opcional)
 * @param {string} [options.customText] - Texto customizado (opcional)
 * @returns {Promise<{ buffer: Buffer, base64: string }>}
 */
export async function renderGdBrandingAvatar({
  clientName,
  niche = null,
  logoBuffer = null,
  customText = null,
} = {}) {
  const cleanName = String(clientName || "CLIENTE").trim();
  const width = 500;
  const height = 500;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // 1. Fundo Gradiente Ilustrado em Alta Resolução
  const palette = selectPalette(cleanName);
  const bgGradient = ctx.createLinearGradient(0, 0, width, height);
  bgGradient.addColorStop(0, palette[0]);
  bgGradient.addColorStop(0.35, palette[1]);
  bgGradient.addColorStop(0.7, palette[2]);
  bgGradient.addColorStop(1, palette[3]);

  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, width, height);

  // 2. Elementos Gráficos Decorativos (Efeito Tech & Dinâmico)
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;

  // Círculos concêntricos sutis
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, 220, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(width / 2, height / 2, 170, 0, Math.PI * 2);
  ctx.stroke();

  // Linhas diagonais dinâmicas de aceleração
  ctx.beginPath();
  ctx.moveTo(30, 470);
  ctx.lineTo(470, 30);
  ctx.moveTo(80, 490);
  ctx.lineTo(490, 80);
  ctx.stroke();

  // Brilho radial superior sutil
  const glow = ctx.createRadialGradient(width / 2, 60, 10, width / 2, 60, 200);
  glow.addColorStop(0, "rgba(255, 255, 255, 0.25)");
  glow.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.restore();

  // 3. Renderiza Logo se fornecida (centralizada no topo)
  if (logoBuffer && Buffer.isBuffer(logoBuffer)) {
    try {
      const logoImg = await loadImage(logoBuffer);
      const maxLogoSize = 90;
      const aspect = logoImg.width / logoImg.height;
      let drawW = maxLogoSize;
      let drawH = maxLogoSize / aspect;
      if (drawH > maxLogoSize) {
        drawH = maxLogoSize;
        drawW = maxLogoSize * aspect;
      }
      ctx.drawImage(logoImg, (width - drawW) / 2, 65, drawW, drawH);
    } catch (err) {
      console.warn("[gd-branding] Aviso ao renderizar logo no avatar:", err.message);
    }
  }

  // 4. Tarja Preta Centralizada com 50% de Opacidade
  // Cobre a região central (y = 170 até 330, altura 140px)
  const stripeY = 175;
  const stripeH = 150;

  ctx.fillStyle = "rgba(0, 0, 0, 0.50)";
  ctx.fillRect(0, stripeY, width, stripeH);

  // Linhas de acabamento da tarja (bordas sutis de 1px)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.20)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, stripeY);
  ctx.lineTo(width, stripeY);
  ctx.moveTo(0, stripeY + stripeH);
  ctx.lineTo(width, stripeY + stripeH);
  ctx.stroke();

  // 5. Tipografia Padronizada
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (customText) {
    // Texto customizado direto
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px sans-serif";
    ctx.fillText(customText, width / 2, stripeY + stripeH / 2);
  } else {
    // Linha 1: "MÁQUINA DE VENDAS"
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 24px sans-serif";
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = 4;
    ctx.fillText("MÁQUINA DE VENDAS", width / 2, stripeY + 36);

    // Linha 2: "MARKETING" (ou Subtítulo de Nicho)
    ctx.fillStyle = "#38bdf8"; // Ciano moderno
    ctx.font = "600 13px sans-serif";
    ctx.shadowBlur = 0;
    const tagText = niche ? `MARKETING | ${niche.toUpperCase()}` : "MARKETING";
    ctx.fillText(tagText, width / 2, stripeY + 68);

    // Linha 3: "{NOME DO CLIENTE}" (auto-scale para caber perfeitamente)
    const upperClient = cleanName.toUpperCase();
    let fontSize = 23;
    ctx.font = `bold ${fontSize}px sans-serif`;

    // Reduz tamanho de fonte se o nome for longo para não cortar no círculo do WhatsApp
    const maxTextWidth = 420;
    while (ctx.measureText(upperClient).width > maxTextWidth && fontSize > 14) {
      fontSize -= 1;
      ctx.font = `bold ${fontSize}px sans-serif`;
    }

    ctx.fillStyle = "#facc15"; // Amarelo dourado de alto contraste
    ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
    ctx.shadowBlur = 5;
    ctx.fillText(upperClient, width / 2, stripeY + 110);
  }

  // 6. Exporta buffer PNG e Base64
  const buffer = canvas.toBuffer("image/png");
  const base64 = `data:image/png;base64,${buffer.toString("base64")}`;

  return {
    buffer,
    base64,
  };
}

/**
 * Gera a imagem padronizada do avatar, atualiza a foto do grupo via Evolution API
 * e salva a arte tratada na pasta "01_Identidade_e_Logos" do Google Drive.
 *
 * @param {Object} params
 * @param {string} params.clientName - Nome da empresa / cliente
 * @param {string} params.groupJid - JID do grupo WhatsApp ("MÁQUINA DE VENDAS: {CLIENTE}")
 * @param {string} [params.instanceName] - Instância da Evolution API
 * @param {string} [params.identidadeFolderId] - ID da pasta "01_Identidade_e_Logos" no Drive
 * @param {string} [params.logoUrl] - URL opcional da logo do cliente para compor o avatar
 * @param {Buffer} [params.logoBuffer] - Buffer opcional da logo
 * @param {Function} [params.evolutionUpdater] - Função de envio da foto para a Evolution
 * @param {Function} [params.driveUploader] - Função de upload para o Google Drive
 * @param {Function} [params.fetchFn] - Cliente HTTP fetch
 * @returns {Promise<{
 *   success: boolean,
 *   clientName: string,
 *   groupJid: string,
 *   imageBuffer: Buffer,
 *   imageBase64: string,
 *   evolutionUpdated: boolean,
 *   driveFile: Object | null
 * }>}
 */
export async function generateAndApplyGdBrandingAvatar({
  clientName,
  groupJid,
  instanceName = process.env.GD_ONBOARDING_EVOLUTION_INSTANCE || "vexo-adm",
  identidadeFolderId = null,
  logoUrl = null,
  logoBuffer = null,
  evolutionUpdater = updateEvolutionGroupPicture,
  driveUploader = uploadFileToDrive,
  fetchFn = fetch,
} = {}) {
  const cleanName = String(clientName || "").trim();
  if (!cleanName) {
    throw new Error("clientName é obrigatório para gerar o avatar de branding.");
  }
  if (!groupJid) {
    throw new Error("groupJid é obrigatório para aplicar a foto do grupo.");
  }

  // Se houver logoUrl, tenta baixar o buffer
  let effectiveLogoBuffer = logoBuffer;
  if (!effectiveLogoBuffer && logoUrl) {
    try {
      const resLogo = await fetchFn(logoUrl);
      if (resLogo.ok) {
        effectiveLogoBuffer = Buffer.from(await resLogo.arrayBuffer());
      }
    } catch (e) {
      console.warn(`[gd-branding] Falha ao baixar logo de ${logoUrl}:`, e.message);
    }
  }

  // 1. Renderiza o avatar de 500x500 pixels com a tarja de 50%
  const { buffer, base64 } = await renderGdBrandingAvatar({
    clientName: cleanName,
    logoBuffer: effectiveLogoBuffer,
  });

  // 2. Atualiza a foto do grupo no WhatsApp via Evolution API
  let evolutionUpdated = false;
  try {
    const evoRes = await evolutionUpdater({
      instanceName,
      groupJid,
      image: base64,
      fetchFn,
    });
    evolutionUpdated = evoRes?.success === true;
  } catch (err) {
    console.warn(`[gd-branding] Falha ao atualizar foto de perfil do grupo ${groupJid} na Evolution API:`, err.message);
  }

  // 3. Salva a arte tratada na pasta 01_Identidade_e_Logos do Google Drive
  let driveFile = null;
  const fileName = `Avatar_Maquina_de_Vendas_${cleanName.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;

  try {
    driveFile = await driveUploader({
      fileName,
      mimeType: "image/png",
      fileBuffer: buffer,
      folderId: identidadeFolderId,
      allowMockFallback: true,
    });
  } catch (err) {
    console.warn(`[gd-branding] Falha ao arquivar avatar no Google Drive para ${cleanName}:`, err.message);
  }

  return {
    success: true,
    clientName: cleanName,
    groupJid,
    imageBuffer: buffer,
    imageBase64: base64,
    evolutionUpdated,
    driveFile,
  };
}
