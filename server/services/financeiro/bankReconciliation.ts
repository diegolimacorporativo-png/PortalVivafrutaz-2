export interface BankTx {
  id: string;
  tipo: 'credito' | 'debito';
  valor: number;
  data: string;
  descricao: string;
  documento?: string;
}

export interface ARItem {
  id: number;
  descricao: string;
  valor: string;
  dataVencimento: string;
  status: string;
}

export interface APItem {
  id: number;
  descricao: string;
  fornecedor: string;
  valor: string;
  dataVencimento: string;
  status: string;
}

export interface ReconciliationMatch {
  bankTxId: string;
  bankValor: number;
  bankData: string;
  bankDescricao: string;
  tipo: 'credito' | 'debito';
  match: {
    type: 'ar' | 'ap';
    id: number;
    descricao: string;
    valor: string;
    confianca: number; // 0-100
  } | null;
}

const TOLERANCE_DAYS = 5;
const TOLERANCE_VALOR = 0.05; // 5% tolerance

function daysDiff(a: string, b: string): number {
  const da = new Date(a + 'T12:00:00').getTime();
  const db = new Date(b + 'T12:00:00').getTime();
  return Math.abs((da - db) / 86400000);
}

function valorClose(bankValor: number, itemValor: number): boolean {
  return Math.abs(bankValor - itemValor) / Math.max(itemValor, 0.01) <= TOLERANCE_VALOR;
}

function scoreMatch(bankValor: number, bankData: string, itemValor: number, itemData: string): number {
  let score = 0;
  // Valor exato = 60pts, próximo = 30pts
  if (Math.abs(bankValor - itemValor) < 0.02) score += 60;
  else if (valorClose(bankValor, itemValor)) score += 30;
  else return 0; // Very different value, skip

  // Data match
  const days = daysDiff(bankData, itemData);
  if (days === 0) score += 40;
  else if (days <= 2) score += 30;
  else if (days <= TOLERANCE_DAYS) score += 15;

  return score;
}

export function reconciliarTransacoes(
  bankTransactions: BankTx[],
  arItems: ARItem[],
  apItems: APItem[]
): ReconciliationMatch[] {
  const pendingAR = arItems.filter(a => a.status === 'pendente');
  const pendingAP = apItems.filter(a => a.status === 'pendente');

  const results: ReconciliationMatch[] = [];

  for (const tx of bankTransactions) {
    let bestMatch: ReconciliationMatch['match'] = null;
    let bestScore = 0;

    if (tx.tipo === 'credito') {
      // Credits → match with AR (contas a receber)
      for (const ar of pendingAR) {
        const score = scoreMatch(tx.valor, tx.data, parseFloat(ar.valor), ar.dataVencimento);
        if (score > bestScore && score >= 30) {
          bestScore = score;
          bestMatch = { type: 'ar', id: ar.id, descricao: ar.descricao, valor: ar.valor, confianca: score };
        }
      }
    } else {
      // Debits → match with AP (contas a pagar)
      for (const ap of pendingAP) {
        const score = scoreMatch(tx.valor, tx.data, parseFloat(ap.valor), ap.dataVencimento);
        if (score > bestScore && score >= 30) {
          bestScore = score;
          bestMatch = { type: 'ap', id: ap.id, descricao: ap.descricao, valor: ap.valor, confianca: score };
        }
      }
    }

    results.push({
      bankTxId: tx.id,
      bankValor: tx.valor,
      bankData: tx.data,
      bankDescricao: tx.descricao,
      tipo: tx.tipo,
      match: bestMatch,
    });
  }

  return results.sort((a, b) => (b.match?.confianca || 0) - (a.match?.confianca || 0));
}

export function resumoReconciliacao(matches: ReconciliationMatch[]): {
  total: number;
  comMatch: number;
  semMatch: number;
  totalCredito: number;
  totalDebito: number;
  matchAlta: number; // confiança >= 80
  matchMedia: number; // 50 <= confiança < 80
} {
  const comMatch = matches.filter(m => m.match !== null);
  return {
    total: matches.length,
    comMatch: comMatch.length,
    semMatch: matches.length - comMatch.length,
    totalCredito: matches.filter(m => m.tipo === 'credito').reduce((s, m) => s + m.bankValor, 0),
    totalDebito: matches.filter(m => m.tipo === 'debito').reduce((s, m) => s + m.bankValor, 0),
    matchAlta: comMatch.filter(m => (m.match?.confianca || 0) >= 80).length,
    matchMedia: comMatch.filter(m => (m.match?.confianca || 0) >= 50 && (m.match?.confianca || 0) < 80).length,
  };
}
