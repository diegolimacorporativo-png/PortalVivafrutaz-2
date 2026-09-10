import { createHash } from "node:crypto";

/**
 * Recovery tokens are high-entropy random capabilities. A SHA-256 digest is
 * sufficient here: the original value is never persisted and the token is not
 * a password selected by a user.
 */
export function hashRecoveryToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}