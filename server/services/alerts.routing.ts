/**
 * STEP 9.3F.10 — Roteamento Inteligente de Alertas (Core + Categoria).
 *
 * REGRAS ABSOLUTAS:
 *   - NUNCA modifica `emitAlert`.
 *   - NUNCA modifica `emitAlertSmart`.
 *   - NUNCA modifica `buildInsights`.
 *   - NUNCA cria nova tabela / endpoint / persistência paralela.
 *   - É PURAMENTE de derivação: lê o input, devolve uma lista de roles.
 *
 * Conceito:
 *   - CORE_ROLES: papéis que SEMPRE recebem qualquer alerta.
 *   - CATEGORY_ROUTING: papéis adicionais por categoria de evento, lidos
 *     do `input.context.category` (string opcional).
 *
 * Resultado:
 *   - Lista deduplicada de roles (Set → Array), preservando a ordem CORE→categoria.
 *   - O caller anexa esse array em `context.recipientsRoles` para auditoria
 *     e futura configuração dinâmica de entrega. Não muda o que `emitAlert`
 *     faz hoje (que continua usando os recipients persistidos).
 */

// ── Constantes públicas ──────────────────────────────────────────────────────

/** Papéis-chave que SEMPRE recebem qualquer alerta, independente de categoria. */
export const CORE_ROLES = ["DIRECTOR", "ADMIN", "MASTER", "DEV"] as const;

/**
 * Roteamento por categoria. Chaves devem bater (case-insensitive) com
 * `context.category`. Valores são roles adicionais a notificar — somam ao CORE.
 *
 * Mantido propositalmente curto: futuras categorias entram aqui.
 */
export const CATEGORY_ROUTING: Readonly<Record<string, readonly string[]>> = {
  FINANCE:    ["FINANCE"],
  TECH:       ["DEV", "ADMIN"],
  OPERATIONS: ["ADMIN"],
};

// ── Tipos ────────────────────────────────────────────────────────────────────

/** Forma mínima do input que precisamos ler — propositalmente desacoplada
 *  de `EmitAlertInput` para evitar import circular e manter zero
 *  dependência sobre o módulo de envio. */
export type RoutableInput = {
  context?: Record<string, unknown>;
};

// ── Helpers internos ─────────────────────────────────────────────────────────

function readCategory(input: RoutableInput): string | null {
  const raw = input?.context?.category;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

// ── Função pública ───────────────────────────────────────────────────────────

/**
 * Resolve a lista final de roles que devem receber o alerta.
 *
 * Algoritmo:
 *   1. Inicia com CORE_ROLES.
 *   2. Lê `input.context.category` (string opcional, case-insensitive).
 *   3. Se categoria está em CATEGORY_ROUTING, adiciona suas roles.
 *   4. Remove duplicatas via Set (preserva ordem de inserção).
 *   5. Retorna a lista final como string[].
 *
 * Sem categoria → retorna apenas CORE_ROLES.
 * Categoria desconhecida → retorna apenas CORE_ROLES (não falha).
 */
export function resolveRecipients(input: RoutableInput): string[] {
  const out = new Set<string>(CORE_ROLES);
  const category = readCategory(input);
  if (category && CATEGORY_ROUTING[category]) {
    for (const role of CATEGORY_ROUTING[category]) {
      out.add(role);
    }
  }
  return Array.from(out);
}
