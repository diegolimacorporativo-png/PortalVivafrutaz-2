import { db } from "../database/db.ts";

// Interface para entrada de memória
interface MemoryEntry {
  id?: number;
  key: string;
  value: string;
  category: string; // e.g., 'code_pattern', 'module_created', 'bug_fix'
  createdAt?: Date;
}

// Tabela de memória (simulada via array para simplicidade; em produção, use DB)
let memoryStore: MemoryEntry[] = [];

// Função para salvar conhecimento na memória
export async function saveToMemory(key: string, value: string, category: string): Promise<void> {
  const entry: MemoryEntry = {
    key,
    value,
    category,
    createdAt: new Date(),
  };
  memoryStore.push(entry);
  // Em produção: await db.insert(memoryTable).values(entry);
}

// Função para ler conhecimento da memória
export async function readFromMemory(key: string): Promise<string | null> {
  const entry = memoryStore.find(e => e.key === key);
  return entry ? entry.value : null;
}

// Função para listar memórias por categoria
export async function listMemoryByCategory(category: string): Promise<MemoryEntry[]> {
  return memoryStore.filter(e => e.category === category);
}

// Função para limpar memória antiga (exemplo: >30 dias)
export async function cleanOldMemory(days: number = 30): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  memoryStore = memoryStore.filter(e => e.createdAt && e.createdAt > cutoff);
}
