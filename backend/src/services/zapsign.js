/**
 * zapsign.js
 * Mock/Wrapper para integração com a API da ZapSign.
 * 
 * Enquanto a Vexo/Geração Digital não fornecer as chaves da API de Produção, 
 * este service simula a criação de um documento e a geração do link de assinatura.
 */

// Se a chave real for inserida no .env, usaremos ela:
const ZAPSIGN_API_KEY = process.env.ZAPSIGN_API_KEY || "";
const IS_MOCK = !ZAPSIGN_API_KEY;

export async function createDocument(contractId, pdfBuffer, signerData) {
  if (IS_MOCK) {
    console.log("[ZapSign] Modo MOCK ativado (Sem API Key). Simulando envio de documento.");
    
    return {
      provider_name: 'zapsign',
      provider_id: `mock-doc-${contractId}-${Date.now()}`,
      sign_url: `https://app.zapsign.com.br/verificar/mock-${contractId}?signer=${signerData?.email || 'teste'}`,
      status: 'aguardando_assinatura'
    };
  }

  // TODO: Implementar chamada real para a API REST da ZapSign via fetch/axios 
  // usando o pdfBuffer (convertido para base64 ou multipart form-data).
  // Endpoint ZapSign: POST https://api.zapsign.com.br/api/v1/docs/
  
  throw new Error("Integração real não implementada: Aguardando definição da chave de API.");
}
