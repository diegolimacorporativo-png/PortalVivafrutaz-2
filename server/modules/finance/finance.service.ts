import { NotFoundError } from "../../shared/errors/AppError";
import { financeRepository, FinanceRepository } from "./finance.repository";
// FASE FIN.3 — import estático de OrdersService.
// Seguro: nenhum arquivo do módulo `orders/` importa de `finance/`, então
// não há risco de ciclo. O símbolo só é referenciado dentro de
// `handleOrderPayment`, nunca em escopo de módulo, o que mantém o load
// order resiliente mesmo se algum dia surgir uma dependência reversa.
import { ordersService } from "../orders/orders.service";
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

/**
 * BR-Code (PIX) static payload generator — pure function, no IO.
 * Extracted from the legacy `routes.ts` so it can be unit tested and reused.
 */
function generatePixPayload(
  chave: string,
  nome: string,
  cidade: string,
  valor: number,
  txid: string,
): string {
  const sanitize = (s: string, max: number) =>
    s.replace(/[^\w\s]/gi, "").slice(0, max).padEnd(1, " ").trim();
  const tlv = (id: string, value: string) =>
    `${id}${String(value.length).padStart(2, "0")}${value}`;
  const merchant = tlv("00", "br.gov.bcb.pix") + tlv("01", chave.slice(0, 77));
  const gui = tlv("26", merchant);
  const addData = tlv("62", tlv("05", sanitize(txid, 25)));
  const nomeClean = sanitize(nome, 25);
  const cidadeClean = sanitize(cidade, 15);
  const valorStr = valor > 0 ? valor.toFixed(2) : "";
  let payload = tlv("00", "01") + gui + tlv("52", "0000") + tlv("53", "986");
  if (valorStr) payload += tlv("54", valorStr);
  payload +=
    tlv("58", "BR") + tlv("59", nomeClean) + tlv("60", cidadeClean) + addData + "6304";
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++)
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
  }
  return payload + (crc & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

/**
 * FinanceService — business rules of the finance module.
 *
 * Architecture decision: services own *behavior*. They orchestrate the
 * repository, enforce invariants, and never touch req/res. This is what makes
 * the module reusable from a CLI, a worker, or another module — not just HTTP.
 */
export class FinanceService {
  constructor(private readonly repo: FinanceRepository = financeRepository) {}

  // ── Dashboard ──────────────────────────────────────────────────────────
  getDashboard(): Promise<FinancialDashboard> {
    return this.repo.getDashboard();
  }

  // ── Accounts Receivable ────────────────────────────────────────────────
  listAccountsReceivable(filter: AccountsReceivableFilter): Promise<AccountReceivable[]> {
    return this.repo.listAccountsReceivable(filter);
  }

  async createAccountReceivable(
    data: InsertAccountReceivable,
    userId: number,
  ): Promise<AccountReceivable> {
    // Business rule: when payment method is PIX (default) auto-generate the
    // BR-Code payload from the company's CNPJ so the frontend can render the
    // QR code without a second round-trip.
    let pixPayload: string | undefined;
    if (!data.formaPagamento || data.formaPagamento === "pix") {
      const config = await this.repo.getCompanyConfig();
      if (config?.cnpj) {
        pixPayload = generatePixPayload(
          config.cnpj.replace(/\D/g, ""),
          config.companyName || "VivaFrutaz",
          config.city || "SAO PAULO",
          parseFloat(String(data.valor || "0")),
          `AR${Date.now().toString().slice(-10)}`,
        );
      }
    }

    const record = await this.repo.createAccountReceivable({ ...data, pixPayload });
    await this.repo.log({
      action: "FINANCE_AR_CREATE",
      description: `Conta a receber criada: ${record.descricao} R$${record.valor}`,
      userId,
    });
    return record;
  }

  updateAccountReceivable(
    id: number,
    data: Partial<InsertAccountReceivable>,
  ): Promise<AccountReceivable> {
    return this.repo.updateAccountReceivable(id, data);
  }

  async payAccountReceivable(
    id: number,
    userId: number,
    paymentDetails?: {
      valorPagoCentavos?: number | null;
      // FASE 6.2 — metadados do Segmento U (CNAB Itaú). Atualmente apenas
      // trafegam pela assinatura; a persistência separada (linhas dedicadas
      // em financial_transactions ou colunas próprias) virá em FASE 6.3.
      jurosCentavos?: number;
      multaCentavos?: number;
      descontoCentavos?: number;
    },
  ): Promise<AccountReceivable> {
    // FASE 6.1 — `paymentDetails` é opcional para preservar 100% da
    // compatibilidade com chamadores existentes (conciliação manual,
    // controllers, testes). Quando ausente, o repository usa o valor
    // nominal do título exatamente como antes.
    const record = await this.repo.payAccountReceivable(id, paymentDetails);
    await this.repo.log({
      action: "FINANCE_AR_PAY",
      description: `Conta a receber marcada como paga: ${record.descricao}`,
      userId,
    });
    // FASE FIN.3 — propaga o pagamento para o pedido vinculado (se houver).
    // Chamada `await` mas envolvida em try/catch interno do helper, então
    // jamais aborta o pagamento. Mantém o contrato existente: este método
    // continua devolvendo o `AccountReceivable` exatamente como antes.
    await this.handleOrderPayment(record);
    return record;
  }

  /**
   * FASE FIN.3 — Hook de pós-pagamento de AR.
   *
   * Quando uma conta a receber é marcada como paga, identifica o pedido
   * vinculado (via `accounts_receivable.orderId`) e emite um log estruturado
   * `[FIN.3] Pedido marcado como pago`. Não altera schema, não modifica o
   * pedido, não dispara fluxos paralelos.
   *
   * Garantias:
   *   • Sem efeito se a AR não tiver `orderId` (ex.: AR avulsa, criada à mão).
   *   • Sem efeito se o pedido não for encontrado (multi-tenant 404).
   *   • Idempotente em termos de side-effects: a única ação é log.
   *     Múltiplas chamadas geram múltiplos logs, mas zero corrupção de dados.
   *   • Fail-safe: erro na busca do pedido jamais aborta o pagamento.
   */
  private async handleOrderPayment(ar: AccountReceivable): Promise<void> {
    if (!ar?.orderId) return;
    try {
      const detail = await ordersService.get(ar.orderId);
      if (!detail) return;
      console.log("[FIN.3] Pedido marcado como pago", {
        orderId: ar.orderId,
        paidAt: ar.pagoEm,
        arId: ar.id,
        orderCode: detail.order?.orderCode,
      });
    } catch (err) {
      // NotFoundError / mismatch de tenant / qualquer erro de leitura:
      // silencia, registra como warn e devolve. NÃO propaga — pagamento
      // já foi concluído com sucesso pelo repositório acima.
      console.warn("[FIN.3] Pedido não localizado para AR paga (fail-safe)", {
        orderId: ar.orderId,
        arId: ar.id,
        err: (err as Error)?.message,
      });
    }
  }

  deleteAccountReceivable(id: number): Promise<void> {
    return this.repo.deleteAccountReceivable(id);
  }

  async getPixForReceivable(id: number) {
    const ar = await this.repo.getAccountReceivable(id);
    if (!ar) throw new NotFoundError("Conta a receber não encontrada");
    return {
      id: ar.id,
      descricao: ar.descricao,
      valor: ar.valor,
      pixPayload: ar.pixPayload,
    };
  }

  /**
   * FASE 6.5 — pass-through puro. O service não tem regra de negócio aqui:
   * a decomposição é determinada pelos prefixos de `descricao` que a FASE
   * 6.3 grava e pelos totais que a FASE 6.1 inscreve. Qualquer agregação
   * adicional (ex: status do título, parcelas) deve entrar em outra fase.
   */
  async getReceivableBreakdown(id: number) {
    return this.repo.getReceivableBreakdown(id);
  }

  // ── Accounts Payable ───────────────────────────────────────────────────
  listAccountsPayable(filter: AccountsPayableFilter): Promise<AccountPayable[]> {
    return this.repo.listAccountsPayable(filter);
  }

  async createAccountPayable(
    data: InsertAccountPayable,
    userId: number,
  ): Promise<AccountPayable> {
    const record = await this.repo.createAccountPayable(data);
    await this.repo.log({
      action: "FINANCE_AP_CREATE",
      description: `Conta a pagar criada: ${record.descricao} R$${record.valor}`,
      userId,
    });
    return record;
  }

  updateAccountPayable(
    id: number,
    data: Partial<InsertAccountPayable>,
  ): Promise<AccountPayable> {
    return this.repo.updateAccountPayable(id, data);
  }

  async payAccountPayable(id: number, userId: number): Promise<AccountPayable> {
    const record = await this.repo.payAccountPayable(id);
    await this.repo.log({
      action: "FINANCE_AP_PAY",
      description: `Conta a pagar marcada como paga: ${record.descricao}`,
      userId,
    });
    return record;
  }

  deleteAccountPayable(id: number): Promise<void> {
    return this.repo.deleteAccountPayable(id);
  }

  // ── Cashflow ───────────────────────────────────────────────────────────
  listCashflow(filter: CashflowFilter): Promise<FinancialTransaction[]> {
    return this.repo.listFinancialTransactions(filter);
  }

  createManualCashflowEntry(
    data: InsertFinancialTransaction,
  ): Promise<FinancialTransaction> {
    return this.repo.createFinancialTransaction({
      ...data,
      referenciaTipo: "manual",
    } as InsertFinancialTransaction);
  }
}

export const financeService = new FinanceService();
