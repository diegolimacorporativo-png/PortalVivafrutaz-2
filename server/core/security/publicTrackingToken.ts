import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export type PublicTrackingResourceType = "delivery" | "route";

export interface PublicTrackingClaims {
  version: 1;
  type: PublicTrackingResourceType;
  resourceId: number;
  purpose: "public_tracking";
  expiresAt: number;
  nonce: string;
}

const TOKEN_VERSION = 1 as const;
const TOKEN_PURPOSE = "public_tracking" as const;
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const MIN_TTL_SECONDS = 5 * 60;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;

function getSigningKey(): Buffer {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET é obrigatório para tokens de rastreamento público");
  }

  // Domain separation prevents these tokens from being interchangeable with
  // the express-session signing material even though the existing secret is
  // reused as the root of trust.
  return createHmac("sha256", sessionSecret)
    .update("vivafrutaz:public-tracking:v1")
    .digest();
}

function getEncryptionKey(): Buffer {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET é obrigatório para tokens de rastreamento público");
  }
  return createHmac("sha256", sessionSecret)
    .update("vivafrutaz:public-tracking:v1:encryption")
    .digest();
}

function sign(body: string): string {
  return createHmac("sha256", getSigningKey())
    .update(body)
    .digest("base64url");
}

function configuredTtlSeconds(): number {
  const configured = Number(process.env.PUBLIC_TRACKING_TOKEN_TTL_SECONDS);
  if (
    Number.isInteger(configured) &&
    configured >= MIN_TTL_SECONDS &&
    configured <= MAX_TTL_SECONDS
  ) {
    return configured;
  }
  return DEFAULT_TTL_SECONDS;
}

export function getPublicTrackingTokenTtlSeconds(): number {
  return configuredTtlSeconds();
}

export function createPublicTrackingToken(
  type: PublicTrackingResourceType,
  resourceId: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): { token: string; expiresAt: number } {
  if (!["delivery", "route"].includes(type)) {
    throw new Error("Tipo de rastreamento inválido");
  }
  if (!Number.isInteger(resourceId) || resourceId <= 0) {
    throw new Error("Recurso de rastreamento inválido");
  }

  const claims: PublicTrackingClaims = {
    version: TOKEN_VERSION,
    type,
    resourceId,
    purpose: TOKEN_PURPOSE,
    expiresAt: nowSeconds + configuredTtlSeconds(),
    nonce: randomBytes(18).toString("base64url"),
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(claims), "utf8"),
    cipher.final(),
  ]).toString("base64url");
  const tag = cipher.getAuthTag().toString("base64url");
  const body = [
    "v1",
    iv.toString("base64url"),
    ciphertext,
    tag,
  ].join(".");
  return {
    token: `${body}.${sign(body)}`,
    expiresAt: claims.expiresAt,
  };
}

function isValidClaims(
  value: unknown,
  expectedType: PublicTrackingResourceType,
  nowSeconds: number,
): value is PublicTrackingClaims {
  if (!value || typeof value !== "object") return false;
  const claims = value as Partial<PublicTrackingClaims>;
  return (
    claims.version === TOKEN_VERSION &&
    claims.type === expectedType &&
    Number.isInteger(claims.resourceId) &&
    Number(claims.resourceId) > 0 &&
    claims.purpose === TOKEN_PURPOSE &&
    Number.isInteger(claims.expiresAt) &&
    Number(claims.expiresAt) > nowSeconds &&
    typeof claims.nonce === "string" &&
    claims.nonce.length >= 16
  );
}

export function verifyPublicTrackingToken(
  token: unknown,
  expectedType: PublicTrackingResourceType,
  nowSeconds = Math.floor(Date.now() / 1000),
): PublicTrackingClaims | null {
  if (typeof token !== "string") return null;
  const [version, ivEncoded, ciphertextEncoded, tagEncoded, receivedSignature, ...extra] =
    token.split(".");
  if (
    version !== "v1" ||
    !ivEncoded ||
    !ciphertextEncoded ||
    !tagEncoded ||
    !receivedSignature ||
    extra.length > 0
  ) return null;

  try {
    const body = [version, ivEncoded, ciphertextEncoded, tagEncoded].join(".");
    const expectedSignature = sign(body);
    const received = Buffer.from(receivedSignature, "base64url");
    const expected = Buffer.from(expectedSignature, "base64url");
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      return null;
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(ivEncoded, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const claims = JSON.parse(plaintext);
    return isValidClaims(claims, expectedType, nowSeconds) ? claims : null;
  } catch {
    return null;
  }
}