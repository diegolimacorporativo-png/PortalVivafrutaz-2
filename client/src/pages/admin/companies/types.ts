export type TabKey = "basico" | "config" | "financeiro" | "contrato" | "entrega" | "enderecos" | "fiscal";

export type DeliveryDayConfig = { enabled: boolean; startTime: string; endTime: string };
export type DeliveryConfig = { [day: string]: DeliveryDayConfig };

export interface AddressForm {
  label: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
  isPrimary: boolean;
}

export type CompanyForm = {
  companyName: string;
  contactName: string;
  email: string;
  password: string;
  notificationEmail: string;
  phone: string;
  cnpj: string;
  addressStreet: string;
  addressNumber: string;
  addressNeighborhood: string;
  addressCity: string;
  addressZip: string;
  latitude: string;
  longitude: string;
  priceGroupId: string;
  allowedOrderDays: string[];
  active: boolean;
  clientType: string;
  contractModel: string;
  minWeeklyBilling: string;
  deliveryTime: string;
  adminFee: string;
  billingTerm: string;
  billingType: string;
  billingFormat: string;
  paymentDates: string;
  financialNotes: string;
  deliveryConfigJson: DeliveryConfig | null;
  autoCalcCost: boolean;
  autoPriceFromCatalog: boolean;
  manualAvgCost: string;
  contractStartDate: string;
  contractEndDate: string;
  contractVigencia: string;
  stateRegistration: string;
  addressState: string;
  addressIbge: string;
  regimeTributario: string;
  defaultCfop: string;
};
