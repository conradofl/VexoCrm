import { readFileSync, readdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Firebase: prefer env vars; fallback to service account JSON in backend dir
let firebaseConfig = {
  projectId: undefined,
  clientEmail: undefined,
  privateKey: undefined,
};

let firebaseReady = false;

/**
 * Inicializa o Firebase Admin lendo config de env vars (fallback: JSON de service
 * account no diretório do backend). Precisa ser chamada depois de dotenv.config(),
 * por isso é exposta como função em vez de side-effect no import do módulo.
 */
function initFirebase() {
  firebaseConfig = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      : undefined,
  };

  if (!firebaseConfig.projectId || !firebaseConfig.clientEmail || !firebaseConfig.privateKey) {
    const backendDir = join(__dirname, "..", "..");
    const candidates = readdirSync(backendDir).filter(
      (f) => f.includes("firebase-adminsdk") && f.endsWith(".json")
    );
    const jsonPath = candidates[0] ? join(backendDir, candidates[0]) : null;
    if (jsonPath && existsSync(jsonPath)) {
      const sa = JSON.parse(readFileSync(jsonPath, "utf8"));
      firebaseConfig = {
        projectId: sa.project_id,
        clientEmail: sa.client_email,
        privateKey: sa.private_key,
      };
    }
  }

  firebaseReady =
    !!firebaseConfig.projectId && !!firebaseConfig.clientEmail && !!firebaseConfig.privateKey;

  if (firebaseReady && getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: firebaseConfig.projectId,
        clientEmail: firebaseConfig.clientEmail,
        privateKey: firebaseConfig.privateKey,
      }),
    });
  }

  return { firebaseConfig, firebaseReady };
}

export { initFirebase, getAuth, firebaseConfig, firebaseReady };
