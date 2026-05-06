import bcrypt from "bcryptjs";
import { auditSecurity } from "../../utils/auditLogger";
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

// ── Auth Decision Delegate ─────────────────────────────────────────────────
/**
 * Adapter interface that decouples the shared auth decision flow (_runAuthFlow)
 * from entity-specific data and operations (admin users vs company accounts).
 *
 * Constructed by attemptAdminLogin / attemptCompanyLogin via closure — captures
 * all entity-specific state and callbacks. _runAuthFlow never references the
 * `users` or `companies` tables directly, ensuring the two paths share one
 * identical decision order.
 */
interface AuthDelegate {
  /** Discriminator — routes logAuthEvent to userId vs companyId. */
  readonly kind: "admin" | "company";
  /** Entity DB primary key. */
  readonly id: number;
  /** Normalised email (for log descriptions). */
  readonly email: string;
  /** L1 key — "user:N" or "company:N". */
  readonly rateLimitKey: string;
  /** L2 DB rate-limit params — forwarded to checkDbRateLimit / recordAttempt. */
  readonly dbRateLimitParams: {
    userId?: number;
    companyId?: number;
    ip: string;
    endpoint?: string;
  };
  /** Pre-loaded from entity row — avoids extra DB round-trips in shared flow. */
  readonly isLocked: boolean;
  readonly isActive: boolean;
  readonly loginAttempts: number;
  /** Entity-specific bcrypt comparison (admin may auto-upgrade plaintext). */
  verifyPassword(submitted: string): Promise<boolean>;
  /**
   * Write a repo.log entry with the correct entity ID (userId vs companyId).
   * Called for locked / inactive events in the shared flow.
   */
  logEvent(action: string, description: string, level: "INFO" | "WARN" | "ERROR"): Promise<void>;
  /**
   * Persist the new failure count (and optionally isLocked) to the entity row,
   * then write the LOGIN_FAILED repo.log entry.
   * Called only on wrong password — after L1/L2 recording in _runAuthFlow.
   */
  updateAttempts(newAttempts: number, willLock: boolean): Promise<void>;
  /** Send lockout notification to admin-role users. */
  notifyLockout(): Promise<void>;
  /**
   * Called when credentials are confirmed valid.
   * Owns: mustChangePassword check (company only), L1/L2 counter reset,
   * entity row update, repo.log(LOGIN), logAuthEvent(LOGIN_SUCCESS).
   * Returns the specific success (or password-change-required) outcome.
   *
   * NOTE: L1/L2 counter reset is done inside onSuccess (not in _runAuthFlow)
   * so that company's mustChangePassword can short-circuit before counters reset.
   */
  onSuccess(): Promise<LoginOutcome>;
}

/**
 * AuthService — business rules of the auth module.
 *
 * Architecture: services own behaviour, never touch req/res. Auth has many
 * legitimate failure modes so the service returns a discriminated LoginOutcome
 * instead of throwing, keeping every legacy status code and Portuguese message
 * intact while the controller stays a thin HTTP adapter.
 *
 * CONSOLIDAÇÃO FINAL (FASE 14.X):
 *
 *  • SINGLE AUTH DECISION FLOW: _runAuthFlow() is the only place where
 *    blocking decisions are made. Both admin and company login share this
 *    identical six-step order:
 *      1. isLocked            (pre-loaded — free, no extra DB I/O)
 *      2. isActive            (pre-loaded — free)
 *      3. L2 DB rate limit    (auth_attempts, multi-instance authoritative gate)
 *      4. Credential verify   (bcrypt — entity-specific via delegate)
 *      5. Failure path        (updateAttempts + L1 record + L2 record + BRUTE_FORCE)
 *      6. Success path        (delegate.onSuccess — L1/L2 reset + log + outcome)
 *
 *  • L1 IS NOT A GATE: In a multi-instance deployment each instance has
 *    independent in-memory L1 state. An L1 block on instance-A would
 *    incorrectly reject a request on instance-B even when the DB allows it.
 *    L1 (recordUserLoginFailure) is called POST-failure only to maintain a
 *    local risk score for BRUTE_FORCE detection. L2 (checkDbRateLimit) is the
 *    sole pre-check blocking gate.
 *
 *  • SINGLE LOG PIPELINE: every security-relevant event flows through
 *    authCoreService.logAuthEvent() or repo.log(). No console.log in login
 *    paths — that was a duplicate channel producing noise in prod logs.
 */
