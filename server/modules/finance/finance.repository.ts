import { and, desc, eq, gte, inArray, lte, not, sql } from "drizzle-orm";
import { db } from "../../database/db";
import {
  accountsReceivable,
  accountsPayable,
  financialTransactions,
  systemLogs,
  cnabImportHistory,
  nfeEmissoes,
  orders,
} from "@shared/schema";
import {
  tenantWhere,
  tenantAnd,
  withTenant,
  stripTenantFields,
} from "../../core/tenant/scope";
import { requireTenantId } from "../../core/tenant/context";
import { storage } from "../../services/storage";
import { NotFoundError } from "../../shared/errors/AppError";
// FASE FISCAL 8.1 — sugestão de correção é injetada na linha de motivos
// de rejeição diretamente pelo repository, conforme spec. Mantém o service
// como pass-through e centraliza a regra (cStat → ação) em um único lugar.
import { getCorrecaoSugerida, type CorrecaoSugerida } from "../../services/nfe/nfeErrorHandler";
import type {
  AccountReceivable,
  InsertAccountReceivable,
  AccountPayable,
  InsertAccountPayable,
  FinancialTransaction,
  InsertFinancialTransaction,
  AccountsReceivableFilter,
  AccountsPayableFilter,
  CashflowFilter,
  FinancialDashboard,
} from "./finance.types";
import type { CnabImportHistory } from "@shared/schema";

/**
 * FinanceRepository — multi-tenant data access.
 *
 * Architecture decision: this repository OWNS its Drizzle queries (no longer
 * delegates to the legacy storage facade). That ownership is what lets us
 * enforce tenant scoping at the repository boundary: every read uses
 * `tenantWhere(table)`, every write uses `withTenant(payload)`. Both helpers
 * pull the empresaId from AsyncLocalStorage — there is no parameter the caller
 * could forget to pass.
 *
 * If a request reaches one of these methods with no tenant context installed,
 * `requireTenantId()` throws a 403 before any SQL is sent. That is the safety
 * net the user asked for: cross-tenant access is impossible by construction,
 * not by code review.
 */
export class FinanceRepository {
  // ── Accounts Receivable ────────────────────────────────────────────────
  async listAccountsReceivable(
    filter: AccountsReceivableFilter,
  ): Promise<AccountReceivable[]> {
    const conds = [];
    if (filter.status && filter.status !== "todos") {
      conds.push(eq(accountsReceivable.status, filter.status));
    }
    if (filter.companyId) {
      conds.push(eq(accountsReceivable.companyId, filter.companyId));
    }
    return db
      .select()
      .from(accountsReceivable)
      .where(tenantAnd(accountsReceivable, ...conds))
      .orderBy(desc(accountsReceivable.dataVencimento));
  }

  async getAccountReceivable(id: number): Promise<AccountReceivable | undefined> {
    const [row] = await db
      .select()
      .from(accountsReceivable)
      .where(
        and(eq(accountsReceivable.id, id), tenantWhere(accountsReceivable)),
      );
    return row;
  }

  async createAccountReceivable(
    data: InsertAccountReceivable,
  ): Promise<AccountReceivable> {
    const [row] = await db
      .insert(accountsReceivable)
      .values(withTenant(data))
      .returning();
    if (!row) {
      // INSERT … RETURNING with no row back is effectively impossible — the
      // DB would have raised already. Defensive guard to satisfy the type.
      throw new NotFoundError("Falha ao criar conta a receber.");
    }
    return row;
  }

  async updateAccountReceivable(
    id: number,
    data: Partial<InsertAccountReceivable>,
  ): Promise<AccountReceivable> {
    // Strip any tenant field from the patch so a malicious payload can't
    // reassign tenancy. Tenant migration is a separate, privileged operation.
    const safe = stripTenantFields(data as Record<string, unknown>);
    const [row] = await db
      .update(accountsReceivable)
      .set(safe)
      .where(
        and(eq(accountsReceivable.id, id), tenantWhere(accountsReceivable)),
      )
      .returning();
    if (!row) {
      throw new NotFoundError(
        `Conta a receber #${id} não encontrada no tenant atual.`,
      );
    }
    return row;
  }

