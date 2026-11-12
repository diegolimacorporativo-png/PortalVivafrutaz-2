export type ProductionClassification = "IN_NATURA" | "PROCESSADOS";

function normalizeCategory(value: string | null | undefined): string {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Approved default: categories explicitly marked as processed go to Processados;
 * every other product defaults to In Natura unless it already has an explicit class. */
export function resolveProductionClassification(
  category: string | null | undefined,
  explicit: string | null | undefined,
): ProductionClassification {
  const normalized = normalizeCategory(category);
  if (/\bprocessad[oa]s?\b/.test(normalized)) return "PROCESSADOS";
  if (/\bin natura\b/.test(normalized)) return "IN_NATURA";
  if (explicit === "IN_NATURA" || explicit === "PROCESSADOS") return explicit;
  return "IN_NATURA";
}
