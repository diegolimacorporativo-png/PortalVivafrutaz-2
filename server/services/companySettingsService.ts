import { storage } from "./storage";

export interface CompanySettings {
  corPrimaria: string;
  corSecundaria: string;
  logoBase64?: string;
  nomeEmpresa: string;
}

export class CompanySettingsService {
  async getSettings(empresaId: number): Promise<CompanySettings | null> {
    const settings = await storage.getCompanySettings(empresaId);
    if (!settings) return null;
    return {
      corPrimaria: settings.corPrimaria || "#16a34a",
      corSecundaria: settings.corSecundaria || "#ea580c",
      logoBase64: settings.logoBase64 || undefined,
      nomeEmpresa: settings.nomeEmpresa || "VivaFrutaz",
    };
  }

  async updateSettings(empresaId: number, settings: Partial<CompanySettings>): Promise<CompanySettings> {
    const updated = await storage.updateCompanySettings(empresaId, settings);
    return {
      corPrimaria: updated.corPrimaria || "#16a34a",
      corSecundaria: updated.corSecundaria || "#ea580c",
      logoBase64: updated.logoBase64 || undefined,
      nomeEmpresa: updated.nomeEmpresa || "VivaFrutaz",
    };
  }
}

export const companySettingsService = new CompanySettingsService();