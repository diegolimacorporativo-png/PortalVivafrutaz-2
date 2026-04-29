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
import { encrypt } from "../../utils/crypto";

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
