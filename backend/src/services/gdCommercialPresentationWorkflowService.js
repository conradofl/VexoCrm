/**
 * gdCommercialPresentationWorkflowService.js
 *
 * Orquestrador do Fluxo Comercial "Máquina de Vendas" (Frente 3).
 *
 * Conecta a ingestão da logomarca (print de baixa resolução), análise multimodal
 * e extração de paleta com Gemini, upscaling e remoção de ruídos via Canvas,
 * geração das apresentações PPTX e PDF por nicho, arquivamento no Google Drive
 * na pasta "Máquinas de Vendas / {Prospect}", limpeza de lixo eletrônico
 * em "Logos Novas" e notificação no WhatsApp do Caio.
 */

import {
  processarRefinamentoELogo,
  salvarLogoRefinadaNaPasta,
  removerArquivoLogosNovas,
  parseLogoFilename,
} from "./gdLogoEnhancerService.js";
import { gerarArquivosApresentacao } from "./gdPresentationGeneratorService.js";
import {
  getOrCreateDriveFolder,
  ensureCommercialPresentationFolders,
  uploadFileToDrive,
  deleteFileFromDrive,
  listFilesInDriveFolder,
  downloadFileFromDrive,
} from "./googleDriveClientSetup.js";
import { sendTextMessageViaEvolution } from "./evolution.js";
import { GD_CAIO_WHATSAPP_PADRAO } from "./gdBriefingReminderService.js";

export const GD_PASTA_INGESTAO_LOGOS_NOVAS = "Logos Novas";
export const GD_PASTA_RAIZ_MAQUINAS_DE_VENDAS = "Máquinas de Vendas";

/**
 * Monta o texto de notificação de WhatsApp para a diretoria comercial (Caio)
 */
export function formatarMensagemWhatsAppCaio({
  prospectName,
  nicho,
  paletaCores,
  pptxLink,
  pdfLink,
  logoLink,
  folderLink,
}) {
  return (
    `🎯 *Máquina de Vendas Pronta para Apresentação!*\n\n` +
    `• *Prospect:* ${prospectName}\n` +
    `• *Nicho:* ${nicho}\n` +
    `• *Cores Institucionais:*\n` +
    `  - Primária: ${paletaCores.primaria}\n` +
    `  - Secundária: ${paletaCores.secundaria}\n` +
    `  - Destaque: ${paletaCores.destaque}\n\n` +
    `📁 *Arquivos Prontos no Google Drive:*\n` +
    `📊 *PowerPoint (.pptx):* ${pptxLink}\n` +
    `📄 *Apresentação (.pdf):* ${pdfLink}\n` +
    `🖼️ *Logo Refinada (PNG):* ${logoLink}\n` +
    `📂 *Pasta do Prospect:* ${folderLink}\n\n` +
    `🚀 Apresentação personalizada pronta para a call comercial!`
  );
}

/**
 * Executa o fluxo comercial completo para um prospect:
 * 1. Análise Gemini da logo e extração de paleta
 * 2. Upscale e remoção de ruídos em alta resolução
 * 3. Geração dos arquivos .pptx e .pdf adaptados por nicho
 * 4. Arquivamento na pasta "Máquinas de Vendas / {Prospect}" no Drive
 * 5. Limpeza do arquivo antigo de baixa resolução em "Logos Novas"
 * 6. Notificação no WhatsApp do Caio com os links
 */
