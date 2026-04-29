/**
 * FASE 3.3 — utilitário de criptografia simétrica para segredos at-rest.
 *
 * Algoritmo: AES-256-GCM (authenticated encryption).
 *   - chave de 32 bytes derivada de `NFE_CERT_SECRET` via SHA-256
 *   - IV de 12 bytes aleatório por operação (recomendado para GCM)
 *   - authTag de 16 bytes
 *
 * Formato do ciphertext serializado:
 *   "enc:v1:" + base64( iv(12) || authTag(16) || ciphertext )
 *
 * Por que o prefixo `enc:v1:`?
 *   - Discriminador determinístico entre "encrypted" e "plaintext legacy".
 *     Usar try/catch puro é arriscado: se um payload encrypted REAL falhar
 *     ao descriptografar (corrupção, rotação de chave incorreta, etc.), o
 *     fallback mudo trataria garbage como senha — e a SEFAZ rejeitaria com
 *     erro críptico. Com o prefixo, falhas reais de decrypt são propagadas
 *     e o fallback de texto plano só dispara para registros LEGADOS.
 *   - O `:v1:` permite rotacionar o esquema (ex.: trocar para chacha20-poly1305
 *     ou subir um Argon2id KDF) sem quebrar registros antigos.
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const PREFIX = 'enc:v1:';

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.NFE_CERT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'NFE_CERT_SECRET não configurada (mínimo 32 caracteres). ' +
        'Defina nas Secrets do Replit antes de salvar/ler certificados criptografados.',
    );
  }
  cachedKey = crypto.createHash('sha256').update(secret).digest();
  return cachedKey;
}

/**
 * Criptografa uma string. Devolve sempre `enc:v1:<base64>`.
 * Lança se `NFE_CERT_SECRET` estiver ausente.
 */
export function encrypt(plaintext: string): string {
  if (typeof plaintext !== 'string') {
    throw new Error('encrypt: input deve ser string');
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

/**
 * Descriptografa uma string produzida por `encrypt`. Aceita APENAS o formato
 * `enc:v1:<base64>` — para detectar legado em texto plano use `isEncrypted`
 * antes de chamar (ou use o helper `decryptOrPassthrough`).
 *
 * Lança em qualquer falha (chave errada, tag inválida, payload corrompido).
 */
export function decrypt(ciphertext: string): string {
  if (!isEncrypted(ciphertext)) {
    throw new Error('decrypt: payload não está no formato enc:v1');
  }
  const raw = Buffer.from(ciphertext.slice(PREFIX.length), 'base64');
  if (raw.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('decrypt: payload truncado');
  }
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const enc = raw.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

/** Discriminador deterministico — `true` se a string parece nosso ciphertext. */
export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Helper de leitura tolerante a legado (FASE 3.2 → 3.3):
 *   - se já está cifrado (`enc:v1:`): descriptografa (lança em corrupção real)
 *   - se está em texto plano (registro pré-FASE 3.3): devolve como veio
 *
 * O caller pode então re-salvar via `encrypt(...)` para promover o registro
 * ao novo formato (lazy migration), mas isso é opcional.
 */
export function decryptOrPassthrough(value: string): string {
  return isEncrypted(value) ? decrypt(value) : value;
}
