import bcrypt from "bcryptjs";
import { authRepository, AuthRepository } from "./auth.repository";
import type {
  ForgotPasswordOutcome,
  LoginInput,
  LoginOutcome,
  MeOutcome,
  SessionPayload,
} from "./auth.types";
// FASE 14.6 — in-memory L1 post-failure recorder (risk score only — not a gate)
import {
  recordUserLoginSuccess,
  recordUserLoginFailure,
} from "../../core/security/userRateLimit";
// FASE 14.7 — AuthCoreService: DB-backed L2 rate limit + unified logging pipeline
import { authCoreService, AUTH_EVENTS } from "../../core/auth/authCore.service";

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
 * CONSOLIDATION (FASE 14.X):
 *  • L1 in-memory rate limit is NO LONGER a blocking gate.
 *    In a multi-instance deployment, each instance has independent L1 state.
 *    A request blocked by instance-A's L1 counter would be incorrectly
 *    rejected by instance-B even though the DB (L2) says it is allowed.
 *    L1 now only records post-failure state (via recordUserLoginFailure) so
 *    the riskScore remains available for BRUTE_FORCE detection. L2 (DB-backed,
 *    authCoreService.checkDbRateLimit) is the sole pre-check gate.
 *
 *  • All console.log("[LOGIN]…") calls removed. Every security-relevant event
 *    is emitted through authCoreService.logAuthEvent() or repo.log(), which
 *    route through the unified pipeline (buffer → alertEngine → console).
 *    Direct console.log was a duplicate channel and produced noise in prod logs.
 */
export class AuthService {
  constructor(private readonly repo: AuthRepository = authRepository) {}

