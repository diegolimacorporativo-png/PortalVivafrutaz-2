import { NotFoundError } from "../../core/errors/AppError";
import { financeRepository, FinanceRepository } from "./finance.repository";
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

  async payAccountReceivable(id: number, userId: number): Promise<AccountReceivable> {
    const record = await this.repo.payAccountReceivable(id);
    await this.repo.log({
      action: "FINANCE_AR_PAY",
      description: `Conta a receber marcada como paga: ${record.descricao}`,
      userId,
    });
    return record;
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
