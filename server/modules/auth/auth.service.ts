import bcrypt from "bcryptjs";
import { authRepository, AuthRepository } from "./auth.repository";
import type {
  ForgotPasswordOutcome,
  LoginInput,
  LoginOutcome,
  MeOutcome,
  SessionPayload,
} from "./auth.types";

/** Number of failed attempts before an account is auto-locked. */
const MAX_ATTEMPTS = 3;

/** Roles that get notified when any account is auto-locked. */
const LOCKOUT_NOTIFY_ROLES = ["ADMIN", "DIRECTOR", "DEVELOPER"] as const;

/**
 * AuthService — business rules of the auth module.
 *
 * Architecture decision: identical to FinanceService and UsersService —
 * services own behaviour, never touch req/res. Auth has many legitimate
 * failure modes, so the service returns a discriminated `LoginOutcome` /
 * `MeOutcome` instead of throwing. This keeps every legacy status code and
 * Portuguese message intact while leaving the controller as a thin HTTP
 * adapter.
 *
 * What is preserved verbatim from the legacy `routes.ts`:
 *  • Account lockout after 3 wrong attempts (status 423 with the exact
 *    Portuguese message and `LOGIN_BLOCKED` / `ACCOUNT_LOCKED` audit logs).
 *  • Plaintext-to-bcrypt upgrade-on-correct-login for legacy seeded passwords.
 *  • Maintenance-mode block for company logins only (status 503,
 *    `MAINTENANCE_MODE` body) — admin/staff can always log in.
 *  • Email normalisation (lowercase + trim).
 *  • Audit logs (`LOGIN`, `LOGIN_FAILED`, `LOGIN_BLOCKED`, `ACCOUNT_LOCKED`)
 *    written through the repository so the security-logs UI keeps working.
 */
export class AuthService {
  constructor(private readonly repo: AuthRepository = authRepository) {}

  // ── Login ──────────────────────────────────────────────────────────────
  async attemptLogin(input: LoginInput, ip: string): Promise<LoginOutcome> {
    const normalizedEmail = input.email.toLowerCase().trim();
    console.log("[LOGIN] Tentativa de login:", {
      email: normalizedEmail,
      type: input.type,
    });

    return input.type === "admin"
      ? this.attemptAdminLogin(normalizedEmail, input.password, ip)
      : this.attemptCompanyLogin(normalizedEmail, input.password, ip);
  }

  // ── /me ────────────────────────────────────────────────────────────────
  async resolveSession(session: SessionPayload | null | undefined): Promise<MeOutcome> {
    if (!session) return { kind: "unauthenticated" };

    if (session.userType === "admin" && session.userId) {
      const user = await this.repo.getUserById(session.userId);
      if (user) return { kind: "admin", user };
    } else if (session.userType === "company" && session.companyId) {
      const company = await this.repo.getCompanyById(session.companyId);
      if (company) return { kind: "company", company };
    }

    return { kind: "unauthenticated" };
  }

  // ── Forgot password ────────────────────────────────────────────────────
  async requestPasswordReset(email: string): Promise<ForgotPasswordOutcome> {
    const company = await this.repo.getCompanyByEmail(email);
    if (!company) {
      return { found: false, message: "Email não encontrado no sistema." };
    }
    const request = await this.repo.createPasswordResetRequest(company.id);
    return {
      found: true,
      message:
        "Solicitação enviada! A equipe VivaFrutaz irá redefinir sua senha em breve.",
      requestId: request.id,
    };
  }

