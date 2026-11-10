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
