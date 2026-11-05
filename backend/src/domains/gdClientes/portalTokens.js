// Gerenciamento e segurança de tokens do Portal do Cliente da GD.
// Os tokens são gerados com alta entropia (32 bytes aleatórios em base64url)
// e NUNCA são salvos em texto claro no banco; apenas o hash SHA-256 é persistido.
import crypto from "node:crypto";

/**
 * Gera um token seguro de 32 bytes em base64url (~43 caracteres).
 * @returns {string} Token em base64url.
 */
export function gerarPortalToken() {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Devolve o hash SHA-256 em hexadecimal (64 caracteres minúsculos).
 * @param {string} token
 * @returns {string} Hash SHA-256 em hex.
 */
export function hashPortalToken(token) {
  if (typeof token !== "string" || !token.trim()) {
    throw new TypeError("Token do portal deve ser uma string não vazia.");
  }
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}