  // ── Login ──────────────────────────────────────────────────────────────
  async attemptLogin(input: LoginInput, ip: string): Promise<LoginOutcome> {
    const normalizedEmail = input.email.toLowerCase().trim();
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

    // BUG-01-FIX: isLocked check runs BEFORE rate limit consumption.
    if (user.isLocked) {
      await this.repo.log({
        action: "LOGIN_BLOCKED",
        description: `Tentativa de acesso a conta bloqueada: ${email}`,
        userId: user.id,
        userEmail: email,
        level: "ERROR",
        ip,
      });
      authCoreService.logAuthEvent(AUTH_EVENTS.LOGIN_BLOCKED_LOCKED, { ip, userId: user.id });
      return {
        kind: "failure",
        status: 423,
        message:
          "Conta temporariamente bloqueada por segurança.\nEntre em contato com o administrador.",
      };
    }

    if (!user.active) {
      await this.repo.log({
        action: "LOGIN_BLOCKED",
        description: `Login bloqueado (usuário inativo): ${email}`,
        userEmail: email,
        level: "WARN",
        ip,
      });
      authCoreService.logAuthEvent(AUTH_EVENTS.LOGIN_BLOCKED_INACTIVE, { ip, userId: user.id });
      return {
        kind: "failure",
        status: 401,
        message: "Usuário inativo. Entre em contato com o administrador.",
      };
    }

    // Rate limits run AFTER lock/active checks (BUG-01 fix) so that locked
    // accounts don't silently exhaust rate limit windows.
    //
    // CONSOLIDATION: L1 (in-memory userRateLimit) is NOT a blocking gate.
    // In a multi-instance deployment each instance has independent L1 state,
    // so an L1 block on instance-A would incorrectly reject a request on
    // instance-B even when the DB (L2) allows it. L1 is still called after
    // a password failure (recordUserLoginFailure) to maintain local risk score
    // for BRUTE_FORCE detection. L2 is the sole pre-check authoritative gate.
    const rateLimitKey = `user:${user.id}`;

    const dbRateCheck = await authCoreService.checkDbRateLimit({
      userId: user.id,
      ip,
      endpoint: "admin_login",
    });
    if (!dbRateCheck.allowed) {
      const retryAfterSec = Math.ceil((dbRateCheck.retryAfterMs ?? 0) / 1000);
      authCoreService.logAuthEvent(AUTH_EVENTS.RATE_LIMITED, {
        ip,
        userId: user.id,
        metadata: { layer: "L2", retryAfterMs: dbRateCheck.retryAfterMs, riskScore: dbRateCheck.riskScore },
      });
      return {
        kind: "failure",
        status: 429,
        message: `Muitas tentativas de login. Aguarde ${retryAfterSec} segundo(s) e tente novamente.`,
      };
    }

    const passwordMatch = await this.verifyAndMaybeUpgradeUserPassword(
      user.id,
      password,
      user.password,
    );

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
      // FASE 14.7.1 — record failure in L1 (memory) and L2 (DB)
      const failResult = recordUserLoginFailure(rateLimitKey);
      authCoreService.recordAttempt({ userId: user.id, ip, endpoint: "admin_login", success: false }).catch(() => {});
      if (failResult.riskScore >= 5 || dbRateCheck.riskScore >= 5) {
        const riskScore = Math.max(failResult.riskScore, dbRateCheck.riskScore);
        authCoreService.logAuthEvent(AUTH_EVENTS.BRUTE_FORCE, {
          ip,
          userId: user.id,
          metadata: { riskScore, cooldownMs: failResult.cooldownMs },
        });
      }
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

    // Success — reset L1/L2 counters, log
    recordUserLoginSuccess(rateLimitKey);
    authCoreService.recordAttempt({ userId: user.id, ip, endpoint: "admin_login", success: true }).catch(() => {});
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
    authCoreService.logAuthEvent(AUTH_EVENTS.LOGIN_SUCCESS, {
      ip,
      userId: refreshed.id,
      metadata: { email: refreshed.email, role: refreshed.role },
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

    const c = company as any;

    // BUG-01-FIX: isLocked check runs BEFORE rate limit consumption.
    if (c.isLocked) {
      await this.repo.log({
        action: "LOGIN_BLOCKED",
        description: `Tentativa de acesso a empresa bloqueada: ${email}`,
        companyId: company.id,
        userEmail: email,
        level: "ERROR",
        ip,
      });
      // BUG-04-FIX: company login was missing logAuthEvent for blocked states.
      authCoreService.logAuthEvent(AUTH_EVENTS.LOGIN_BLOCKED_LOCKED, { ip, companyId: company.id });
      return {
        kind: "failure",
        status: 423,
        message:
          "Conta temporariamente bloqueada por segurança.\nEntre em contato com o administrador.",
      };
    }

    if (!company.active) {
      await this.repo.log({
        action: "LOGIN_BLOCKED",
        description: `Login cliente bloqueado (conta inativa): ${email}`,
        companyId: company.id,
        userEmail: company.email,
        level: "WARN",
        ip,
      });
      // BUG-04-FIX: emit logAuthEvent for inactive block (mirrors admin login).
      authCoreService.logAuthEvent(AUTH_EVENTS.LOGIN_BLOCKED_INACTIVE, { ip, companyId: company.id });
      return {
        kind: "failure",
        status: 401,
        message:
          "Conta desativada. Entre em contato com a equipe VivaFrutaz para reativar seu acesso.",
      };
    }

    // Rate limits run AFTER lock/active checks (BUG-01 fix).
    // CONSOLIDATION: L1 is NOT a blocking gate — see attemptAdminLogin comment.
    const rateLimitKey = `company:${company.id}`;

    // L2 — DB-backed persistent rate limit (authoritative across all instances)
    const dbRateCheck = await authCoreService.checkDbRateLimit({ companyId: company.id, ip });
    if (!dbRateCheck.allowed) {
      const retryAfterSec = Math.ceil((dbRateCheck.retryAfterMs ?? 0) / 1000);
      authCoreService.logAuthEvent(AUTH_EVENTS.RATE_LIMITED, {
        ip,
        companyId: company.id,
        metadata: { layer: "L2", retryAfterMs: dbRateCheck.retryAfterMs, riskScore: dbRateCheck.riskScore },
      });
      return {
        kind: "failure",
        status: 429,
        message: `Muitas tentativas de login. Aguarde ${retryAfterSec} segundo(s) e tente novamente.`,
      };
    }

    const passwordMatch = await this.verifyAndMaybeUpgradeCompanyPassword(
      company.id,
      password,
      company.password,
    );

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
      // FASE 14.6/14.7 — record failure in both L1 (memory) and L2 (DB)
      const failResult = recordUserLoginFailure(rateLimitKey);
      authCoreService.recordAttempt({ companyId: company.id, ip, success: false }).catch(() => {});
      if (failResult.riskScore >= 5 || dbRateCheck.riskScore >= 5) {
        const riskScore = Math.max(failResult.riskScore, dbRateCheck.riskScore);
        authCoreService.logAuthEvent(AUTH_EVENTS.BRUTE_FORCE, {
          ip,
          companyId: company.id,
          metadata: { riskScore, cooldownMs: failResult.cooldownMs },
        });
      }
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

    // FASE 14.5 — block login and force password change for provisioned accounts
    if ((company as any).mustChangePassword) {
      await this.repo.log({
        action: "LOGIN_BLOCKED_TEMP_PASSWORD",
        description: `Login bloqueado: empresa "${company.companyName}" (${email}) deve trocar senha temporária antes de acessar o sistema.`,
        companyId: company.id,
        userEmail: email,
        level: "WARN",
        ip,
      });
      return { kind: "password-change-required", companyId: company.id, email: company.email };
    }

    // Success — reset attempts, record in L1/L2, log
    recordUserLoginSuccess(rateLimitKey);
    authCoreService.recordAttempt({ companyId: company.id, ip, success: true }).catch(() => {});
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
    authCoreService.logAuthEvent(AUTH_EVENTS.LOGIN_SUCCESS, {
      ip,
      companyId: refreshed.id,
      metadata: { email: refreshed.email },
    });
    return { kind: "company-success", company: refreshed };
  }

  // ── Force password change (FASE 14.5) ─────────────────────────────────
  async forcePasswordChange(
    email: string,
    tempPassword: string,
    newPassword: string,
    ip: string,
  ): Promise<{ ok: true; company: import("./auth.types").Company } | { ok: false; status: number; message: string }> {
    const company = await this.repo.getCompanyByEmail(email.toLowerCase().trim());
    if (!company) {
      return { ok: false, status: 404, message: "Empresa não encontrada." };
    }
    if (!(company as any).mustChangePassword) {
      return { ok: false, status: 400, message: "Esta conta não requer troca de senha." };
    }

    const passwordMatch = await this.verifyAndMaybeUpgradeCompanyPassword(
      company.id,
      tempPassword,
      company.password,
    );
    if (!passwordMatch) {
      return { ok: false, status: 401, message: "Senha temporária incorreta." };
    }

    if (newPassword.length < 8) {
      return { ok: false, status: 422, message: "A nova senha deve ter pelo menos 8 caracteres." };
    }

    const updated = await this.repo.updateCompany(company.id, {
      password: newPassword,
      mustChangePassword: false,
      passwordTemporary: false,
    } as any);

    await this.repo.log({
      action: "PASSWORD_CHANGED",
      description: `Senha temporária trocada com sucesso pela empresa "${company.companyName}" no primeiro login.`,
      companyId: company.id,
      userEmail: company.email,
      level: "INFO",
      ip,
    });

    return { ok: true, company: updated };
  }

  // ── Revoke all sessions (FASE 14.6) ────────────────────────────────────
  /**
   * Invalidates ALL active sessions for a company or user by incrementing
   * their tokenVersion in the DB. Every existing session with the old version
   * will be rejected by sessionVersionGuard on the next request, forcing
   * re-authentication. Use this on compromise, suspicious activity, or at
   * operator request.
   */
  async revokeAllSessions(
    kind: "company" | "admin",
    id: number,
    ip: string,
  ): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
    try {
      if (kind === "company") {
        const company = await this.repo.getCompanyById(id);
        if (!company) return { ok: false, status: 404, message: "Empresa não encontrada." };
        const currentVersion = (company as any).tokenVersion ?? 0;
        await this.repo.updateCompany(id, { tokenVersion: currentVersion + 1 } as any);
        await this.repo.log({
          action: "REVOKE_ALL_SESSIONS",
          description: `Todas as sessões da empresa "${(company as any).companyName}" foram revogadas (tokenVersion: ${currentVersion} → ${currentVersion + 1}).`,
          companyId: id,
          level: "WARN",
          ip,
        });
        authCoreService.logAuthEvent(AUTH_EVENTS.REVOKE_ALL_SESSIONS, {
          ip,
          companyId: id,
          metadata: { kind, newTokenVersion: currentVersion + 1 },
        });
      } else {
        const user = await this.repo.getUserById(id);
        if (!user) return { ok: false, status: 404, message: "Usuário não encontrado." };
        const currentVersion = (user as any).tokenVersion ?? 0;
        await this.repo.updateUser(id, { tokenVersion: currentVersion + 1 } as any);
        await this.repo.log({
          action: "REVOKE_ALL_SESSIONS",
          description: `Todas as sessões do usuário "${user.name}" foram revogadas (tokenVersion: ${currentVersion} → ${currentVersion + 1}).`,
          userId: id,
          level: "WARN",
          ip,
        });
        authCoreService.logAuthEvent(AUTH_EVENTS.REVOKE_ALL_SESSIONS, {
          ip,
          userId: id,
          metadata: { kind, newTokenVersion: currentVersion + 1 },
        });
      }
      return { ok: true };
    } catch (err: any) {
      console.error("[auth.service] revokeAllSessions error:", err);
      return { ok: false, status: 500, message: "Erro ao revogar sessões." };
    }
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
