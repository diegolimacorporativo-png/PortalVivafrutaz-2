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
import { decryptOrPassthrough, isEncrypted } from "../../utils/crypto";

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

  // FASE 3.3 — descriptografia tolerante a legado:
  //   - registros novos (FASE 3.3+): formato `enc:v1:<base64>` → decifra
  //   - registros legados (FASE 3.2): texto plano → passa direto
  // Falhas REAIS de descriptografia (chave errada, payload corrompido) são
  // propagadas pelo `decryptOrPassthrough` — não há fallback silencioso para
  // payloads que dizem ser cifrados; isso evita mandar lixo pra SEFAZ.
  const passphrase = decryptOrPassthrough(row.certPassword);

  return {
    pfx: Buffer.from(row.certBase64, "base64"),
    passphrase,
    source: "database",
    tenantId,
  };
}

/**
 * Helper opcional de migração lazy: se um cert legado (texto plano) foi lido
 * com sucesso, podemos re-salvar via `upsert` para promovê-lo ao formato
 * cifrado. Não é chamado automaticamente pelo sender (evita escrita em hot
 * path de NF-e), mas pode ser invocado por uma rota admin / job de migração.
 */
export function isLegacyPlaintext(certPasswordFromDb: string): boolean {
  return !isEncrypted(certPasswordFromDb);
}
