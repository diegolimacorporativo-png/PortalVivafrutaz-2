/**
 * SECURITY_FLAGS — feature toggles para módulos de segurança.
 *
 * Todos os flags são true por padrão (secure-by-default).
 * Para desabilitar em emergência sem deploy: set SECURITY_FLAG_<NAME>=false no env.
 *
 * Uso:
 *   import { SECURITY_FLAGS } from "../core/security/securityFlags";
 *   if (SECURITY_FLAGS.RATE_LIMIT) { ... }
 */
export const SECURITY_FLAGS = {
  /** Rate limiting combinado IP+email em endpoints de autenticação */
  RATE_LIMIT: process.env.SECURITY_FLAG_RATE_LIMIT !== "false",

  /** Auditoria persistente de eventos críticos no banco (systemLogs) */
  AUDIT_LOG: process.env.SECURITY_FLAG_AUDIT_LOG !== "false",

  /** Detecção de anomalias em memória (sliding-window por usuário/IP) */
  ANOMALY_DETECTION: process.env.SECURITY_FLAG_ANOMALY_DETECTION !== "false",

  /** Rotação de ID de sessão no login (prevenção de session fixation) */
  SESSION_ROTATION: process.env.SECURITY_FLAG_SESSION_ROTATION !== "false",

  /** Alertas estruturados para eventos de segurança críticos */
  SECURITY_ALERTS: process.env.SECURITY_FLAG_SECURITY_ALERTS !== "false",
} as const;

export type SecurityFlagKey = keyof typeof SECURITY_FLAGS;