export async function executarFluxoApresentacaoComercial({
  fileBuffer = null,
  fileName = "",
  fileId = null,
  prospectName = null,
  nicho = null,
  apiKey = null,
  model = "gemini-flash-latest",
  caioNumero = null,
  instanceName = null,
  driveAccessToken = null,
  // Injeção de dependências para testes e controle
  logoEnhancer = processarRefinamentoELogo,
  presentationGenerator = gerarArquivosApresentacao,
  foldersEnsurer = ensureCommercialPresentationFolders,
  driveUploader = uploadFileToDrive,
  driveDeleter = deleteFileFromDrive,
  evolutionSender = sendTextMessageViaEvolution,
  llmCaller = null,
} = {}) {
  // Parsing inicial do nome do arquivo se parâmetros manuais não foram fornecidos
  const meta = parseLogoFilename(fileName);
  const effectiveProspect = (prospectName || meta.prospectName || "Prospect").trim();
  const effectiveNiche = (nicho || meta.niche || "Geral").trim();

  const effectiveCaioNumber =
    caioNumero ||
    process.env.GD_CAIO_WHATSAPP ||
    GD_CAIO_WHATSAPP_PADRAO;

  const effectiveInstance =
    instanceName ||
    process.env.GD_ONBOARDING_EVOLUTION_INSTANCE ||
    process.env.GD_EVOLUTION_INSTANCE ||
    "vexo-adm-vexo-atende";

  // 1. Processamento e Refinamento de Logo com Gemini Vision
  const logoResult = await logoEnhancer({
    imageBuffer: fileBuffer,
    fileName,
    prospectName: effectiveProspect,
    niche: effectiveNiche,
    apiKey,
    model,
    llmCaller,
  });

  const finalProspectName = logoResult.prospectName || effectiveProspect;
  const finalNiche = logoResult.nicho || effectiveNiche;
  const paletaCores = logoResult.paletaCores || {};
  const enhancedLogoBuffer = logoResult.enhancedBuffer;

  // 2. Geração dos Slides Personalizados (.pptx e .pdf)
  const apresentacao = await presentationGenerator({
    prospectName: finalProspectName,
    nicho: finalNiche,
    paletaCores,
    logoBuffer: enhancedLogoBuffer,
    apiKey,
    llmCaller,
  });

  // 3. Estruturação de Pastas no Google Drive ("Máquinas de Vendas / {Prospect}")
  const driveFolders = await foldersEnsurer({
    prospectName: finalProspectName,
    accessToken: driveAccessToken,
    allowMockFallback: true,
  });

  const targetFolderId = driveFolders.prospectFolderId;
  const targetFolderLink = driveFolders.prospectFolderLink;

  // 4. Upload dos 3 Arquivos no Google Drive
  // 4.1 Logo Refinada em PNG
  const logoUpload = await driveUploader({
    fileName: `Logo_Refinada_${finalProspectName.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`,
    mimeType: "image/png",
    fileBuffer: enhancedLogoBuffer,
    folderId: targetFolderId,
    accessToken: driveAccessToken,
    allowMockFallback: true,
  });

  // 4.2 PowerPoint editável (.pptx)
  const pptxUpload = await driveUploader({
    fileName: apresentacao.pptx.fileName,
    mimeType: apresentacao.pptx.mimeType,
    fileBuffer: apresentacao.pptx.buffer,
    folderId: targetFolderId,
    accessToken: driveAccessToken,
    allowMockFallback: true,
  });

  // 4.3 Apresentação em PDF (.pdf)
  const pdfUpload = await driveUploader({
    fileName: apresentacao.pdf.fileName,
    mimeType: apresentacao.pdf.mimeType,
    fileBuffer: apresentacao.pdf.buffer,
    folderId: targetFolderId,
    accessToken: driveAccessToken,
    allowMockFallback: true,
  });

  // 5. Limpeza de Lixo Eletrônico: Exclui o arquivo original da pasta "Logos Novas"
  let deleteResult = null;
  if (fileId) {
    try {
      deleteResult = await driveDeleter({
        fileId,
        accessToken: driveAccessToken,
        allowMockFallback: true,
      });
    } catch (err) {
      console.warn(`[gdCommercialWorkflow] Aviso: Não foi possível excluir arquivo de entrada ${fileId}:`, err.message);
    }
  }

  // 6. Notificação no WhatsApp do Caio
  const textoCaio = formatarMensagemWhatsAppCaio({
    prospectName: finalProspectName,
    nicho: finalNiche,
    paletaCores,
    pptxLink: pptxUpload.fileLink,
    pdfLink: pdfUpload.fileLink,
    logoLink: logoUpload.fileLink,
    folderLink: targetFolderLink,
  });

  let whatsappSent = false;
  let whatsappError = null;

  try {
    await evolutionSender({
      instanceName: effectiveInstance,
      number: effectiveCaioNumber,
      text: textoCaio,
    });
    whatsappSent = true;
  } catch (err) {
    whatsappError = err.message;
    console.warn(`[gdCommercialWorkflow] Aviso: Falha ao enviar notificação WhatsApp para Caio (${effectiveCaioNumber}):`, err.message);
  }

  return {
    success: true,
    prospectName: finalProspectName,
    nicho: finalNiche,
    paletaCores,
    driveFolder: {
      id: targetFolderId,
      link: targetFolderLink,
      isMock: driveFolders.isMock,
    },
    files: {
      pptx: {
        id: pptxUpload.fileId,
        fileName: pptxUpload.fileName,
        link: pptxUpload.fileLink,
        size: apresentacao.pptx.size,
      },
      pdf: {
        id: pdfUpload.fileId,
        fileName: pdfUpload.fileName,
        link: pdfUpload.fileLink,
        size: apresentacao.pdf.size,
      },
      logo: {
        id: logoUpload.fileId,
        fileName: logoUpload.fileName,
        link: logoUpload.fileLink,
      },
    },
    deletedSourceFileId: fileId || null,
    whatsappNotification: {
      sent: whatsappSent,
      recipient: effectiveCaioNumber,
      error: whatsappError,
      message: textoCaio,
    },
  };
}

