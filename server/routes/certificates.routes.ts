import type { Express } from "express";
import { tenantContext, requireTenant } from "../middleware/tenant";
import { requireAuth as requireAuthCore, requireRole } from "../core/http/requireAuth";

export async function register(app: Express) {
  // Visão agregada read-only do estado dos certificados na frota. NÃO retorna
  // senha, NÃO retorna certBase64, NÃO retorna companyId — apenas contadores
  // e o último updatedAt global. Útil para validar a migração 3.4 e
  // diagnosticar rapidamente quantos tenants estão pendentes.
  // Auth: MASTER only (operação cross-tenant; sem `tenantContext`).
  app.get(
    '/api/admin/certificates/audit',
    requireAuthCore,
    requireRole(['MASTER']),
    async (_req, res) => {
      try {
        const { auditCertificates } = await import(
          '../modules/companies/companyCertificate.repository.ts'
        );
        const result = await auditCertificates();
        console.log('[CERT_AUDIT]', result);
        return res.json({ success: true, data: result });
      } catch (err: any) {
        console.error('[CERT_AUDIT_ERROR]', { error: err?.message });
        return res.status(500).json({
          success: false,
          error: { message: err?.message ?? 'Erro na auditoria', code: 'AUDIT_FAILED' },
        });
      }
    },
  );

  // ─── Admin: Cert Migration (FASE 3.4) ─────────────────────────────────
  // Promove registros legados em texto plano (FASE 3.2) para o formato
  // cifrado `enc:v1:` (FASE 3.3). Idempotente — re-execução é segura.
  // Auth: MASTER only (operação cross-tenant; sem `tenantContext`).
  // Logs: `[CERT_MIGRATION_DONE]` no sucesso, `[CERT_MIGRATION_ERROR]` em
  // qualquer falha (com mensagem do erro, sem segredos).
  app.post(
    '/api/admin/certificates/migrate-legacy',
    requireAuthCore,
    requireRole(['MASTER']),
    async (_req, res) => {
      try {
        const { migrateLegacyCertificates } = await import(
          '../modules/companies/companyCertificate.repository.ts'
        );
        const result = await migrateLegacyCertificates();
        console.log('[CERT_MIGRATION_DONE]', result);
        return res.json({ success: true, ...result });
      } catch (err: any) {
        console.error('[CERT_MIGRATION_ERROR]', { error: err?.message });
        return res.status(500).json({
          success: false,
          error: { message: err?.message ?? 'Erro na migração', code: 'MIGRATION_FAILED' },
        });
      }
    },
  );

  // ─── Company Certificates (NF-e A1) — FASE 3.2 ────────────────────────
  // Endpoints CRUD do certificado A1 por empresa (multi-tenant). Usados pela
  // UI de configuração fiscal e consumidos automaticamente pelo `nfeSender`
  // via `nfeCertDynamic.getCertificadoDinamico()` durante a transmissão.
  // Auth: tenantContext + requireTenant (sessão de admin OU sessão de
  // empresa pinada). NÃO retorna `certBase64` nem `certPassword` em GET.
  {
    const { companyCertificateRepository } = await import(
      '../modules/companies/companyCertificate.repository.ts'
    );
    const { requireTenantId } = await import('../core/tenant/context');

    // POST /api/company/certificate — upload (cria ou substitui)
    app.post(
      '/api/company/certificate',
      tenantContext,
      requireTenant,
      async (req: any, res, next) => {
        try {
          const tenantId = requireTenantId();
          const { certBase64, password } = req.body ?? {};
          if (typeof certBase64 !== 'string' || certBase64.length === 0) {
            return res
              .status(400)
              .json({ success: false, error: { message: 'certBase64 é obrigatório', code: 'BAD_REQUEST' } });
          }
          if (typeof password !== 'string' || password.length === 0) {
            return res
              .status(400)
              .json({ success: false, error: { message: 'password é obrigatório', code: 'BAD_REQUEST' } });
          }
          const saved = await companyCertificateRepository.upsert({
            companyId: tenantId,
            certBase64,
            certPassword: password,
          });
          return res.json({
            success: true,
            data: {
              id: saved.id,
              companyId: saved.companyId,
              createdAt: saved.createdAt,
              updatedAt: saved.updatedAt,
            },
          });
        } catch (err) {
          next(err);
        }
      },
    );

    // GET /api/company/certificate — status (sem expor cert/senha)
    app.get(
      '/api/company/certificate',
      tenantContext,
      requireTenant,
      async (_req, res, next) => {
        try {
          const tenantId = requireTenantId();
          const row = await companyCertificateRepository.getByCompanyId(tenantId);
          if (!row) {
            return res.json({ success: true, data: { configured: false } });
          }
          return res.json({
            success: true,
            data: {
              configured: true,
              id: row.id,
              companyId: row.companyId,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            },
          });
        } catch (err) {
          next(err);
        }
      },
    );

    // DELETE /api/company/certificate — remove o cert da empresa
    app.delete(
      '/api/company/certificate',
      tenantContext,
      requireTenant,
      async (_req, res, next) => {
        try {
          const tenantId = requireTenantId();
          const removed = await companyCertificateRepository.deleteByCompanyId(tenantId);
          return res.json({ success: true, data: { removed } });
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