  // ── Log unauthorized access (best-effort) ──────────────────────────────
  async logUnauthorizedAccess(
    actorUserId: number | null,
    route: string | undefined,
    ip: string,
  ): Promise<{ ok: boolean }> {
    try {
      const user = actorUserId ? await this.repo.getUserById(actorUserId) : null;
      await this.repo.log({
        action: "UNAUTHORIZED_ACCESS",
        description: `Tentativa de acesso não autorizado à rota: ${route || "?"}`,
        userId: user?.id ?? undefined,
        userEmail: user?.email || "(desconhecido)",
        userRole: user?.role || "(desconhecido)",
        ip,
        level: "WARN",
      });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  // ── Internal: admin login ──────────────────────────────────────────────
  private async attemptAdminLogin(
    email: string,
    password: string,
    ip: string,
  ): Promise<LoginOutcome> {
    const user = await this.repo.getUserByEmail(email);
    console.log("[LOGIN] Usuário encontrado:", user ? "SIM" : "NÃO");

    if (!user) {
      await this.repo.log({
        action: "LOGIN_FAILED",
        description: `Tentativa de login falhou (usuário não encontrado): ${email}`,
        userEmail: email,
        level: "WARN",
        ip,
      });
      return {
        kind: "failure",
        status: 401,
        message: "Usuário ou senha incorretos.",
      };
    }

    if (user.isLocked) {
      console.log("[LOGIN] Conta bloqueada");
      await this.repo.log({
        action: "LOGIN_BLOCKED",
        description: `Tentativa de acesso a conta bloqueada: ${email}`,
        userId: user.id,
        userEmail: email,
        level: "ERROR",
        ip,
      });
      return {
        kind: "failure",
        status: 423,
        message:
          "Conta temporariamente bloqueada por segurança.\nEntre em contato com o administrador.",
      };
    }

    if (!user.active) {
      console.log("[LOGIN] Usuário inativo");
      await this.repo.log({
        action: "LOGIN_BLOCKED",
        description: `Login bloqueado (usuário inativo): ${email}`,
        userEmail: email,
        level: "WARN",
        ip,
      });
      return {
        kind: "failure",
        status: 401,
        message: "Usuário inativo. Entre em contato com o administrador.",
      };
    }

    const passwordMatch = await this.verifyAndMaybeUpgradeUserPassword(
      user.id,
      password,
      user.password,
    );
    console.log("[LOGIN] Senha correcta:", passwordMatch);

    if (!passwordMatch) {
      const newAttempts = (user.loginAttempts || 0) + 1;
      const willLock = newAttempts >= MAX_ATTEMPTS;
      await this.repo.updateUser(user.id, {
        loginAttempts: newAttempts,
        lastLoginAttempt: new Date(),
        ...(willLock ? { isLocked: true } : {}),
      });
      await this.repo.log({
        action: "LOGIN_FAILED",
        description: `Senha incorreta para usuário interno: ${email} — tentativa ${newAttempts}/${MAX_ATTEMPTS}${willLock ? " — CONTA BLOQUEADA" : ""}`,
        userId: user.id,
        userEmail: email,
        level: "WARN",
        ip,
      });
      if (willLock) {
        await this.notifyAdminsOfLockout(email, "usuário interno", ip);
        return {
          kind: "failure",
          status: 423,
          message:
            "Conta temporariamente bloqueada por segurança.\nEntre em contato com o administrador.",
        };
      }
      return {
        kind: "failure",
        status: 401,
        message: `Usuário ou senha incorretos. (${newAttempts}/${MAX_ATTEMPTS} tentativas)`,
      };
    }

    // Success — reset attempts, log
    console.log("[LOGIN] Login bem-sucedido para usuário:", user.email);
    const refreshed = await this.repo.updateUser(user.id, {
      loginAttempts: 0,
      lastLoginAttempt: new Date(),
    });
    await this.repo.log({
      action: "LOGIN",
      description: `Login realizado: ${refreshed.name} (${refreshed.role})`,
      userId: refreshed.id,
      userEmail: refreshed.email,
      userRole: refreshed.role,
      ip,
    });
    return { kind: "admin-success", user: refreshed };
  }

  // ── Internal: company login ────────────────────────────────────────────
  private async attemptCompanyLogin(
    email: string,
    password: string,
    ip: string,
  ): Promise<LoginOutcome> {
    // Maintenance mode blocks client logins; staff are unaffected.
    if (await this.repo.getMaintenanceMode()) {
      return { kind: "failure", status: 503, message: "MAINTENANCE_MODE" };
    }

    const company = await this.repo.getCompanyByEmail(email);
    console.log("[LOGIN] Empresa encontrada:", company ? "SIM" : "NÃO");

    if (!company) {
      await this.repo.log({
        action: "LOGIN_FAILED",
        description: `Tentativa de login cliente falhou (usuário não encontrado): ${email}`,
        userEmail: email,
        level: "WARN",
        ip,
      });
      return {
        kind: "failure",
        status: 401,
        message: "Usuário não encontrado. Verifique o usuário e tente novamente.",
      };
    }

    const c = company as any; // Company schema has loginAttempts/isLocked
    if (c.isLocked) {
      console.log("[LOGIN] Empresa bloqueada");
      await this.repo.log({
        action: "LOGIN_BLOCKED",
        description: `Tentativa de acesso a empresa bloqueada: ${email}`,
        companyId: company.id,
        userEmail: email,
        level: "ERROR",
        ip,
      });
      return {
        kind: "failure",
        status: 423,
        message:
          "Conta temporariamente bloqueada por segurança.\nEntre em contato com o administrador.",
      };
    }

    if (!company.active) {
      console.log("[LOGIN] Empresa inativa");
      await this.repo.log({
        action: "LOGIN_BLOCKED",
        description: `Login cliente bloqueado (conta inativa): ${email}`,
        companyId: company.id,
        userEmail: company.email,
        level: "WARN",
        ip,
      });
      return {
        kind: "failure",
        status: 401,
        message:
          "Conta desativada. Entre em contato com a equipe VivaFrutaz para reativar seu acesso.",
      };
    }

    const passwordMatch = await this.verifyAndMaybeUpgradeCompanyPassword(
      company.id,
      password,
      company.password,
    );
    console.log("[LOGIN] Senha correcta (empresa):", passwordMatch);

    if (!passwordMatch) {
      const newAttempts = (c.loginAttempts || 0) + 1;
      const willLock = newAttempts >= MAX_ATTEMPTS;
      await this.repo.updateCompany(company.id, {
        loginAttempts: newAttempts,
        lastLoginAttempt: new Date(),
        ...(willLock ? { isLocked: true } : {}),
      } as any);
      await this.repo.log({
        action: "LOGIN_FAILED",
        description: `Senha incorreta para empresa: ${email} — tentativa ${newAttempts}/${MAX_ATTEMPTS}${willLock ? " — CONTA BLOQUEADA" : ""}`,
        companyId: company.id,
        userEmail: email,
        level: "WARN",
        ip,
      });
      if (willLock) {
        await this.notifyAdminsOfLockout(email, "empresa cliente", ip);
        return {
          kind: "failure",
          status: 423,
          message:
            "Conta temporariamente bloqueada por segurança.\nEntre em contato com o administrador.",
        };
      }
      return {
        kind: "failure",
        status: 401,
        message: `Usuário ou senha incorretos. (${newAttempts}/${MAX_ATTEMPTS} tentativas)`,
      };
    }

    // Success — reset attempts, log
    console.log("[LOGIN] Login bem-sucedido para empresa:", company.email);
    const refreshed = await this.repo.updateCompany(company.id, {
      loginAttempts: 0,
      lastLoginAttempt: new Date(),
    } as any);
    await this.repo.log({
      action: "LOGIN",
      description: `Login cliente: ${refreshed.companyName}`,
      companyId: refreshed.id,
      userEmail: refreshed.email,
      userRole: "CLIENT",
      ip,
    });
    return { kind: "company-success", company: refreshed };
  }

  // ── Internal helpers ───────────────────────────────────────────────────
  private async verifyAndMaybeUpgradeUserPassword(
    userId: number,
    submitted: string,
    stored: string,
  ): Promise<boolean> {
    const isHashed =
      typeof stored === "string" && stored.startsWith("$2");
    if (isHashed) return bcrypt.compare(submitted, stored);
    if (stored !== submitted) return false;
    // Legacy plaintext password → upgrade to bcrypt on first successful login.
    await this.repo.updateUser(userId, { password: submitted });
    return true;
  }

  private async verifyAndMaybeUpgradeCompanyPassword(
    companyId: number,
    submitted: string,
    stored: string,
  ): Promise<boolean> {
    const isHashed =
      typeof stored === "string" && stored.startsWith("$2");
    if (isHashed) return bcrypt.compare(submitted, stored);
    if (stored !== submitted) return false;
    await this.repo.updateCompany(companyId, { password: submitted } as any);
    return true;
  }

  /**
   * Write an `ACCOUNT_LOCKED` security log per admin/director/developer so
   * the security-logs UI shows one row per audience. Mirrors legacy.
   * Best-effort — failures don't block the login response.
   */
  private async notifyAdminsOfLockout(
    target: string,
    targetType: string,
    ip: string,
  ): Promise<void> {
    try {
      const allUsers = await this.repo.listUsers();
      const admins = allUsers.filter(
        (u) =>
          LOCKOUT_NOTIFY_ROLES.includes(u.role as any) && u.active,
      );
      for (const _admin of admins) {
        await this.repo.log({
          action: "ACCOUNT_LOCKED",
          description: `[ALERTA SEGURANÇA] Conta ${targetType} bloqueada automaticamente após ${MAX_ATTEMPTS} tentativas erradas. Conta: ${target} | IP: ${ip}`,
          userEmail: target,
          level: "ERROR",
          ip,
        });
      }
    } catch {
      /* swallow — security logging should never break the login response */
    }
  }
}

export const authService = new AuthService();