/**
 * Watcher / Processador em Lote: Ingestão de arquivos da pasta "Logos Novas" no Google Drive
 */
export async function processarIngestaoLogosNovas({
  folderId = null,
  driveAccessToken = null,
  apiKey = null,
  model = "gemini-flash-latest",
  caioNumero = null,
  instanceName = null,
  driveFolderGetter = getOrCreateDriveFolder,
  driveFilesLister = listFilesInDriveFolder,
  driveFileDownloader = downloadFileFromDrive,
  workflowExecutor = executarFluxoApresentacaoComercial,
} = {}) {
  // 1. Localiza ou cria a pasta "Logos Novas"
  let ingestionFolderId = folderId || process.env.GOOGLE_DRIVE_LOGOS_NOVAS_FOLDER_ID;
  if (!ingestionFolderId) {
    const resFolder = await driveFolderGetter({
      folderName: GD_PASTA_INGESTAO_LOGOS_NOVAS,
      accessToken: driveAccessToken,
      allowMockFallback: true,
    });
    ingestionFolderId = resFolder.id;
  }

  // 2. Lista os arquivos da pasta
  const files = await driveFilesLister({
    folderId: ingestionFolderId,
    accessToken: driveAccessToken,
    allowMockFallback: true,
  });

  if (!files || files.length === 0) {
    return {
      success: true,
      message: "Nenhum arquivo pendente em Logos Novas.",
      ingestionFolderId,
      totalProcessed: 0,
      processed: [],
    };
  }

  const results = [];
  for (const file of files) {
    try {
      // Baixa o arquivo da pasta
      const fileBuffer = await driveFileDownloader({
        fileId: file.id,
        accessToken: driveAccessToken,
        allowMockFallback: true,
      });

      // Executa o fluxo completo para o arquivo
      const result = await workflowExecutor({
        fileBuffer,
        fileName: file.name,
        fileId: file.id,
        driveAccessToken,
        apiKey,
        model,
        caioNumero,
        instanceName,
      });

      results.push({
        fileId: file.id,
        fileName: file.name,
        success: true,
        result,
      });
    } catch (err) {
      console.error(`[gdCommercialWorkflow] Erro ao processar arquivo ${file.name} (${file.id}):`, err.message);
      results.push({
        fileId: file.id,
        fileName: file.name,
        success: false,
        error: err.message,
      });
    }
  }

  return {
    success: true,
    ingestionFolderId,
    totalProcessed: results.length,
    processed: results,
  };
}
