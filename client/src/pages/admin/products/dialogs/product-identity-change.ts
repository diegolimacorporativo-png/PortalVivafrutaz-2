type ProductIdentity = {
  name: string;
  productCode: string | null | undefined;
};

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function normalizeCode(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** Validate uniqueness only for a new product or when its identity changes. */
export function shouldCheckProductIdentity(
  current: ProductIdentity,
  original: ProductIdentity | null,
): boolean {
  if (!original) return true;
  return normalizeName(current.name) !== normalizeName(original.name)
    || normalizeCode(current.productCode) !== normalizeCode(original.productCode);
}

/** Reusing the unchanged ID while editing must not be treated as a collision. */
export function shouldCheckProductCode(
  currentCode: string | null | undefined,
  originalCode: string | null | undefined,
): boolean {
  return normalizeCode(currentCode) !== normalizeCode(originalCode);
}

/** Prefer the persisted ID; only assign the server-generated next ID if absent. */
export function resolveProductCodeForEdit(
  persistedCode: string | null | undefined,
  generatedCode: string | null | undefined,
): string {
  return normalizeCode(persistedCode) || normalizeCode(generatedCode);
}
