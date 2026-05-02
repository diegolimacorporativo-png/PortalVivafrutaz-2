/**
 * FASE 14.5 — User Provisioning Service
 *
 * Central gateway for ALL company account creation that originates from
 * automated sources (Clara IA, future integrations, etc.).
 *
 * Rules:
 *  - Generates a cryptographically secure temporary password (never hardcoded)
 *  - Stores password as bcrypt hash (via storage.createCompany)
 *  - Sets mustChangePassword = true and passwordTemporary = true
 *  - Records createdBySource = "CLARA_AI" for traceability
 *  - Writes an audit log entry
 *  - Returns the plaintext temp password ONCE to the caller so Clara can show it
 *  - Never exposes the temp password in any API response
 */
import crypto from "crypto";
import { storage } from "../../services/storage";
import type { Company } from "@shared/schema";

export interface CompanyProvisioningInput {
  companyName: string;
  contactName?: string;
  email: string;
  cnpj?: string | null;
  /** User ID of the admin/developer invoking Clara IA */
  createdByUserId?: number;
  /** IP address of the request, for audit trail */
  ip?: string;
}

export interface CompanyProvisioningResult {
  company: Company;
  /**
   * The plaintext temporary password — returned ONCE so Clara can display it
   * to the operator who triggered the creation. Never stored plain, never
   * returned by any API endpoint.
   */
  tempPassword: string;
}

export async function createCompanyFromClaraAI(
  input: CompanyProvisioningInput,
): Promise<CompanyProvisioningResult> {
  // 24-character hex string — 96 bits of entropy
  const tempPassword = crypto.randomBytes(12).toString("hex");

  const company = await storage.createCompany({
    companyName: input.companyName,
    contactName: input.contactName || input.companyName,
    email: input.email,
    password: tempPassword, // storage.createCompany bcrypt-hashes this
    cnpj: input.cnpj ?? null,
    priceGroupId: 1,
    allowedOrderDays: [],
    active: true,
    clientType: "semanal",
    mustChangePassword: true,
    passwordTemporary: true,
    createdBySource: "CLARA_AI",
  } as any);

  await storage.createLog({
    action: "COMPANY_PROVISIONED",
    description:
      `Empresa "${input.companyName}" criada via Clara IA. ` +
      `Senha temporária gerada automaticamente. Troca obrigatória no primeiro login.`,
    userId: input.createdByUserId,
    companyId: company.id,
    userEmail: input.email,
    level: "INFO",
    ip: input.ip,
  });

  return { company, tempPassword };
}
