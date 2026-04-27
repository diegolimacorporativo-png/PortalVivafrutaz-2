export const NFE_STATUS = [
  "gerada",
  "assinada",
  "enviada",
  "autorizada",
  "rejeitada",
  "erro",
  "cancelada",
  "denegada",
] as const;

export type NfeStatus = (typeof NFE_STATUS)[number];
