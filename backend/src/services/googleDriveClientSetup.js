/**
 * googleDriveClientSetup.js
 * 
 * Serviço de provisionamento automatizado de pastas no Google Drive
 * para clientes da Geração Digital & Vexo OS.
 * 
 * Cria a árvore padronizada:
 *   [Cliente] /
 *     ├── 01_Identidade_e_Logos
 *     ├── 02_Fotos_e_Videos_Brutos
 *     ├── 03_Criativos_Finalizados
 *     └── 04_Relatorios
 * 
 * Suporta autenticação via:
 * 1. Service Account (JWT assinado com RS256 via crypto nativo, trocado em oauth2.googleapis.com)
 * 2. Access Token direto (GOOGLE_DRIVE_ACCESS_TOKEN)
 * 3. OAuth Refresh Token (GOOGLE_DRIVE_REFRESH_TOKEN + CLIENT_ID + CLIENT_SECRET)
 * 4. Fallback Simulador/Mock (em testes ou quando credenciais não estiverem configuradas)
 */

import crypto from "node:crypto";

export const DRIVE_SUBFOLDERS = [
  { key: "identidade", name: "01_Identidade_e_Logos" },
  { key: "brutos", name: "02_Fotos_e_Videos_Brutos" },
  { key: "criativos", name: "03_Criativos_Finalizados" },
  { key: "relatorios", name: "04_Relatorios" },
];

let cachedAccessToken = null;
let tokenExpiryTimestamp = 0;

/**
 * Base64 URL encode helper
 */
function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Obtém Access Token para o Google Drive
 */
export async function getGoogleDriveAccessToken() {
  // 1. Token estático no ambiente
  if (process.env.GOOGLE_DRIVE_ACCESS_TOKEN) {
    return process.env.GOOGLE_DRIVE_ACCESS_TOKEN;
  }

  // Se tiver token em cache válido por mais de 60 segundos
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && tokenExpiryTimestamp > now + 60) {
    return cachedAccessToken;
  }

  // 2. Service Account Credentials
  const clientEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL ||
    process.env.FIREBASE_CLIENT_EMAIL;

  let privateKey =
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
    process.env.GOOGLE_DRIVE_PRIVATE_KEY ||
    process.env.FIREBASE_PRIVATE_KEY;

  if (privateKey) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  if (clientEmail && privateKey) {
    try {
      const header = { alg: "RS256", typ: "JWT" };
      const claimSet = {
        iss: clientEmail,
        scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.file",
        aud: "https://oauth2.googleapis.com/token",
        exp: now + 3600,
        iat: now,
      };

      const encodedHeader = base64UrlEncode(JSON.stringify(header));
      const encodedClaimSet = base64UrlEncode(JSON.stringify(claimSet));
      const signInput = `${encodedHeader}.${encodedClaimSet}`;

      const signer = crypto.createSign("RSA-SHA256");
      signer.update(signInput);
      signer.end();
      const signature = signer.sign(privateKey, "base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");

      const jwt = `${signInput}.${signature}`;

      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: jwt,
        }),
      });

      const data = await res.json();
      if (data.access_token) {
        cachedAccessToken = data.access_token;
        tokenExpiryTimestamp = now + (data.expires_in || 3600);
        return cachedAccessToken;
      }
      console.warn("[google-drive] Falha ao obter token da service account:", data.error_description || data.error);
    } catch (err) {
      console.warn("[google-drive] Erro ao assinar JWT da service account:", err.message);
    }
  }

  // 3. OAuth Refresh Token
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;

  if (refreshToken && clientId && clientSecret) {
    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });
      const data = await res.json();
      if (data.access_token) {
        cachedAccessToken = data.access_token;
        tokenExpiryTimestamp = now + (data.expires_in || 3600);
        return cachedAccessToken;
      }
    } catch (err) {
      console.warn("[google-drive] Erro ao renovar refresh_token do Google Drive:", err.message);
    }
  }

  return null;
}

/**
 * Cria uma pasta no Google Drive via REST API v3
 */
