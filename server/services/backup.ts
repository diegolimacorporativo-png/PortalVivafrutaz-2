export async function scheduleBackups(): Promise<void> {
  // mock implementation
  return;
}

export async function runBackup(): Promise<string> {
  // mock implementation
  return "backup-file.json";
}

export async function runBackupSQL(): Promise<string> {
  // mock implementation
  return "backup-file.sql";
}

export function listBackups(): string[] {
  // mock implementation
  return [];
}

export function getBackupPath(filename: string): string | null {
  // mock implementation
  return null;
}

export function deleteBackup(filename: string): boolean {
  // mock implementation
  return false;
}

export function cleanOldBackups(days: number): number {
  // mock implementation
  return 0;
}
