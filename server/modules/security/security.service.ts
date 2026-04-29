/**
 * FASE 6.7 — Security Service (pass-through).
 *
 * Camada fina entre o controller HTTP e o repository. Não adiciona regra
 * de negócio: apenas reexpõe `getSecurityEventsResumo` mantendo a
 * separação de responsabilidades padrão dos demais módulos.
 *
 * IMPORTANTE: nada aqui altera lógica de segurança, schema do banco ou
 * fluxo de logs. É puro read-through.
 */
import { getSecurityEventsResumo } from "./security.repository";

export const securityService = {
  async getResumo(): Promise<Array<{ type: string; total: number }>> {
    return getSecurityEventsResumo();
  },
};