  async payAccountReceivable(
    id: number,
    paymentDetails?: {
      valorPagoCentavos?: number | null;
      // FASE 6.2 — assinatura preparada para receber juros / multa /
      // desconto vindos do Segmento U do CNAB Itaú. NÃO são usados
      // ainda — a quebra contábil dedicada (lançamentos separados ou
      // colunas próprias) entra na FASE 6.3.
      jurosCentavos?: number;
      multaCentavos?: number;
      descontoCentavos?: number;
    },
  ): Promise<AccountReceivable> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(accountsReceivable)
        .set({ status: "pago", pagoEm: new Date() })
        .where(
          and(
            eq(accountsReceivable.id, id),
            tenantWhere(accountsReceivable),
            eq(accountsReceivable.status, "pendente"),
          ),
        )
        .returning();
      if (!row) {
        throw new Error("ACCOUNT_RECEIVABLE_ALREADY_PAID");
      }
      const today = new Date().toISOString().substring(0, 10);
      // FASE 6.1 — quando o caller informa o valor real liquidado pelo banco
      // (em centavos, vindo do Segmento T do CNAB 240), convertemos para
      // reais no formato numeric(12,2) e usamos no lançamento financeiro.
      // Caso contrário, fallback para o valor nominal do título — preserva
      // 100% do comportamento anterior para todo fluxo não-CNAB (conciliação
      // manual, baixa via UI, AR avulsa, etc.).
      const cents = paymentDetails?.valorPagoCentavos;
      const valorLancamento =
        typeof cents === "number" && Number.isFinite(cents) && cents > 0
          ? cents / 100
          : row.valor;
      await tx.insert(financialTransactions).values(
        withTenant({
          tipo: "entrada",
          valor: valorLancamento,
          descricao: `Recebimento: ${row.descricao}`,
          data: today,
          referenciaTipo: "receivable",
          referenciaId: id,
        }),
      );

      // FASE 6.3 — quebra contábil de juros / multa / desconto vindos do
      // Segmento U do CNAB (FASE 6.2). Inserts ADITIVOS, todos dentro da
      // mesma `tx` para preservar atomicidade com o lançamento principal:
      // se qualquer um falhar, a baixa inteira é revertida.
      //
      // Convenções respeitando o schema atual (`NÃO alterar schema`):
      //   • A tabela só tem `tipo` ∈ {entrada, saida}; usamos `entrada`
      //     para juros/multa (receita acessória) e `saida` para desconto
      //     (redução de receita).
      //   • Não há coluna `categoria` — codificamos a classe contábil
      //     no prefixo da `descricao` ([JUROS_CNAB], [MULTA_CNAB],
      //     [DESCONTO_CNAB]) para permitir filtragem futura sem migração.
      //   • Mesma `referenciaId` (= id da AR) e `referenciaTipo` para
      //     manter rastreabilidade até o título.
      const juros = paymentDetails?.jurosCentavos ?? 0;
      if (juros > 0) {
        await tx.insert(financialTransactions).values(
          withTenant({
            tipo: "entrada",
            valor: juros / 100,
            descricao: `[JUROS_CNAB] Juros recebidos: ${row.descricao}`,
            data: today,
            referenciaTipo: "receivable",
            referenciaId: id,
          }),
        );
      }

      const multa = paymentDetails?.multaCentavos ?? 0;
      if (multa > 0) {
        await tx.insert(financialTransactions).values(
          withTenant({
            tipo: "entrada",
            valor: multa / 100,
            descricao: `[MULTA_CNAB] Multa recebida: ${row.descricao}`,
            data: today,
            referenciaTipo: "receivable",
            referenciaId: id,
          }),
        );
      }

