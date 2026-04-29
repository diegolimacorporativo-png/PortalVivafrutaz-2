/**
 * FASE 3.2 — Loader dinâmico do certificado A1 a partir do banco de dados.
 *
 * Lê o cert da tabela `company_certificates` para o tenant ativo no
 * AsyncLocalStorage. Devolve `null` quando:
 *   - não há tenant pinado no contexto (ex.: worker / cron sem ALS); OU
 *   - o tenant não tem cert cadastrado (uso de fallback ENV ou modo mock).
 *
 * Cuidados:
 *   - Usa `currentTenantId()` (não `requireTenantId()`) para NÃO lançar em
 *     contextos sem ALS — falha silenciosa permite que o sender caia no
 *     próximo nível da cadeia (ENV → mock).
 *   - NÃO loga o `certPassword`. Apenas o `tenantId` e `source`.
 */

import { currentTenantId } from "../../core/tenant/context";
import { companyCertificateRepository } from "../../modules/companies/companyCertificate.repository";

export interface DynamicCertificate {
  pfx: Buffer;
  passphrase: string;
  source: "database";
  tenantId: number;
}

export async function getCertificadoDinamico(): Promise<DynamicCertificate | null> {
  const tenantId = currentTenantId();
  if (tenantId == null) return null;

  const row = await companyCertificateRepository.getByCompanyId(tenantId);
  if (!row) return null;

  return {
    pfx: Buffer.from(row.certBase64, "base64"),
    passphrase: row.certPassword,
    source: "database",
    tenantId,
  };
}
