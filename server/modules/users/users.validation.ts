import { z } from "zod";
import { insertUserSchema } from "@shared/schema";
import { USER_ROLE_VALUES } from "@shared/user-roles";

const actionPermissionsSchema = z.object({
  read: z.boolean().optional(),
  create: z.boolean().optional(),
  edit: z.boolean().optional(),
  delete: z.boolean().optional(),
}).strict();

const actionOverridesSchema = z.object({
  orders: actionPermissionsSchema.optional(),
  logistics: actionPermissionsSchema.optional(),
  quotations: actionPermissionsSchema.optional(),
  "special-orders": actionPermissionsSchema.optional(),
  finance: actionPermissionsSchema.optional(),
}).strict();

const permissionsInputSchema = z.object({
  actionOverridesV1: z.union([actionOverridesSchema, z.null()]).optional(),
}).strict().nullable();

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
// required; `active` defaults to true. Existing permissions JSONB accepts only
// the namespaced action overrides; opaque legacy fields remain server-owned.
export const createUserSchema = insertUserSchema.omit({ permissions: true }).extend({
  name: z.string().min(1, "Nome é obrigatório"),
  email: z.string().email("Email inválido"),
  password: z.string().min(12, "A senha deve ter pelo menos 12 caracteres"),
  role: z.enum(USER_ROLE_VALUES, { message: "Perfil de acesso inválido" }),
  active: z.boolean().optional().default(true),
  permissions: permissionsInputSchema.optional(),
});

// ── Update ──────────────────────────────────────────────────────────────
// Partial update. The legacy route deliberately ignores `password` when its
// value is the masked placeholder "***" — we preserve that behaviour in the
// service layer (not here) so validation stays pure.
export const updateUserSchema = insertUserSchema.omit({ permissions: true }).partial().extend({
  // A role may be omitted on an unrelated edit, but an explicitly supplied
  // role can never be blank. This keeps the driver profile selection required
  // instead of allowing an account to lose its access profile via the API.
  role: z.enum(USER_ROLE_VALUES, { message: "Perfil de acesso inválido" }).optional(),
  // null restores the role's default tab visibility; [] retains legacy defaults.
  tabPermissions: z.union([z.array(z.string()), z.null()]).optional(),
  permissions: permissionsInputSchema.optional(),
});

// ── Change password (privileged) ────────────────────────────────────────
// Used only by PUT /api/users/:id/password.
export const changePasswordSchema = z.object({
  newPassword: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length >= 12, { message: "A senha deve ter pelo menos 12 caracteres" }),
});

// ── Path params ─────────────────────────────────────────────────────────
export const idParamSchema = z.object({
  id: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .refine((n) => Number.isInteger(n) && n > 0, { message: "ID inválido" }),
});
