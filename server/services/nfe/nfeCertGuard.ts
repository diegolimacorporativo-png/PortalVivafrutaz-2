/**
 * FASE NF-e 1.2 — T1203: Certificate Expiry Guard
 *
 * Valida o certificado A1 ANTES de assinar/enviar ao SEFAZ.
 * Usa Node 20 crypto.X509Certificate (built-in, sem dep externa).
 *
 * Regras:
 *   - Certificado EXPIRADO → lança NFE_CERT_EXPIRED (bloqueia emissão)
 *   - Expiração em ≤ 30 dias → aviso [NFE_CERT_WARNING] (não bloqueia)
 *   - Expiração em ≤ 15 dias → aviso crítico [NFE_CERT_WARNING_CRITICAL]
 *   - Expiração em ≤ 7 dias  → aviso emergência [NFE_CERT_WARNING_EMERGENCY]
 *   - Cert válido → log [NFE_CERT_OK] com dias restantes
 *
 * Retorna `CertExpiryInfo` para que o caller possa incluir nos logs fiscais.
 */

import { X509Certificate } from "node:crypto";

export interface CertExpiryInfo {
  validTo: string;   // ISO date string
  daysLeft: number;  // negativo se expirado
  willExpireSoon: boolean;
  isExpired: boolean;
}

/**
 * Verifica a validade de um certificado PEM.
 *
 * @param certPem  Certificado público em formato PEM (-----BEGIN CERTIFICATE-----)
 * @param requestId Identificador de correlação para logs
 * @param context  Contexto para log (tenantId, source, etc.)
 * @throws Error('NFE_CERT_EXPIRED') se o certificado estiver expirado
 */
export function validateCertExpiry(
  certPem: string,
  requestId = "n/a",
  context: string | number = "",
): CertExpiryInfo {
  if (!certPem || typeof certPem !== "string") {
    console.error("[NFE_CERT_GUARD_INVALID_PEM]", { requestId, context });
    throw new Error("NFE_CERT_GUARD_INVALID_PEM");
  }

  let cert: X509Certificate;
  try {
    cert = new X509Certificate(certPem);
  } catch (e: any) {
    console.error("[NFE_CERT_GUARD_PARSE_FAIL]", { requestId, context, error: e?.message });
    throw new Error("NFE_CERT_GUARD_PARSE_FAIL");
  }

  const validTo = cert.validTo; // "Jan 01 00:00:00 2026 GMT" format from Node crypto
  const validToDate = new Date(validTo);
  const now = new Date();
  const msLeft = validToDate.getTime() - now.getTime();
  const daysLeft = Math.floor(msLeft / (1000 * 60 * 60 * 24));

  const info: CertExpiryInfo = {
    validTo: validToDate.toISOString(),
    daysLeft,
    willExpireSoon: daysLeft <= 30,
    isExpired: daysLeft < 0,
  };

  if (info.isExpired) {
    console.error("[NFE_CERT_EXPIRED]", {
      requestId,
      context,
      validTo: info.validTo,
      daysLeft,
    });
    throw new Error("NFE_CERT_EXPIRED");
  }

  if (daysLeft <= 7) {
    console.error("[NFE_CERT_WARNING_EMERGENCY]", {
      requestId,
      context,
      validTo: info.validTo,
      daysLeft,
      urgency: "RENOVAR IMEDIATAMENTE — menos de 7 dias",
    });
  } else if (daysLeft <= 15) {
    console.warn("[NFE_CERT_WARNING_CRITICAL]", {
      requestId,
      context,
      validTo: info.validTo,
      daysLeft,
      urgency: "RENOVAR URGENTE — menos de 15 dias",
    });
  } else if (daysLeft <= 30) {
    console.warn("[NFE_CERT_WARNING]", {
      requestId,
      context,
      validTo: info.validTo,
      daysLeft,
      urgency: "Renovar em breve — menos de 30 dias",
    });
  } else {
    console.info("[NFE_CERT_OK]", {
      requestId,
      context,
      validTo: info.validTo,
      daysLeft,
    });
  }

  return info;
}

/**
 * Verifica APENAS a data de validade sem lançar — útil para leituras
 * de auditoria e endpoints de status sem bloqueio.
 */
export function getCertExpiryInfo(certPem: string): CertExpiryInfo | null {
  try {
    return validateCertExpiry(certPem, "audit", "status-check");
  } catch {
    return null;
  }
}