      const desconto = paymentDetails?.descontoCentavos ?? 0;
      if (desconto > 0) {
        await tx.insert(financialTransactions).values(
          withTenant({
            tipo: "saida",
            valor: desconto / 100,
            descricao: `[DESCONTO_CNAB] Desconto concedido: ${row.descricao}`,
            data: today,
            referenciaTipo: "receivable",
            referenciaId: id,
          }),
        );
      }

      return row;
    });
  }

  async deleteAccountReceivable(id: number): Promise<void> {
    await db
      .update(accountsReceivable)
      .set({ status: "cancelado" })
      .where(
        and(eq(accountsReceivable.id, id), tenantWhere(accountsReceivable)),
      );
  }

  // ── Accounts Payable ───────────────────────────────────────────────────
  async listAccountsPayable(
    filter: AccountsPayableFilter,
  ): Promise<AccountPayable[]> {
    const conds = [];
    if (filter.status && filter.status !== "todos") {
      conds.push(eq(accountsPayable.status, filter.status));
    }
    return db
      .select()
      .from(accountsPayable)
      .where(tenantAnd(accountsPayable, ...conds))
      .orderBy(desc(accountsPayable.dataVencimento));
  }

  async createAccountPayable(
    data: InsertAccountPayable,
  ): Promise<AccountPayable> {
    const [row] = await db
      .insert(accountsPayable)
      .values(withTenant(data))
      .returning();
    if (!row) {
      throw new NotFoundError("Falha ao criar conta a pagar.");
    }
    return row;
  }

  async updateAccountPayable(
    id: number,
    data: Partial<InsertAccountPayable>,
  ): Promise<AccountPayable> {
    const safe = stripTenantFields(data as Record<string, unknown>);
    const [row] = await db
      .update(accountsPayable)
      .set(safe)
      .where(and(eq(accountsPayable.id, id), tenantWhere(accountsPayable)))
      .returning();
    if (!row) {
      throw new NotFoundError(
        `Conta a pagar #${id} não encontrada no tenant atual.`,
      );
    }
    return row;
  }

  async payAccountPayable(id: number): Promise<AccountPayable> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(accountsPayable)
        .set({ status: "pago", pagoEm: new Date() })
        .where(and(eq(accountsPayable.id, id), tenantWhere(accountsPayable)))
        .returning();
      if (!row) {
        throw new NotFoundError(
          `Conta a pagar #${id} não encontrada no tenant atual.`,
        );
      }
      const today = new Date().toISOString().substring(0, 10);
      await tx.insert(financialTransactions).values(
        withTenant({
          tipo: "saida",
          valor: row.valor,
          descricao: `Pagamento: ${row.descricao} (${row.fornecedor})`,
          data: today,
          referenciaTipo: "payable",
          referenciaId: id,
        }),
      );
      return row;
    });
  }

  async deleteAccountPayable(id: number): Promise<void> {
    await db
      .update(accountsPayable)
      .set({ status: "cancelado" })
      .where(and(eq(accountsPayable.id, id), tenantWhere(accountsPayable)));
  }

  /**
   * FASE 6.5 — Decompõe um título recebível em principal + juros + multa +
   * desconto + totais, lendo APENAS a tabela `financial_transactions` (zero
   * mutação, zero recálculo de banco).
   *
   * Como funciona:
   *   • Lê todas as linhas com `referenciaTipo='receivable'` e
   *     `referenciaId=id` no tenant atual (intencional: NÃO usa o filtro
   *     `isLinhaAcessoriaCNAB` da FASE 6.4 — aqui o detalhe completo é
   *     justamente o ponto).
   *   • Classifica cada linha pelo prefixo da `descricao` gravado pela
   *     FASE 6.3 ([JUROS_CNAB] / [MULTA_CNAB] / [DESCONTO_CNAB]); o resto
   *     é tratado como linha principal de recebimento.
   *   • Reconstrói o "principal nominal" subtraindo juros/multa e somando
   *     desconto: a FASE 6.1 grava `principalLine = valorPago` (= nominal
   *     + juros + multa - desconto na fórmula CNAB padrão), então
   *     `nominal = principalLine - juros - multa + desconto`. Quando não
   *     há linhas acessórias (fluxo manual / pré-FASE 6.3), o cálculo
   *     colapsa em `principal = principalLine`, totais batendo com o que
   *     já existia — backward-compat total.
   *
   * Tenant-safe: o `tenantAnd` enforça empresaId, igual a todas as demais
   * leituras. AR de outro tenant retorna { principal: 0, ... } sem 404
   * para evitar enumeração cross-tenant — quem chama checa ele mesmo se
   * o título existe via `getAccountReceivable(id)` se quiser distinguir.
   */
  async getReceivableBreakdown(id: number): Promise<{
    principal: number;
    juros: number;
    multa: number;
    desconto: number;
    totalRecebido: number;
    totalLiquido: number;
  }> {
    const rows = await db
      .select()
      .from(financialTransactions)
      .where(
        tenantAnd(
          financialTransactions,
          eq(financialTransactions.referenciaId, id),
          eq(financialTransactions.referenciaTipo, "receivable"),
        ),
      );

    let principalLine = 0;
    let juros = 0;
    let multa = 0;
    let desconto = 0;

    for (const row of rows) {
      const valor = Number(row.valor);
      if (!Number.isFinite(valor)) continue;
      const desc = row.descricao ?? "";
      if (desc.startsWith("[JUROS_CNAB]")) {
        juros += valor;
      } else if (desc.startsWith("[MULTA_CNAB]")) {
        multa += valor;
      } else if (desc.startsWith("[DESCONTO_CNAB]")) {
        desconto += valor;
      } else {
        principalLine += valor;
      }
    }

    const principal = principalLine - juros - multa + desconto;
    const totalRecebido = principal + juros + multa;
    const totalLiquido = totalRecebido - desconto;

    // Arredondamento para 2 casas blinda contra ruído de ponto flutuante
    // (ex: 30 + 20 = 50.00000001 quando vindo de cents/100 múltiplos).
    const round2 = (n: number) => Math.round(n * 100) / 100;
    return {
      principal: round2(principal),
      juros: round2(juros),
      multa: round2(multa),
      desconto: round2(desconto),
      totalRecebido: round2(totalRecebido),
      totalLiquido: round2(totalLiquido),
    };
  }

  // ── Cashflow ───────────────────────────────────────────────────────────
  /**
   * FASE 6.4 — Predicado que identifica linhas acessórias do CNAB
   * (juros / multa / desconto) criadas pela FASE 6.3. Essas linhas
   * existem APENAS para classificação contábil; o valor de caixa real
   * já está embutido no lançamento principal `Recebimento: ...`.
   *
   * Aplicar `not(isLinhaAcessoriaCNAB())` em qualquer SUM ou listagem
   * agregada de fluxo de caixa evita dupla contagem. Consultas por
   * `referenciaId` (detalhe de um título) NÃO devem usar este filtro:
   * o usuário precisa ver principal + acessórios juntos.
   *
   * O parêntese externo é intencional — protege o `OR` quando o helper
   * é envolvido por `not(...)`, garantindo `NOT (a OR b OR c)` em vez
   * de `NOT a OR b OR c` independente do dialeto.
   */
  private isLinhaAcessoriaCNAB() {
    return sql`(${financialTransactions.descricao} LIKE '[JUROS_CNAB]%' OR ${financialTransactions.descricao} LIKE '[MULTA_CNAB]%' OR ${financialTransactions.descricao} LIKE '[DESCONTO_CNAB]%')`;
  }

  listFinancialTransactions(
    filter: CashflowFilter,
  ): Promise<FinancialTransaction[]> {
    const conds = [not(this.isLinhaAcessoriaCNAB())];
    if (filter.from) conds.push(gte(financialTransactions.data, filter.from));
    if (filter.to) conds.push(lte(financialTransactions.data, filter.to));
    return db
      .select()
      .from(financialTransactions)
      .where(tenantAnd(financialTransactions, ...conds))
      .orderBy(desc(financialTransactions.data));
  }

  async createFinancialTransaction(
    data: InsertFinancialTransaction,
  ): Promise<FinancialTransaction> {
    const [row] = await db
      .insert(financialTransactions)
      .values(withTenant(data))
      .returning();
    if (!row) {
      throw new NotFoundError("Falha ao criar lançamento financeiro.");
    }
    return row;
  }

  // ── Dashboard ──────────────────────────────────────────────────────────
  async getDashboard(): Promise<FinancialDashboard> {
    // .substring(0,10) preserves the "YYYY-MM-DD" prefix and returns string
    // (split("T")[0] is string | undefined under noUncheckedIndexedAccess).
    const today = new Date().toISOString().substring(0, 10);
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const sumExpr = sql<string>`coalesce(sum(valor::numeric), 0)`;

    const [arTotal] = await db
      .select({ sum: sumExpr })
      .from(accountsReceivable)
      .where(
        tenantAnd(
          accountsReceivable,
          eq(accountsReceivable.status, "pendente"),
        ),
      );

    const [apTotal] = await db
      .select({ sum: sumExpr })
      .from(accountsPayable)
      .where(
        tenantAnd(accountsPayable, eq(accountsPayable.status, "pendente")),
      );

    const [arVencidos] = await db
      .select({ sum: sumExpr })
      .from(accountsReceivable)
      .where(
        tenantAnd(
          accountsReceivable,
          eq(accountsReceivable.status, "pendente"),
          lte(accountsReceivable.dataVencimento, today),
        ),
      );

    const [apVencidos] = await db
      .select({ sum: sumExpr })
      .from(accountsPayable)
      .where(
        tenantAnd(
          accountsPayable,
          eq(accountsPayable.status, "pendente"),
          lte(accountsPayable.dataVencimento, today),
        ),
      );

    // FASE 6.4 — exclui linhas acessórias do CNAB para evitar dupla
    // contagem nos cards de Entradas/Saídas do dashboard.
    const [entradas] = await db
      .select({ sum: sumExpr })
      .from(financialTransactions)
      .where(
        tenantAnd(
          financialTransactions,
          eq(financialTransactions.tipo, "entrada"),
          gte(financialTransactions.data, monthStart),
          not(this.isLinhaAcessoriaCNAB()),
        ),
      );

    const [saidas] = await db
      .select({ sum: sumExpr })
      .from(financialTransactions)
      .where(
        tenantAnd(
          financialTransactions,
          eq(financialTransactions.tipo, "saida"),
          gte(financialTransactions.data, monthStart),
          not(this.isLinhaAcessoriaCNAB()),
        ),
      );

    // SQL aggregates without GROUP BY always return exactly one row, but TS
    // can't see that. The "0" fallback is unreachable at runtime; it only
    // satisfies noUncheckedIndexedAccess. parseFloat("0") === 0.
    const arTotalSum = parseFloat(arTotal?.sum ?? "0");
    const apTotalSum = parseFloat(apTotal?.sum ?? "0");
    const arVencidosSum = parseFloat(arVencidos?.sum ?? "0");
    const apVencidosSum = parseFloat(apVencidos?.sum ?? "0");
    const recebidoMes = parseFloat(entradas?.sum ?? "0");
    const pagoMes = parseFloat(saidas?.sum ?? "0");

    return {
      totalReceber: arTotalSum,
      totalPagar: apTotalSum,
      saldoProjetado: arTotalSum - apTotalSum,
      vencidasReceber: arVencidosSum,
      vencidasPagar: apVencidosSum,
      // Legacy-compatible aliases for existing frontend consumers.
      totalReceivable: arTotalSum,
      totalPayable: apTotalSum,
      vencidosAR: arVencidosSum,
      vencidosAP: apVencidosSum,
      recebidoMes,
      pagoMes,
      balanceMes: recebidoMes - pagoMes,
    };
  }

  // ── Logging ─────────────────────────────────────────────────────────────
  async log(params: {
    action: string;
    description: string;
    userId?: number;
    level?: string;
  }): Promise<void> {
    // Audit trail is tenant-scoped too — system_logs already carries
    // `companyId`, so we reuse it as the tenant marker.
    await db.insert(systemLogs).values({
      action: params.action,
      description: params.description,
      userId: params.userId,
      level: params.level ?? "INFO",
      companyId: requireTenantId(),
    } as any);
  }

  // FASE 4 (R7) — wrapper tenant-safe usado pelo CNAB de retorno do Itaú.
  // Substitui `storage.getAccountReceivableByOrderId` (que não filtra por
  // empresa). Aqui aplicamos `tenantWhere` para garantir que o lookup só
  // enxergue AR do tenant em escopo (resolvido pelo middleware tenantContext).
  async getAccountReceivableByOrderId(
    orderId: number,
  ): Promise<AccountReceivable | undefined> {
    const [row] = await db
      .select()
      .from(accountsReceivable)
      .where(
        and(
          eq(accountsReceivable.orderId, orderId),
          tenantWhere(accountsReceivable),
        ),
      )
      .limit(1);
    return row;
  }

  // FASE 5 — wrapper tenant-safe para histórico CNAB.
  // Substitui `storage.listCnabImportHistory` (que não filtra por empresa).
  // Mantém estrutura/tipo de retorno idênticos para preservar o response do
  // endpoint GET /api/bank/retorno/historico.
  async listCnabImportHistory(limit = 20): Promise<CnabImportHistory[]> {
    return db
      .select()
      .from(cnabImportHistory)
      .where(tenantWhere(cnabImportHistory))
      .orderBy(desc(cnabImportHistory.createdAt))
      .limit(limit);
  }

  // Cross-cutting: company config is per-tenant; the underlying storage method
  // already filters by the company in scope (or returns the global default).
  getCompanyConfig() {
    return storage.getCompanyConfig();
  }

  // FASE NF.7.5 — resumo de NF-e emitidas por UF do EMITENTE.
  //
  // A tabela `nfe_emissoes` NÃO tem coluna UF (regra do spec: não alterar
  // schema). A UF é extraída por regex direto do XML, mesma fonte da verdade
  // que o `nfeSender.ts` usa para resolver a URL do webservice. Preferimos
  // `xml_autorizado` (XML final retornado pela SEFAZ) e caímos para
  // `xml_gerado` quando a NF ainda não foi autorizada.
  //
  // Tenant scope: `nfe_emissoes` não tem `companyId` próprio — fazemos JOIN
  // com `orders` (que tem) e filtramos pelo tenant em escopo. Isolamento total
  // entre empresas, sem mudar nenhum schema.
  //
  // O `usaFallback` indica se a UF cai na lista de estados ainda não mapeados
  // em `SEFAZ_URL` (BA, PE, GO, etc.) — espelha o `[NFE_SEFAZ_FALLBACK_UF]`.
  async getNfeResumoPorUF(): Promise<
    { uf: string; total: number; usaFallback: boolean }[]
  > {
    const ufsMapeadas = new Set(['SP', 'MG', 'RJ', 'RS', 'PR', 'SC']);

    const rows = await db
      .select({
        uf: sql<string | null>`COALESCE(
          substring(${nfeEmissoes.xmlAutorizado} FROM '<emit>[\\s\\S]*?<UF>([A-Z]{2})</UF>'),
          substring(${nfeEmissoes.xmlGerado}     FROM '<emit>[\\s\\S]*?<UF>([A-Z]{2})</UF>')
        )`,
        total: sql<number>`count(*)::int`,
      })
      .from(nfeEmissoes)
      .innerJoin(orders, eq(orders.id, nfeEmissoes.orderId))
      .where(eq(orders.companyId, requireTenantId()))
      .groupBy(sql`1`);

    return rows
      .map((r) => ({
        uf: (r.uf ?? 'N/D').toUpperCase(),
        total: Number(r.total) || 0,
        usaFallback: !ufsMapeadas.has((r.uf ?? '').toUpperCase()),
      }))
      .sort((a, b) => b.total - a.total);
  }

  // FASE NF.7.5/7.6 — resumo de NF-e agrupadas pelo status fiscal atual.
  //
  // Apenas leitura. Usa o `status` que a própria emissão já grava em
  // `nfe_emissoes.status` (gerada | assinada | enviada | autorizada |
  // rejeitada | erro | cancelada | denegada — definidos em shared/schema.ts
  // L1066-1077). Não criamos novos status nem mudamos os existentes.
  //
  // Tenant scope via JOIN com `orders.companyId`, idêntico ao
  // getNfeResumoPorUF (nfe_emissoes não tem companyId próprio).
  async getNfeResumoPorStatus(): Promise<{ status: string; total: number }[]> {
    const rows = await db
      .select({
        status: nfeEmissoes.status,
        total: sql<number>`count(*)::int`,
      })
      .from(nfeEmissoes)
      .innerJoin(orders, eq(orders.id, nfeEmissoes.orderId))
      .where(eq(orders.companyId, requireTenantId()))
      .groupBy(nfeEmissoes.status);

    return rows
      .map((r) => ({
        status: r.status ?? 'N/D',
        total: Number(r.total) || 0,
      }))
      .sort((a, b) => b.total - a.total);
  }

  // FASE FISCAL 7.9 — motivos de rejeição agrupados com vínculo ao pedido.
  //
  // Read-only. Lê apenas NF-e em status terminal de falha
  // (rejeitada | erro | denegada) e devolve a tripla (status, cStat, xMotivo)
  // já correlacionada ao `orderId` que originou a NF. O agrupamento por
  // (orderId, status, cStat, xMotivo) garante que múltiplas tentativas de
  // emissão para o mesmo pedido com a mesma rejeição se condensem em uma
  // única linha (campo `total`), evitando ruído visual no card.
  //
  // Tenant scope idêntico ao getNfeResumoPorStatus: JOIN com `orders` e
  // filtro por `companyId` em escopo. Sem alteração no schema.
  async getNfeMotivosRejeicao(): Promise<
    {
      status: string;
      cStat: string;
      xMotivo: string;
      total: number;
      orderId: number;
      // FASE FISCAL 8.1 — sugestão estruturada (tipo + mensagem). O `tipo`
      // é o discriminador que controla a visibilidade do botão "Corrigir e
      // Reenviar" no frontend e o aceite do endpoint /corrigir-reenviar.
      sugestao: CorrecaoSugerida;
    }[]
  > {
    const rows = await db
      .select({
        status: nfeEmissoes.status,
        orderId: nfeEmissoes.orderId,
        cStat: nfeEmissoes.cStat,
        xMotivo: nfeEmissoes.xMotivo,
        total: sql<number>`count(*)::int`,
      })
      .from(nfeEmissoes)
      .innerJoin(orders, eq(orders.id, nfeEmissoes.orderId))
      .where(
        and(
          eq(orders.companyId, requireTenantId()),
          inArray(nfeEmissoes.status, ['rejeitada', 'erro', 'denegada']),
        ),
      )
      .groupBy(
        nfeEmissoes.status,
        nfeEmissoes.orderId,
        nfeEmissoes.cStat,
        nfeEmissoes.xMotivo,
      );

    return rows
      .map((r) => {
        const cStat = r.cStat ?? '';
        // FASE FISCAL 8.1 — `sugestao` é injetada aqui para que o consumidor
        // (HTTP, CLI, jobs) receba SEMPRE a mesma classificação. Pura, sem IO.
        const sugestao = getCorrecaoSugerida(cStat);
        return {
          status: r.status ?? 'N/D',
          orderId: r.orderId,
          cStat,
          xMotivo: r.xMotivo ?? '',
          total: Number(r.total) || 0,
          sugestao,
        };
      })
      .sort((a, b) => b.total - a.total);
  }
}

export const financeRepository = new FinanceRepository();
