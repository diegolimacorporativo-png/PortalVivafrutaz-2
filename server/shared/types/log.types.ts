/**
 * Shared log types — Wave 1B.
 *
 * `LogEntry` foi extraído de `server/modules/users/interfaces/IUsersRepository.ts`
 * para este local compartilhado. Todos os repositórios que precisarem gravar
 * audit logs devem importar daqui em vez de redefinir localmente.
 *
 * Espelha o contrato de `storage.createLog` (DatabaseStorage.IStorage).
 */

export type LogEntry = {
  action: string;
  description: string;
  userId?: number;
  companyId?: number;
  userEmail?: string;
  userRole?: string;
  ip?: string;
  level?: string;
};
