/**
 * FASE 3.2 — Repository do certificado A1 por empresa (multi-tenant).
 *
 * Tabela `company_certificates` (1:1 com `companies`). Operações:
 *   - getByCompanyId(companyId): lê o cert de uma empresa, ou null.
 *   - upsert({ companyId, certBase64, certPassword }): cria ou atualiza.
 *   - deleteByCompanyId(companyId): remove o cert de uma empresa.
 *
 * IMPORTANTE: este repository NÃO aplica filtro de tenant — cabe ao caller
 * (route handler / loader dinâmico) chamar com o `companyId` correto. O
 * próprio loader dinâmico (`nfeCertDynamic.ts`) deriva o companyId do
 * AsyncLocalStorage via `currentTenantId()`. Os endpoints HTTP usam o
 * `tenantContext` + `requireTenant` para garantir o pin antes de chamar.
 */

import { eq } from "drizzle-orm";
import { db } from "../../database/db";
import { companyCertificates } from "@shared/schema";
import type { CompanyCertificate } from "@shared/schema";
import { encrypt, isEncrypted } from "../../utils/crypto";

export interface SaveCompanyCertificateInput {
  companyId: number;
  certBase64: string;
  /**
   * Senha em TEXTO PLANO. O repository é responsável por cifrar via
   * `encrypt()` antes de gravar — callers NÃO devem cifrar manualmente,
   * para evitar dupla criptografia.
   */
  certPassword: string;
}

export class CompanyCertificateRepository {
  async getByCompanyId(companyId: number): Promise<CompanyCertificate | null> {
    const rows = await db
      .select()
      .from(companyCertificates)
      .where(eq(companyCertificates.companyId, companyId))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsert(input: SaveCompanyCertificateInput): Promise<CompanyCertificate> {
    // FASE 3.3 — sempre cifra antes de gravar (formato `enc:v1:<base64>`).
    // O loader (`nfeCertDynamic`) decifra na leitura. Registros legados em
    // texto plano (pré-FASE 3.3) continuam lendo via `decryptOrPassthrough`.
    const encryptedPassword = encrypt(input.certPassword);
    const existing = await this.getByCompanyId(input.companyId);
    if (existing) {
      const [updated] = await db
        .update(companyCertificates)
        .set({
          certBase64: input.certBase64,
          certPassword: encryptedPassword,
          updatedAt: new Date(),
        })
        .where(eq(companyCertificates.companyId, input.companyId))
        .returning();
      return updated;
    }
    const [created] = await db
      .insert(companyCertificates)
      .values({
        companyId: input.companyId,
        certBase64: input.certBase64,
        certPassword: encryptedPassword,
      })
      .returning();
    return created;
  }

  async deleteByCompanyId(companyId: number): Promise<boolean> {
    const result = await db
      .delete(companyCertificates)
      .where(eq(companyCertificates.companyId, companyId))
      .returning({ id: companyCertificates.id });
    return result.length > 0;
  }
}

export const companyCertificateRepository = new CompanyCertificateRepository();

/**
 * FASE 3.4 — migra registros legados (texto plano) para o formato `enc:v1:`.
 *
 * Idempotente: registros já cifrados são pulados via `isEncrypted`. NÃO
 * altera schema, NÃO remove linhas, NÃO altera fluxo NF-e — apenas reescreve
 * o `certPassword` quando ele ainda está em texto plano.
 *
 * Pode ser chamado múltiplas vezes com segurança. Operação cross-tenant
 * (escaneia toda a tabela) — protegida em rota por `requireRole(['MASTER'])`.
 *
 * @returns `{ total, migrated }` — `total` = todas as linhas vistas;
 *          `migrated` = apenas as que foram convertidas nesta execução.
 */
export interface MigrationResult {
  total: number;
  migrated: number;
}

/**
 * FASE 3.4.1 — auditoria read-only do estado dos certificados na frota.
 *
 * Devolve métricas AGREGADAS (sem nenhum dado sensível): nada de senha, nada
 * de `certBase64`, nada de `companyId`. Só os contadores `total/encrypted/
 * legacy` e o `lastUpdatedAt` global. Útil para validar a migração da FASE
 * 3.4 e para diagnóstico rápido em produção.
 *
 * Operação cross-tenant (escaneia toda a tabela) — protegida em rota por
 * `requireRole(['MASTER'])`. Idempotente, sem efeitos colaterais.
 */
export interface AuditResult {
  total: number;
  encrypted: number;
  legacy: number;
  lastUpdatedAt: string | null;
}

export async function auditCertificates(): Promise<AuditResult> {
  const rows = await db.select().from(companyCertificates);

  let encrypted = 0;
  let legacy = 0;
  let lastUpdatedAt: Date | null = null;

  for (const row of rows) {
    if (isEncrypted(row.certPassword)) {
      encrypted++;
    } else {
      legacy++;
    }
    if (row.updatedAt && (!lastUpdatedAt || row.updatedAt > lastUpdatedAt)) {
      lastUpdatedAt = row.updatedAt;
    }
  }

  return {
    total: rows.length,
    encrypted,
    legacy,
    lastUpdatedAt: lastUpdatedAt ? lastUpdatedAt.toISOString() : null,
  };
}

export async function migrateLegacyCertificates(): Promise<MigrationResult> {
  const rows = await db.select().from(companyCertificates);
  let migrated = 0;

  for (const row of rows) {
    if (!row.certPassword) continue;
    // Já cifrado — pula (idempotência: NUNCA criptografa duas vezes).
    if (isEncrypted(row.certPassword)) continue;

    const encrypted = encrypt(row.certPassword);
    await db
      .update(companyCertificates)
      .set({ certPassword: encrypted, updatedAt: new Date() })
      .where(eq(companyCertificates.id, row.id));
    migrated++;
  }

  return { total: rows.length, migrated };
}
