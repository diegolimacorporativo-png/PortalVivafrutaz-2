/**
 * nfe-training.ts
 * Registra erros + soluções na tabela nfe_training_logs para aprendizado futuro.
 */

import { db } from '../../../database/db';
import { nfeTrainingLogs } from '../../../../shared/schema';
import { eq, desc, and } from 'drizzle-orm';
import { parseNFeError } from './nfe-error-parser';
import { generateFixSuggestion } from './nfe-fix-suggestions';

export interface TrainErrorInput {
  orderId?: number;
  nfeId?: number;
  codigoErro: string;
  mensagemErro: string;
  campoAfetado?: string;
  userId?: number;
}

export async function logNFeError(input: TrainErrorInput) {
  const parsed = parseNFeError(input.codigoErro, input.mensagemErro);
  const suggestion = generateFixSuggestion(parsed);

  const [record] = await db.insert(nfeTrainingLogs).values({
    orderId: input.orderId,
    nfeId: input.nfeId,
    codigoErro: input.codigoErro,
    mensagemErro: input.mensagemErro,
    campoAfetado: input.campoAfetado || parsed.campoAfetado,
    solucao: suggestion.passos.join('\n'),
    telaCorrecao: parsed.telaCorrecao,
    userId: input.userId,
  }).returning();

  return record;
}

export async function logNFeErrors(
  errors: Array<{ campo?: string; mensagem: string; codigo?: string }>,
  opts: { orderId?: number; nfeId?: number; userId?: number }
) {
  const results = [];
  for (const e of errors) {
    const codigo = e.codigo || '422';
    const msg = e.campo ? `${e.campo}: ${e.mensagem}` : e.mensagem;
    results.push(await logNFeError({ ...opts, codigoErro: codigo, mensagemErro: msg }));
  }
  return results;
}

export async function markNFeErrorResolved(id: number) {
  const [updated] = await db
    .update(nfeTrainingLogs)
    .set({ resolvidoEm: new Date() })
    .where(eq(nfeTrainingLogs.id, id))
    .returning();
  return updated;
}

export async function getTrainingLogs(filters: { orderId?: number; campoAfetado?: string; limit?: number } = {}) {
  let q = db.select().from(nfeTrainingLogs).orderBy(desc(nfeTrainingLogs.createdAt));
  const rows = await q;
  let result = rows;
  if (filters.orderId) result = result.filter(r => r.orderId === filters.orderId);
  if (filters.campoAfetado) result = result.filter(r => r.campoAfetado === filters.campoAfetado);
  if (filters.limit) result = result.slice(0, filters.limit);
  return result;
}

export async function getLearnedPatterns() {
  const logs = await db.select().from(nfeTrainingLogs);
  const byField = new Map<string, { count: number; resolved: number; solucao: string; telaCorrecao: string }>();

  for (const log of logs) {
    const key = log.campoAfetado || 'desconhecido';
    const prev = byField.get(key) || { count: 0, resolved: 0, solucao: '', telaCorrecao: '' };
    byField.set(key, {
      count: prev.count + 1,
      resolved: prev.resolved + (log.resolvidoEm ? 1 : 0),
      solucao: log.solucao || prev.solucao,
      telaCorrecao: log.telaCorrecao || prev.telaCorrecao,
    });
  }

  return Array.from(byField.entries())
    .map(([campo, data]) => ({
      campoAfetado: campo,
      occurrences: data.count,
      resolved: data.resolved,
      taxaResolucao: data.count > 0 ? Math.round((data.resolved / data.count) * 100) : 0,
      solucao: data.solucao,
      telaCorrecao: data.telaCorrecao,
    }))
    .sort((a, b) => b.occurrences - a.occurrences);
}
