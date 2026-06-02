import type { Product } from "@shared/schema";
import type { CategorySelection, PricingMode } from "./types";

export const UNITS = [
  { value: "kg", label: "Quilograma (kg)" },
  { value: "caixa", label: "Caixa" },
  { value: "unidade", label: "Unidade" },
  { value: "pallet", label: "Pallet" },
  { value: "bandeja", label: "Bandeja" },
  { value: "pote", label: "Pote" },
  { value: "pacote", label: "Pacote" },
  { value: "display", label: "Display" },
  { value: "porcao", label: "Porção" },
];

export const DAYS = ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira"];

export const emptyForm = {
  name: "",
  unit: "kg",
  active: true,
  basePrice: "",
  isIndustrialized: false,
  isSeasonal: false,
  outOfSeason: false,
  observation: "",
  curiosity: "",
  availableDays: [] as string[],
  ncm: "",
  cfop: "",
  cst: "",
  commercialUnit: "",
  productCode: "",
  importado: false,
  categorySelections: [] as CategorySelection[],
  pricingMode: "category" as PricingMode,
  imageUrl: null as string | null,
};

export type ProductForm = typeof emptyForm;

export function productToForm(p: Product): ProductForm {
  const persistedMode = (p as any).pricingMode as PricingMode | undefined;
  const inferredMode: PricingMode =
    persistedMode === "base" || persistedMode === "category"
      ? persistedMode
      : p.basePrice != null
        ? "base"
        : "category";

  return {
    name: p.name,
    unit: p.unit,
    active: p.active,
    basePrice: p.basePrice != null ? String(p.basePrice) : "",
    isIndustrialized: p.isIndustrialized ?? false,
    isSeasonal: p.isSeasonal ?? false,
    outOfSeason: (p as any).outOfSeason ?? false,
    observation: (p as any).observation || "",
    curiosity: (p as any).curiosity || "",
    availableDays: Array.isArray((p as any).availableDays) ? (p as any).availableDays as string[] : [],
    ncm: (p as any).ncm || "",
    cfop: (p as any).cfop || "",
    cst: (p as any).cst || "",
    commercialUnit: (p as any).commercialUnit || "",
    productCode: (p as any).productCode || "",
    importado: (p as any).importado === true,
    categorySelections: [],
    pricingMode: inferredMode,
    imageUrl: (p as any).imageUrl ?? null,
  };
}
