/**
 * normalizeBIResponse — camada única de normalização de dados BI.
 *
 * Elimina a necessidade de ?? [], Array.isArray e safeArray espalhados
 * nas páginas. Toda resposta de API de BI deve passar por aqui antes
 * de ser consumida pelo componente.
 *
 * Uso:
 *   const norm = normalizeBIResponse(queryData);
 *   norm.monthlyRevenue.map(...)  ← sempre array, nunca crash
 */

const toSafeArray = (v: any): any[] => {
  if (Array.isArray(v)) return v;
  if (v?.data && Array.isArray(v.data)) return v.data;
  return [];
};

const toSafeObject = (v: any): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v) ? v : {};

const ARRAY_KEYS = [
  "alerts",
  "monthlyRevenue",
  "topClients",
  "ips",
  "checks",
  "issues",
  "recommendations",
  "products",
  "routes",
  "tables",
  "indexes",
  "endpoints",
  "deliveries",
  "routeCapacity",
  "byDay",
  "ordByDay",
  "inactiveCompanies",
  "topCompanies",
  "topProducts",
  "revenueTimeline",
  "forecast",
  "atRisk",
  "opportunities",
  "deliverySchedule",
  "results",
] as const;

const OBJECT_KEYS = ["summary", "stats", "rowCounts", "database"] as const;

export const normalizeBIResponse = (data: any): Record<string, any> => {
  const base =
    data && typeof data === "object" && !Array.isArray(data) ? data : {};

  const result: Record<string, any> = { ...base };

  for (const key of ARRAY_KEYS) {
    result[key] = toSafeArray(base[key]);
  }

  for (const key of OBJECT_KEYS) {
    result[key] = toSafeObject(base[key]);
  }

  return result;
};
