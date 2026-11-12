export type ProductionClassification = "IN_NATURA" | "PROCESSADOS";

function normalizeCategory(value: string | null | undefined): string {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Approved rule: processed fruit and healthy snack catalog sections go to
 * Processados; all other sections default to In Natura unless explicitly set. */
export function resolveProductionClassification(
  category: string | null | undefined,
  explicit: string | null | undefined,
): ProductionClassification {
  const normalized = normalizeCategory(category);
  if (/\bin natura\b/.test(normalized)) return "IN_NATURA";
  if (
    /\bprocessad[oa]s?\b/.test(normalized) ||
    /\bsnacks? saudaveis\b/.test(normalized)
  ) return "PROCESSADOS";
  if (explicit === "IN_NATURA" || explicit === "PROCESSADOS") return explicit;
  return "IN_NATURA";
}
