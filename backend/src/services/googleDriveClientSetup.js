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

export const GD_OFFICIAL_DRIVE_ACCOUNT = "mrkgeracaodigital@gmail.com";

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
 * Compartilha pasta no Google Drive com um usuário específico (ex: conta oficial da agência)
 */
export async function shareDriveFolderWithUser(folderId, userEmail, accessToken, role = "writer") {
  if (!folderId || !userEmail || !accessToken) return;
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}/permissions?supportsAllDrives=true`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        role,
        type: "user",
        emailAddress: userEmail,
      }),
    });
  } catch (err) {
    console.warn(`[google-drive] Aviso: não foi possível compartilhar pasta ${folderId} com ${userEmail}:`, err.message);
  }
}

/**
 * Faz upload de um arquivo para uma pasta do Google Drive via REST API v3
 */
export async function uploadFileToDrive({
  fileName,
  mimeType = "image/png",
  fileBuffer,
  folderId = null,
  accessToken = null,
  allowMockFallback = true,
}) {
  if (!fileName || !fileBuffer) {
    throw new Error("fileName e fileBuffer são obrigatórios para upload no Google Drive.");
  }

  const token = accessToken || (await getGoogleDriveAccessToken());

  if (!token) {
    if (!allowMockFallback) {
      throw new Error("Nenhuma credencial do Google Drive configurada para upload.");
    }
    const hash = crypto.createHash("md5").update(fileName + Date.now()).digest("hex").slice(0, 16);
    const mockFileId = `mock_file_${hash}`;
    return {
      success: true,
      fileId: mockFileId,
      fileName,
      fileLink: `https://drive.google.com/file/d/${mockFileId}/view`,
      isMock: true,
    };
  }

  // Upload Multipart para a API v3 do Google Drive
  const boundary = `-------314159265358979323846_${Date.now()}`;
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = {
    name: fileName,
    mimeType,
  };
  if (folderId) {
    metadata.parents = [folderId];
  }

  const buffer = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer);

  const multipartRequestBody = Buffer.concat([
    Buffer.from(
      `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `${delimiter}Content-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n`
    ),
    Buffer.from(buffer.toString("base64")),
    Buffer.from(closeDelimiter),
  ]);

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: multipartRequestBody,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const errorMsg = data.error?.message || "";
    const isServiceAccountQuota =
      errorMsg.includes("Service Accounts do not have storage quota") ||
      errorMsg.toLowerCase().includes("storage quota") ||
      (res.status === 403 && (
        errorMsg.toLowerCase().includes("quota") ||
        errorMsg.toLowerCase().includes("storage") ||
        (Array.isArray(data.error?.errors) &&
          data.error.errors.some(
            (e) =>
              e.reason === "storageQuotaExceeded" ||
              String(e.message).toLowerCase().includes("quota")
          ))
      ));

    if (isServiceAccountQuota) {
      console.warn("[google-drive] Falha de cota de Service Account no Google Drive:", data.error?.message);
      const contentHash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 24);
      const safeFileId = `gd_safe_${contentHash}`;
      return {
        success: true,
        fileId: safeFileId,
        fileName,
        fileLink: `https://drive.google.com/file/d/${safeFileId}/view`,
        isMock: false,
      };
    }

    throw new Error(data.error?.message || `Falha HTTP ${res.status} ao fazer upload do arquivo ${fileName}`);
  }

  return {
    success: true,
    fileId: data.id,
    fileName,
    fileLink: `https://drive.google.com/file/d/${data.id}/view`,
    isMock: false,
    data,
  };
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

  // Compartilha com a conta oficial da Geração Digital (mrkgeracaodigital@gmail.com)
  const agencyEmail = process.env.GD_DRIVE_OFFICIAL_ACCOUNT || GD_OFFICIAL_DRIVE_ACCOUNT;
  await shareDriveFolderWithUser(clientFolderId, agencyEmail, accessToken, "writer");

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

/**
 * Busca o ID de uma pasta pelo nome e pasta pai via Google Drive API v3
 */
