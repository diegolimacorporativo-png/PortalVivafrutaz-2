import type { DeliveryConfig, CompanyForm } from "./types";
import {
  User, Settings, CreditCard, Receipt, Package, Clock, MapPin,
} from "lucide-react";
import type { Company } from "@shared/schema";

export const DAYS_OPTIONS = [
  "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira",
];

export const WEEK_DAYS = [
  "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira",
];

export const TABS = [
  { key: "basico" as const,     label: "Dados Básicos",              icon: User     },
  { key: "config" as const,     label: "Configurações",              icon: Settings },
  { key: "financeiro" as const, label: "Financeiro",                 icon: CreditCard },
  { key: "fiscal" as const,     label: "Dados Fiscais",              icon: Receipt  },
  { key: "contrato" as const,   label: "Escopo Contratual",          icon: Package  },
  { key: "entrega" as const,    label: "Configuração de Entrega",    icon: Clock    },
  { key: "enderecos" as const,  label: "Endereços",                  icon: MapPin   },
];

export const DEFAULT_DELIVERY_CONFIG: DeliveryConfig = {
  "Segunda-feira": { enabled: false, startTime: "09:00", endTime: "10:00" },
  "Terça-feira":   { enabled: false, startTime: "09:00", endTime: "10:00" },
  "Quarta-feira":  { enabled: false, startTime: "09:00", endTime: "10:00" },
  "Quinta-feira":  { enabled: false, startTime: "09:00", endTime: "10:00" },
  "Sexta-feira":   { enabled: false, startTime: "09:00", endTime: "10:00" },
};

export function parseDeliveryConfig(json: string | null | undefined): DeliveryConfig {
  try {
    return json ? { ...DEFAULT_DELIVERY_CONFIG, ...JSON.parse(json) } : { ...DEFAULT_DELIVERY_CONFIG };
  } catch {
    return { ...DEFAULT_DELIVERY_CONFIG };
  }
}

export const emptyForm: CompanyForm = {
  companyName: "", contactName: "", email: "", password: "", notificationEmail: "",
  phone: "", cnpj: "", addressStreet: "", addressNumber: "", addressNeighborhood: "",
  addressCity: "", addressZip: "", latitude: "", longitude: "", priceGroupId: "",
  allowedOrderDays: [], active: true, clientType: "mensal", contractModel: "",
  minWeeklyBilling: "", deliveryTime: "", adminFee: "0", billingTerm: "", billingType: "",
  billingFormat: "", paymentDates: "", financialNotes: "", deliveryConfigJson: null,
  autoCalcCost: true, autoPriceFromCatalog: false, manualAvgCost: "", contractStartDate: "",
  contractEndDate: "", contractVigencia: "", stateRegistration: "", addressState: "",
  addressIbge: "", regimeTributario: "", defaultCfop: "",
};

export const emptyAddr = {
  label: "Sede", logradouro: "", numero: "", complemento: "",
  bairro: "", cidade: "", estado: "", cep: "", isPrimary: false,
};

export function companyToForm(c: Company): CompanyForm {
  const ca = c as any;
  return {
    companyName: c.companyName,
    contactName: c.contactName,
    email: c.email,
    password: "",
    notificationEmail: ca.notificationEmail || "",
    phone: c.phone || "",
    cnpj: ca.cnpj || "",
    addressStreet: ca.addressStreet || "",
    addressNumber: ca.addressNumber || "",
    addressNeighborhood: ca.addressNeighborhood || "",
    addressCity: ca.addressCity || "",
    addressZip: ca.addressZip || "",
    latitude: ca.latitude ? String(ca.latitude) : "",
    longitude: ca.longitude ? String(ca.longitude) : "",
    priceGroupId: c.priceGroupId ? String(c.priceGroupId) : "",
    allowedOrderDays: Array.isArray(c.allowedOrderDays)
      ? (c.allowedOrderDays as any[]).map(String) : [],
    active: c.active,
    clientType: c.clientType || "mensal",
    contractModel: ca.contractModel || "",
    minWeeklyBilling: c.minWeeklyBilling ? String(c.minWeeklyBilling) : "",
    deliveryTime: c.deliveryTime || "",
    adminFee: c.adminFee ? String(c.adminFee) : "0",
    billingTerm: c.billingTerm || "",
    billingType: c.billingType || "",
    billingFormat: c.billingFormat || "",
    paymentDates: c.paymentDates || "",
    financialNotes: c.financialNotes || "",
    deliveryConfigJson: parseDeliveryConfig((c as any).deliveryConfigJson),
    autoCalcCost: ca.autoCalcCost !== false,
    autoPriceFromCatalog: !!ca.autoPriceFromCatalog,
    manualAvgCost: ca.manualAvgCost ? String(ca.manualAvgCost) : "",
    contractStartDate: ca.contractStartDate || "",
    contractEndDate: ca.contractEndDate || "",
    contractVigencia: ca.contractVigencia || "",
    stateRegistration: ca.stateRegistration || "",
    addressState: ca.addressState || "",
    addressIbge: ca.addressIbge || "",
    regimeTributario: ca.regimeTributario || "",
    defaultCfop: ca.defaultCfop || "",
  };
}

export const getBillingLabel = (type: string | null) => {
  const map: Record<string, string> = { boleto: "Boleto", deposito: "Depósito", pix: "PIX" };
  return type ? (map[type] || type) : "—";
};

export const getBillingFormatLabel = (f: string | null) => {
  const map: Record<string, string> = { diario: "Diário", semanal: "Semanal", mensal: "Mensal" };
  return f ? (map[f] || f) : "—";
};

export const CAT_PALETTE = [
  "bg-blue-100 text-blue-700",   "bg-purple-100 text-purple-700",
  "bg-green-100 text-green-700", "bg-orange-100 text-orange-700",
  "bg-pink-100 text-pink-700",   "bg-yellow-100 text-yellow-700",
  "bg-teal-100 text-teal-700",   "bg-indigo-100 text-indigo-700",
];

export function catColor(name: string | null | undefined, allCats: string[]) {
  if (!name) return "bg-muted text-muted-foreground";
  const idx = allCats.indexOf(name);
  return CAT_PALETTE[(idx >= 0 ? idx : 0) % CAT_PALETTE.length];
}

export function fmt(v: string | null | undefined) {
  const n = Number(v);
  return isNaN(n) ? "—" : `R$ ${n.toFixed(2).replace(".", ",")}`;
}