async function createFolderApi(folderName, parentId, accessToken) {
  const metadata = {
    name: folderName,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) {
    metadata.parents = [parentId];
  }

  const res = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(metadata),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `Falha HTTP ${res.status} ao criar pasta ${folderName}`);
  }

  return data.id;
}

/**
 * Configura permissão de compartilhamento na pasta do Drive
 */
async function setFolderPermissionsApi(folderId, accessToken, role = "reader") {
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}/permissions?supportsAllDrives=true`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        role,
        type: "anyone",
      }),
    });
  } catch (err) {
    console.warn(`[google-drive] Aviso: não foi possível definir permissão aberta na pasta ${folderId}:`, err.message);
  }
}

/**
 * Configura a estrutura completa de pastas no Google Drive para um cliente.
 * 
 * @param {Object} params
 * @param {string} params.clientName - Nome do cliente / empresa
 * @param {string} [params.parentFolderId] - ID da pasta pai corporativa (opcional, fallback via env)
 * @param {boolean} [params.makePublic] - Se true, configura permissão aberta para quem tiver o link
 * @param {boolean} [params.allowMockFallback=true] - Se true e não houver credenciais, gera IDs simulados
 * @returns {Promise<{
 *   success: boolean,
 *   clientName: string,
 *   drive_folder_id: string,
 *   driveLink: string,
 *   subfolders: Record<string, { id: string, name: string, link: string }>,
 *   isMock?: boolean
 * }>}
 */
export async function setupClientDriveFolders({
  clientName,
  parentFolderId = null,
  makePublic = false,
  allowMockFallback = true,
}) {
  const cleanName = (clientName || "").trim();
  if (!cleanName) {
    throw new Error("clientName é obrigatório para criar a estrutura no Google Drive.");
  }

  const rootParentId =
    parentFolderId ||
    process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID ||
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ||
    null;

  const accessToken = await getGoogleDriveAccessToken();

  // Se não temos credenciais disponíveis:
  if (!accessToken) {
    if (!allowMockFallback) {
      throw new Error(
        "Nenhuma credencial do Google Drive configurada (GOOGLE_DRIVE_ACCESS_TOKEN, GOOGLE_SERVICE_ACCOUNT_EMAIL ou GOOGLE_DRIVE_REFRESH_TOKEN)."
      );
    }

    console.info(`[google-drive] Modo Simulação: gerando estrutura mock para "${cleanName}"`);
    const hash = crypto.createHash("md5").update(cleanName + Date.now()).digest("hex").slice(0, 16);
    const mockRootId = `mock_drive_${hash}`;
    const subfolders = {};

    for (const sub of DRIVE_SUBFOLDERS) {
      const subId = `${mockRootId}_${sub.key}`;
      subfolders[sub.key] = {
        id: subId,
        name: sub.name,
        link: `https://drive.google.com/drive/folders/${subId}`,
      };
    }

    return {
      success: true,
      clientName: cleanName,
      drive_folder_id: mockRootId,
      driveLink: `https://drive.google.com/drive/folders/${mockRootId}`,
      subfolders,
      isMock: true,
    };
  }

  // Criação Real via Google Drive API v3
  // 1. Pasta Raiz do Cliente: "[Cliente] - Nome do Cliente"
  const folderTitle = cleanName;
  const clientFolderId = await createFolderApi(folderTitle, rootParentId, accessToken);

  if (makePublic) {
    await setFolderPermissionsApi(clientFolderId, accessToken, "reader");
  }

  // 2. Cria as 4 Subpastas Padrão
  const subfolders = {};
  for (const sub of DRIVE_SUBFOLDERS) {
    const subFolderId = await createFolderApi(sub.name, clientFolderId, accessToken);
    subfolders[sub.key] = {
      id: subFolderId,
      name: sub.name,
      link: `https://drive.google.com/drive/folders/${subFolderId}`,
    };
  }

  return {
    success: true,
    clientName: cleanName,
    drive_folder_id: clientFolderId,
    driveLink: `https://drive.google.com/drive/folders/${clientFolderId}`,
    subfolders,
    isMock: false,
  };
}
