import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { companies, productAliases, products } from "@shared/schema";
import { db } from "../../database/db";
import { currentTenantId } from "../../core/tenant/context";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../shared/errors/AppError";
import {
  normalizeProductDescription,
  resolveProductIdentity,
  type ProductIdentityCandidate,
  type ProductIdentityInput,
  type ProductIdentityResult,
} from "./product-identification";

const GLOBAL_ALIAS_ROLES = new Set(["MASTER", "DIRECTOR"]);

function ensureCompanyScope(companyId: number, role: string) {
  const tenantId = currentTenantId();
  if (tenantId != null && tenantId !== companyId) {
    throw new ForbiddenError("Empresa fora do escopo autorizado");
  }
  if (tenantId == null && !["MASTER", "ADMIN", "DIRECTOR", "DEVELOPER"].includes(role)) {
    throw new ForbiddenError("Seleção global de empresa não autorizada");
  }
}

export interface CreateProductAliasInput {
  alias: string;
  companyId?: number | null;
  global?: boolean;
  globalJustification?: string;
}

export const productIdentificationService = {
  async resolve(input: ProductIdentityInput & { role: string }): Promise<ProductIdentityResult> {
    const companyId = input.companyId;
    if (!Number.isSafeInteger(companyId) || Number(companyId) <= 0) {
      throw new BadRequestError("Informe a empresa de origem para identificar o produto.");
    }
    ensureCompanyScope(Number(companyId), input.role);

    const company = await db.select({ id: companies.id }).from(companies)
      .where(eq(companies.id, Number(companyId))).limit(1);
    if (!company[0]) throw new NotFoundError("Empresa de origem não encontrada");

    const productRows = await db.select({
      id: products.id,
      name: products.name,
      category: products.category,
      unit: products.unit,
      observation: products.observation,
      productCode: products.productCode,
      active: products.active,
      productionClassification: products.productionClassification,
    }).from(products).where(and(
      eq(products.active, true),
      or(isNull(products.empresaId), eq(products.empresaId, Number(companyId))),
    ));
    const productIds = productRows.map((product) => product.id);
    const aliasRows = productIds.length
      ? await db.select({
          productId: productAliases.productId,
          companyId: productAliases.companyId,
          alias: productAliases.alias,
          normalizedAlias: productAliases.normalizedAlias,
          status: productAliases.status,
        }).from(productAliases).where(and(
          eq(productAliases.status, "CONFIRMED"),
          inArray(productAliases.productId, productIds),
          or(isNull(productAliases.companyId), eq(productAliases.companyId, Number(companyId))),
        ))
      : [];

    return resolveProductIdentity(input, productRows as ProductIdentityCandidate[], aliasRows);
  },

  async listAliases(productId: number, companyId: number | null, role: string) {
    const productRows = await db.select({ id: products.id, empresaId: products.empresaId }).from(products)
      .where(eq(products.id, productId)).limit(1);
    if (!productRows[0]) throw new NotFoundError("Produto não encontrado");

    if (companyId != null) {
      ensureCompanyScope(Number(companyId), role);
      if (productRows[0].empresaId != null && productRows[0].empresaId !== companyId) {
        throw new ForbiddenError("O produto não pertence ao catálogo disponível para essa empresa");
      }
      const rows = await db.select({ id: companies.id }).from(companies)
        .where(eq(companies.id, companyId)).limit(1);
      if (!rows[0]) throw new NotFoundError("Empresa não encontrada");
      return db.select().from(productAliases).where(and(
        eq(productAliases.productId, productId),
        or(eq(productAliases.companyId, companyId), isNull(productAliases.companyId)),
      ));
    }

    if (!GLOBAL_ALIAS_ROLES.has(role) || currentTenantId() != null) {
      throw new ForbiddenError("Aliases globais são restritos ao MASTER e DIRECTOR na visão global");
    }
    if (productRows[0].empresaId != null) {
      throw new ForbiddenError("Aliases globais só podem ser consultados em produtos do catálogo global");
    }
    return db.select().from(productAliases).where(and(
      eq(productAliases.productId, productId),
      isNull(productAliases.companyId),
    ));
  },

  async createAlias(productId: number, input: CreateProductAliasInput, userId: number, role: string) {
    const alias = String(input.alias ?? "").trim().replace(/\s+/g, " ");
    const normalizedAlias = normalizeProductDescription(alias);
    if (!alias || alias.length > 200 || !normalizedAlias) {
      throw new BadRequestError("Informe uma descrição alternativa válida (até 200 caracteres).");
    }

    const isGlobal = input.global === true;
    let companyId: number | null;
    let globalJustification: string | null = null;
    if (isGlobal) {
      if (!GLOBAL_ALIAS_ROLES.has(role) || currentTenantId() != null) {
        throw new ForbiddenError("Alias global exige MASTER ou DIRECTOR na visão global");
      }
      globalJustification = String(input.globalJustification ?? "").trim();
      if (globalJustification.length < 20) {
        throw new BadRequestError("Justifique por que essa equivalência é universal (mínimo 20 caracteres).");
      }
      companyId = null;
    } else {
      companyId = input.companyId == null ? currentTenantId() : Number(input.companyId);
      if (!Number.isSafeInteger(companyId) || Number(companyId) <= 0) {
        throw new BadRequestError("Selecione a empresa de origem; aliases são específicos por empresa por padrão.");
      }
      ensureCompanyScope(Number(companyId), role);
    }

    return db.transaction(async (tx) => {
      // Serialize identical normalized descriptions, including global/company
      // scopes, so a concurrent request cannot create a conflicting mapping.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${normalizedAlias})::bigint)`);

      const productRows = await tx.select({ id: products.id, empresaId: products.empresaId })
        .from(products).where(eq(products.id, productId)).limit(1);
      const product = productRows[0];
      if (!product) throw new NotFoundError("Produto não encontrado");
      if (isGlobal && product.empresaId != null) {
        throw new BadRequestError("Um alias global só pode apontar para um produto do catálogo global.");
      }
      if (companyId != null) {
        const companyRows = await tx.select({ id: companies.id }).from(companies)
          .where(eq(companies.id, companyId)).limit(1);
        if (!companyRows[0]) throw new NotFoundError("Empresa de origem não encontrada");
        if (product.empresaId != null && product.empresaId !== companyId) {
          throw new ForbiddenError("O produto não pertence ao catálogo disponível para essa empresa");
        }
      }

      // Do not let an alias shadow a different official catalog name. A global
      // alias is checked against every company catalog because it applies to
      // all of them; a company alias is checked against that company and the
      // shared catalog.
      const catalogRows = await tx.select({ id: products.id, name: products.name })
        .from(products)
        .where(isGlobal
          ? eq(products.active, true)
          : and(
              eq(products.active, true),
              or(isNull(products.empresaId), eq(products.empresaId, Number(companyId))),
            ));
      const canonicalCollision = catalogRows.find((row: { id: number; name: string }) =>
        row.id !== productId && normalizeProductDescription(row.name) === normalizedAlias,
      );
      if (canonicalCollision) {
        throw new ConflictError("Essa descrição já é o nome oficial de outro produto no escopo aplicável.");
      }

      const existing = await tx.select({
        productId: productAliases.productId,
        companyId: productAliases.companyId,
      }).from(productAliases).where(and(
        eq(productAliases.normalizedAlias, normalizedAlias),
        eq(productAliases.status, "CONFIRMED"),
      ));
      const relevant = existing.filter((row) =>
        isGlobal || row.companyId == null || row.companyId === companyId,
      );
      if (relevant.length) {
        const conflicting = relevant.some((row) => row.productId !== productId);
        throw new ConflictError(
          conflicting
            ? "Essa descrição já está associada a outro produto no escopo aplicável. Revise o conflito manualmente."
            : "Essa associação já existe no escopo aplicável.",
        );
      }

      const [created] = await tx.insert(productAliases).values({
        productId,
        companyId,
        alias,
        normalizedAlias,
        globalJustification,
        status: "CONFIRMED",
        confirmedByUserId: userId,
      }).returning();
      return created;
    });
  },

  async revokeAlias(aliasId: number, reason: string, userId: number, role: string) {
    const revocationReason = String(reason ?? "").trim();
    if (revocationReason.length < 10 || revocationReason.length > 500) {
      throw new BadRequestError("Informe o motivo da desativação (10 a 500 caracteres).");
    }
    const [alias] = await db.select().from(productAliases)
      .where(eq(productAliases.id, aliasId)).limit(1);
    if (!alias) throw new NotFoundError("Alias não encontrado");
    if (alias.companyId != null) ensureCompanyScope(alias.companyId, role);
    else if (!GLOBAL_ALIAS_ROLES.has(role)) throw new ForbiddenError("Alias global é restrito ao MASTER e DIRECTOR");
    if (alias.status !== "CONFIRMED") throw new ConflictError("Esse alias já está desativado");

    const [revoked] = await db.update(productAliases).set({
      status: "REVOKED",
      revokedByUserId: userId,
      revokedAt: new Date(),
      revocationReason,
    }).where(and(eq(productAliases.id, aliasId), eq(productAliases.status, "CONFIRMED"))).returning();
    if (!revoked) throw new ConflictError("O alias mudou durante a operação; atualize a lista e tente novamente.");
    return revoked;
  },
};