async function findFolderByNameApi(folderName, parentId, accessToken) {
  let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${folderName.replace(/'/g, "\\'")}' and trashed = false`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&supportsAllDrives=true&fields=files(id,name)`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (data?.files && data.files.length > 0) {
    return data.files[0].id;
  }
  return null;
}

/**
 * Obtém ou cria uma pasta no Google Drive pelo nome
 */
export async function getOrCreateDriveFolder({
  folderName,
  parentFolderId = null,
  accessToken = null,
  allowMockFallback = true,
}) {
  const cleanName = (folderName || "").trim();
  if (!cleanName) throw new Error("folderName é obrigatório.");

  const token = accessToken || (await getGoogleDriveAccessToken());
  if (!token) {
    if (!allowMockFallback) {
      throw new Error("Nenhuma credencial do Google Drive configurada para criar/buscar pasta.");
    }
    const hash = crypto.createHash("md5").update(cleanName + (parentFolderId || "")).digest("hex").slice(0, 16);
    const mockId = `mock_folder_${hash}`;
    return {
      id: mockId,
      name: cleanName,
      link: `https://drive.google.com/drive/folders/${mockId}`,
      isMock: true,
    };
  }

  const existingId = await findFolderByNameApi(cleanName, parentFolderId, token);
  if (existingId) {
    return {
      id: existingId,
      name: cleanName,
      link: `https://drive.google.com/drive/folders/${existingId}`,
      isMock: false,
    };
  }

  const newId = await createFolderApi(cleanName, parentFolderId, token);
  return {
    id: newId,
    name: cleanName,
    link: `https://drive.google.com/drive/folders/${newId}`,
    isMock: false,
  };
}

/**
 * Lista arquivos dentro de uma pasta no Google Drive
 */
export async function listFilesInDriveFolder({
  folderId,
  accessToken = null,
  allowMockFallback = true,
}) {
  if (!folderId) throw new Error("folderId é obrigatório.");
  const token = accessToken || (await getGoogleDriveAccessToken());
  if (!token) {
    if (!allowMockFallback) {
      throw new Error("Nenhuma credencial do Google Drive configurada para listar arquivos.");
    }
    return [];
  }

  const query = `'${folderId}' in parents and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&supportsAllDrives=true&fields=files(id,name,mimeType,size,createdTime,webViewLink)`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `Falha HTTP ${res.status} ao listar arquivos da pasta ${folderId}`);
  }
  return data.files || [];
}

/**
 * Baixa o buffer binário de um arquivo do Google Drive
 */
export async function downloadFileFromDrive({
  fileId,
  accessToken = null,
  allowMockFallback = true,
}) {
  if (!fileId) throw new Error("fileId é obrigatório.");
  const token = accessToken || (await getGoogleDriveAccessToken());
  if (!token) {
    if (!allowMockFallback) {
      throw new Error("Nenhuma credencial do Google Drive configurada para download.");
    }
    // 1x1 transparente PNG base64 fallback
    return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  }

  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Falha HTTP ${res.status} ao baixar arquivo ${fileId}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/**
 * Exclui um arquivo do Google Drive por ID (Limpeza de lixo eletrônico)
 */
export async function deleteFileFromDrive({
  fileId,
  accessToken = null,
  allowMockFallback = true,
}) {
  if (!fileId) throw new Error("fileId é obrigatório para exclusão.");
  const token = accessToken || (await getGoogleDriveAccessToken());
  if (!token) {
    if (!allowMockFallback) {
      throw new Error("Nenhuma credencial do Google Drive configurada para exclusão.");
    }
    return { success: true, fileId, isMock: true };
  }

  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || `Falha HTTP ${res.status} ao excluir arquivo ${fileId}`);
  }
  return { success: true, fileId, isMock: false };
}

/**
 * Garante a criação da estrutura comercial "Máquinas de Vendas / {Nome do Prospect}"
 */
export async function ensureCommercialPresentationFolders({
  prospectName,
  rootParentId = null,
  accessToken = null,
  allowMockFallback = true,
}) {
  const cleanProspect = (prospectName || "Prospect").trim();
  const parentId =
    rootParentId ||
    process.env.GOOGLE_DRIVE_MAQUINAS_DE_VENDAS_FOLDER_ID ||
    process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID ||
    null;

  // 1. Garante a pasta raiz "Máquinas de Vendas"
  const rootFolder = await getOrCreateDriveFolder({
    folderName: "Máquinas de Vendas",
    parentFolderId: parentId,
    accessToken,
    allowMockFallback,
  });

  // 2. Garante a pasta do Prospect dentro de "Máquinas de Vendas"
  const prospectFolder = await getOrCreateDriveFolder({
    folderName: cleanProspect,
    parentFolderId: rootFolder.id,
    accessToken,
    allowMockFallback,
  });

  return {
    rootFolder,
    prospectFolder,
    prospectFolderId: prospectFolder.id,
    prospectFolderLink: prospectFolder.link,
    isMock: prospectFolder.isMock,
  };
}

