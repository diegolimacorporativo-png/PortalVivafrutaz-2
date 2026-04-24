import { z } from "zod";
import { insertUserSchema } from "@shared/schema";

/**
 * Validation layer for the users module.
 *
 * Architecture decision: extend the auto-generated Drizzle insert schema
 * (single source of truth) and tighten where the HTTP layer needs stricter
 * rules than the database. Controllers never touch Zod directly — they
 * receive parsed, typed data via the validateRequest middleware.
 */

// ── Create ──────────────────────────────────────────────────────────────
// Mirrors the legacy POST /api/users contract: name, email, password, role
// required; `active` defaults to true. Other columns (permissions,
// tabPermissions, security flags) are accepted but optional.
export const createUserSchema = insertUserSchema.extend({
  name: z.string().min(1, "Nome é obrigatório"),
  email: z.string().email("Email inválido"),
  password: z.string().min(3, "Senha muito curta"),
  role: z.string().min(1, "Perfil é obrigatório"),
  active: z.boolean().optional().default(true),
});

// ── Update ──────────────────────────────────────────────────────────────
// Partial update. The legacy route deliberately ignores `password` when its
// value is the masked placeholder "***" — we preserve that behaviour in the
// service layer (not here) so validation stays pure.
export const updateUserSchema = insertUserSchema.partial().extend({
  // tabPermissions intentionally allows `null` to "reset to no restriction".
  tabPermissions: z.union([z.array(z.string()), z.null()]).optional(),
});

// ── Change password (privileged) ────────────────────────────────────────
// Used only by PUT /api/users/:id/password. Length floor mirrors legacy.
export const changePasswordSchema = z.object({
  newPassword: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length >= 3, { message: "Senha inválida" }),
});

// ── Path params ─────────────────────────────────────────────────────────
export const idParamSchema = z.object({
  id: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .refine((n) => Number.isInteger(n) && n > 0, { message: "ID inválido" }),
});