export class AuthService {
  constructor(private readonly repo: AuthRepository = authRepository) {}

  // ── Login entry point ──────────────────────────────────────────────────
  async attemptLogin(input: LoginInput, ip: string): Promise<LoginOutcome> {
    const normalizedEmail = input.email.toLowerCase().trim();
    return input.type === "admin"
      ? this.attemptAdminLogin(normalizedEmail, input.password, ip)
      : this.attemptCompanyLogin(normalizedEmail, input.password, ip);
  }

  // ── Legacy-compatible lookups ───────────────────────────────────────────
  /**
   * Try exact email match first. If not found and the input has no "@"
   * (i.e. it looks like a bare username), retry with the legacy
   * @vivafrutaz.com suffix so users who saved "empresa01" as their
   * credential continue to work even after the domain was removed from
   * the login form.
   */
  private async lookupUserFallback(input: string) {
    const user = await this.repo.getUserByEmail(input);
    if (user || input.includes("@")) return user;
    return this.repo.getUserByEmail(input + "@vivafrutaz.com");
  }

  private async lookupCompanyFallback(input: string) {
    const company = await this.repo.getCompanyByEmail(input);
    if (company || input.includes("@")) return company;
    return this.repo.getCompanyByEmail(input + "@vivafrutaz.com");
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

  // ── Forgot password (token-based self-service) ─────────────────────────
  async requestPasswordReset(email: string): Promise<ForgotPasswordOutcome> {
    const normalised = email.toLowerCase().trim();

    // Look up in both tables — admin users take precedence.
    // lookupUserFallback / lookupCompanyFallback transparently retry with
    // @vivafrutaz.com when the input is a bare username (no "@").
    const user = await this.lookupUserFallback(normalised);
    const company = !user ? await this.lookupCompanyFallback(normalised) : null;

    // SECURITY: always return the same 200 message — never reveal email existence
    const SAFE_MESSAGE =
      "Se o email estiver cadastrado, você receberá um link de recuperação em breve.";

    if (!user && !company) {
      return { found: false, message: SAFE_MESSAGE };
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.repo.createResetToken({
      userId: user?.id,
      companyId: company?.id,
      token,
      expiresAt,
    });

    // DEV MODE — log reset link to console instead of sending email
    if (process.env.NODE_ENV === "development") {
      const baseUrl = process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : "http://localhost:5000";
      console.log("\n========================================");
      console.log("[RESET_LINK_DEV] PASSWORD RESET LINK");
      console.log(`    ${baseUrl}/reset-password?token=${token}`);
      console.log(`    Account: ${normalised}`);
      console.log(`    Expires: ${expiresAt.toISOString()}`);
      console.log("========================================\n");
    }

    // Keep creating the manual request for companies (legacy admin-reviewed flow)
    let requestId: number | undefined;
    if (company) {
      const req = await this.repo.createPasswordResetRequest(company.id);
      requestId = req.id;
    }

    return { found: true, message: SAFE_MESSAGE, requestId };
  }

  // ── Reset password (token-based self-service) ───────────────────────────
  async resetPassword(
    token: string,
    novaSenha: string,
    ip: string,
  ): Promise<import("./auth.types").ResetPasswordOutcome> {
    const record = await this.repo.getValidResetToken(token);
    if (!record) {
      return {
        ok: false,
        status: 400,
        message: "Token inválido ou expirado. Solicite um novo link de recuperação.",
      };
    }

    if (novaSenha.length < 8) {
      return {
        ok: false,
        status: 422,
        message: "A nova senha deve ter pelo menos 8 caracteres.",
      };
    }

    // Update the correct entity
    if (record.userId) {
      await this.repo.updateUser(record.userId, {
        password: novaSenha,
        loginAttempts: 0,
        isLocked: false,
      });
      const user = await this.repo.getUserById(record.userId);
      await this.repo.log({
        action: "PASSWORD_RESET",
        description: `Senha redefinida via token para usuário: ${user?.email ?? record.userId}`,
        userId: record.userId,
        userEmail: user?.email,
        level: "INFO",
        ip,
      });
    } else if (record.companyId) {
      await this.repo.updateCompany(record.companyId, {
        password: novaSenha,
        loginAttempts: 0,
        isLocked: false,
      } as any);
      const company = await this.repo.getCompanyById(record.companyId);
      await this.repo.log({
        action: "PASSWORD_RESET",
        description: `Senha redefinida via token para empresa: ${company?.email ?? record.companyId}`,
        companyId: record.companyId,
        userEmail: company?.email,
        level: "INFO",
        ip,
      });
    }

    // Token is single-use — delete immediately after successful reset
    await this.repo.deleteResetToken(token);

    return { ok: true, message: "Senha redefinida com sucesso. Você já pode fazer login." };
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

  // ── UNIFIED AUTH DECISION FLOW ─────────────────────────────────────────
  /**
   * Single point of truth for all auth blocking decisions.
   * Shared identically between admin and company login via AuthDelegate.
   *
   * Step order:
   *   1. isLocked          → 423  (pre-loaded; no additional DB I/O)
   *   2. isActive          → 401  (pre-loaded; no additional DB I/O)
   *   3. L2 DB rate limit  → 429  (auth_attempts; multi-instance safe)
   *   4. Password verify         (bcrypt via delegate)
   *   5a. Wrong password   → delegate.updateAttempts + L1 + L2 + BRUTE_FORCE
   *   5b. Credentials OK   → delegate.onSuccess()
   */
  private async _runAuthFlow(
    delegate: AuthDelegate,
    submittedPassword: string,
    ip: string,
  ): Promise<LoginOutcome> {
    const entityId =
      delegate.kind === "admin"
        ? { userId: delegate.id }
        : { companyId: delegate.id };

    // ── 1. Account state: locked ───────────────────────────────────────
    if (delegate.isLocked) {
      await delegate.logEvent(
        "LOGIN_BLOCKED",
        `Tentativa de acesso a conta bloqueada: ${delegate.email}`,
        "ERROR",
      );
      authCoreService.logAuthEvent(AUTH_EVENTS.LOGIN_BLOCKED_LOCKED, { ip, ...entityId });
      return {
        kind: "failure",
        status: 423,
        message: "Conta temporariamente bloqueada por segurança.\nEntre em contato com o administrador.",
      };
    }

    // ── 2. Account state: inactive ─────────────────────────────────────
    if (!delegate.isActive) {
      await delegate.logEvent(
        "LOGIN_BLOCKED",
        `Login bloqueado (conta inativa): ${delegate.email}`,
        "WARN",
      );
      authCoreService.logAuthEvent(AUTH_EVENTS.LOGIN_BLOCKED_INACTIVE, { ip, ...entityId });
      return {
        kind: "failure",
        status: 401,
        message:
          delegate.kind === "admin"
            ? "Usuário inativo. Entre em contato com o administrador."
            : "Conta desativada. Entre em contato com a equipe VivaFrutaz para reativar seu acesso.",
      };
    }

    // ── 3. L2 DB rate limit — SOLE AUTHORITATIVE GATE ─────────────────
    // Runs after state checks (BUG-01 fix): locked / inactive accounts do not
    // consume rate-limit windows; the state check is free (pre-loaded data).
    const dbRateCheck = await authCoreService.checkDbRateLimit(delegate.dbRateLimitParams);
    if (!dbRateCheck.allowed) {
      const retryAfterSec = Math.ceil((dbRateCheck.retryAfterMs ?? 0) / 1000);
      authCoreService.logAuthEvent(AUTH_EVENTS.RATE_LIMITED, {
        ip,
        ...entityId,
        metadata: { layer: "L2", retryAfterMs: dbRateCheck.retryAfterMs, riskScore: dbRateCheck.riskScore },
      });
      return {
        kind: "failure",
        status: 429,
        message: `Muitas tentativas de login. Aguarde ${retryAfterSec} segundo(s) e tente novamente.`,
      };
    }

    // ── 4. Credential validation ───────────────────────────────────────
    const passwordMatch = await delegate.verifyPassword(submittedPassword);

    // ── 5a. Wrong password ─────────────────────────────────────────────
    if (!passwordMatch) {
      const newAttempts = delegate.loginAttempts + 1;
      const willLock = newAttempts >= MAX_ATTEMPTS;

      // Entity-specific: update DB row + write LOGIN_FAILED log entry
      await delegate.updateAttempts(newAttempts, willLock);

      // L1 — post-failure state for local risk-score tracking (not a gate)
      const failResult = recordUserLoginFailure(delegate.rateLimitKey);

      // L2 — persist to auth_attempts for cross-instance rate-limit accuracy
      authCoreService
        .recordAttempt({ ...delegate.dbRateLimitParams, success: false })
        .catch(() => {});

      // BRUTE_FORCE signal — triggers alert when risk is elevated
      if (failResult.riskScore >= 5 || dbRateCheck.riskScore >= 5) {
        const riskScore = Math.max(failResult.riskScore, dbRateCheck.riskScore);
        authCoreService.logAuthEvent(AUTH_EVENTS.BRUTE_FORCE, {
          ip,
          ...entityId,
          metadata: { riskScore, cooldownMs: failResult.cooldownMs },
        });
      }

      if (willLock) {
        await delegate.notifyLockout();
        return {
          kind: "failure",
          status: 423,
          message: "Conta temporariamente bloqueada por segurança.\nEntre em contato com o administrador.",
        };
      }

      return {
        kind: "failure",
        status: 401,
        message: `Usuário ou senha incorretos. (${newAttempts}/${MAX_ATTEMPTS} tentativas)`,
      };
    }

    // ── 5b. Credentials OK → delegate owns all success side-effects ────
    // onSuccess is responsible for: mustChangePassword check (company only),
    // L1/L2 counter reset, entity row update, repo.log(LOGIN),
    // logAuthEvent(LOGIN_SUCCESS), and returning the final outcome.
    return delegate.onSuccess();
  }

  // ── Internal: admin login ──────────────────────────────────────────────
  /**
   * Thin adapter: loads the user entity, builds an AuthDelegate, then
   * delegates all decision logic to _runAuthFlow.
   */
  private async attemptAdminLogin(
    email: string,
    password: string,
    ip: string,
  ): Promise<LoginOutcome> {
    const user = await this.lookupUserFallback(email);
    if (!user) {
      await this.repo.log({
        action: "LOGIN_FAILED",
        description: `Tentativa de login falhou (usuário não encontrado): ${email}`,
        userEmail: email,
        level: "WARN",
        ip,
      });
      auditSecurity("LOGIN_FAILURE", { userId: undefined, role: undefined, ip, details: { email, reason: "user_not_found" } });
      return { kind: "failure", status: 401, message: "Usuário ou senha incorretos." };
    }

    return this._runAuthFlow(
      {
        kind: "admin",
        id: user.id,
        email,
        rateLimitKey: `user:${user.id}`,
        dbRateLimitParams: { userId: user.id, ip, endpoint: "admin_login" },
        isLocked: user.isLocked,
        isActive: user.active,
        loginAttempts: user.loginAttempts || 0,

        verifyPassword: (submitted) =>
          this.verifyAndMaybeUpgradeUserPassword(user.id, submitted, user.password),

        logEvent: (action, description, level) =>
          this.repo.log({ action, description, userId: user.id, userEmail: email, level, ip }),

        updateAttempts: async (newAttempts, willLock) => {
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
        },

        notifyLockout: () => this.notifyAdminsOfLockout(email, "usuário interno", ip),

        onSuccess: async () => {
          // FASE SENHA TEMPORÁRIA — gate for admin users (mirrors company flow)
          if ((user as any).mustChangePassword) {
            await this.repo.log({
              action: "LOGIN_BLOCKED_TEMP_PASSWORD",
              description: `Login bloqueado: usuário interno "${user.email}" (${user.role}) deve trocar senha temporária antes de acessar o sistema.`,
              userId: user.id,
              userEmail: email,
              level: "WARN",
              ip,
            });
            return { kind: "password-change-required", userId: user.id, email: user.email };
          }

          // L1 reset + L2 record — done inside onSuccess so admin and company
          // can independently decide when to commit these side-effects.
          recordUserLoginSuccess(`user:${user.id}`);
          authCoreService
            .recordAttempt({ userId: user.id, ip, endpoint: "admin_login", success: true })
            .catch(() => {});

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
          auditSecurity("LOGIN_SUCCESS", { userId: refreshed.id, role: refreshed.role, ip, details: { email: refreshed.email } });
          return { kind: "admin-success", user: refreshed };
        },
      },
      password,
      ip,
    );
  }

  // ── Internal: company login ────────────────────────────────────────────
  /**
   * Thin adapter: checks maintenance mode, loads company entity, builds an
   * AuthDelegate, then delegates all decision logic to _runAuthFlow.
   * Company-specific concerns (maintenance mode, mustChangePassword) are
   * handled in the pre-check and inside onSuccess respectively.
   */
  private async attemptCompanyLogin(
    email: string,
    password: string,
    ip: string,
  ): Promise<LoginOutcome> {
    // Maintenance mode blocks client logins; staff logins are unaffected.
    if (await this.repo.getMaintenanceMode()) {
      return { kind: "failure", status: 503, message: "MAINTENANCE_MODE" };
    }

    const company = await this.lookupCompanyFallback(email);
    if (!company) {
      await this.repo.log({
        action: "LOGIN_FAILED",
        description: `Tentativa de login cliente falhou (usuário não encontrado): ${email}`,
        userEmail: email,
        level: "WARN",
        ip,
      });
      auditSecurity("LOGIN_FAILURE", { userId: undefined, role: "CLIENT", ip, details: { email, reason: "company_not_found" } });
      return {
        kind: "failure",
        status: 401,
        message: "Usuário não encontrado. Verifique o usuário e tente novamente.",
      };
    }

    const c = company as any;

    return this._runAuthFlow(
      {
        kind: "company",
        id: company.id,
        email,
        rateLimitKey: `company:${company.id}`,
        dbRateLimitParams: { companyId: company.id, ip },
        isLocked: c.isLocked,
        isActive: company.active,
        loginAttempts: c.loginAttempts || 0,

        verifyPassword: (submitted) =>
          this.verifyAndMaybeUpgradeCompanyPassword(company.id, submitted, company.password),

        logEvent: (action, description, level) =>
          this.repo.log({ action, description, companyId: company.id, userEmail: email, level, ip }),

        updateAttempts: async (newAttempts, willLock) => {
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
        },

        notifyLockout: () => this.notifyAdminsOfLockout(email, "empresa cliente", ip),

        onSuccess: async () => {
          // FASE 14.5 — mustChangePassword check runs BEFORE L1/L2 counter reset.
          // The password was verified correct, but we don't grant a full session
          // until the temporary password is replaced.
          if (c.mustChangePassword) {
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

          // L1 reset + L2 record — only after mustChangePassword gate is cleared
          recordUserLoginSuccess(`company:${company.id}`);
          authCoreService
            .recordAttempt({ companyId: company.id, ip, success: true })
            .catch(() => {});

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
          auditSecurity("LOGIN_SUCCESS", { userId: undefined, empresaId: refreshed.id, role: "CLIENT", ip, details: { email: refreshed.email } });
          return { kind: "company-success", company: refreshed };
        },
      },
      password,
      ip,
    );
  }

  // ── Force password change (FASE 14.5) ─────────────────────────────────
  async forcePasswordChange(
    email: string,
    tempPassword: string,
    newPassword: string,
    ip: string,
  ): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
    const normalizedEmail = email.toLowerCase().trim();

    if (newPassword.length < 8) {
      return { ok: false, status: 422, message: "A nova senha deve ter pelo menos 8 caracteres." };
    }

    // ── 1. Try company account first ────────────────────────────────────
    const company = await this.repo.getCompanyByEmail(normalizedEmail);
    if (company) {
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

      await this.repo.updateCompany(company.id, {
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

      return { ok: true };
    }

    // ── 2. Try admin user ────────────────────────────────────────────────
    const user = await this.repo.getUserByEmail(normalizedEmail);
    if (!user) {
      return { ok: false, status: 404, message: "Conta não encontrada." };
    }
    if (!(user as any).mustChangePassword) {
      return { ok: false, status: 400, message: "Esta conta não requer troca de senha." };
    }

    const passwordMatch = await this.verifyAndMaybeUpgradeUserPassword(
      user.id,
      tempPassword,
      user.password,
    );
    if (!passwordMatch) {
      return { ok: false, status: 401, message: "Senha temporária incorreta." };
    }

    await this.repo.updateUser(user.id, {
      password: newPassword,
      mustChangePassword: false,
      passwordTemporary: false,
    } as any);

    await this.repo.log({
      action: "PASSWORD_CHANGED",
      description: `Senha temporária trocada com sucesso pelo usuário interno "${user.email}" (${user.role}).`,
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      level: "INFO",
      ip,
    });

    return { ok: true };
  }

  // ── Voluntary password change by authenticated user (FASE CONFIGURAÇÕES) ─
  async changePasswordSelf(
    userId: number,
    currentPassword: string,
    newPassword: string,
    ip: string,
  ): Promise<{ ok: true } | { ok: false; status: number; error: string; message: string }> {
    const user = await this.repo.getUser(userId);
    if (!user) {
      return { ok: false, status: 404, error: "USER_NOT_FOUND", message: "Usuário não encontrado." };
    }

    if (newPassword.length < 8) {
      return { ok: false, status: 422, error: "PASSWORD_TOO_SHORT", message: "A nova senha deve ter pelo menos 8 caracteres." };
    }

    const currentMatch = await this.verifyAndMaybeUpgradeUserPassword(userId, currentPassword, user.password);
    if (!currentMatch) {
      return { ok: false, status: 400, error: "INVALID_CURRENT_PASSWORD", message: "Senha atual incorreta." };
    }

    const isSame = await bcrypt.compare(newPassword, user.password);
    if (isSame) {
      return { ok: false, status: 422, error: "SAME_PASSWORD", message: "A nova senha não pode ser igual à senha atual." };
    }

    await this.repo.updateUser(userId, {
      password: newPassword,
      mustChangePassword: false,
      passwordTemporary: false,
    } as any);

    console.warn("[PASSWORD_CHANGED]", { userId, role: user.role });

    await this.repo.log({
      action: "PASSWORD_CHANGED",
      description: `Usuário "${user.email}" (${user.role}) alterou a própria senha via Configurações.`,
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      level: "INFO",
      ip,
    });

    return { ok: true };
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
    } catch {
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
