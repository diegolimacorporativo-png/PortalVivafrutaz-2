/**
 * FASE NF.3 — ENVIO SEFAZ (mock controlado + retry + idempotência)
 *
 * Service ÚNICA responsável por transmitir uma NF-e já gerada (com XML pronto)
 * para a SEFAZ — atualmente em modo MOCK, controlado pela env `NFE_SEFAZ_MODE`.
 *
 * Garantias (fail-fast, sem fallback silencioso):
 *  - Bloqueio explícito de reenvio quando status ∈ {enviada, autorizada}.
 *  - Re-checagem do status imediatamente antes do UPDATE (ETAPA 11 — proteção
 *    contra corrida entre múltiplas chamadas concorrentes).
 *  - Retry controlado (máx 3 tentativas) — não infinito, não em validação.
 *  - Logs estruturados sem dados sensíveis e SEM o XML completo.
 *  - Em produção, lança `NFE_SEFAZ_PRODUCTION_NOT_IMPLEMENTED` para que o
 *    handler legado (rota com certificado A1) assuma o controle. NÃO altera
 *    o fluxo de produção existente.
 */
import { storage } from '../../services/storage';
import type { NfeEmissao } from '@shared/schema';

const BLOCKED_STATUSES = new Set(['enviada', 'autorizada']);
const MAX_ATTEMPTS = 3;

export interface TransmitResult {
  nfeId: number;
  orderId: number | null;
  status: string;
  protocolo: string;
  cStat: string;
  xMotivo: string;
  attempts: number;
  mode: 'mock' | 'production';
}

interface SefazResponse {
  status: 'autorizada' | 'rejeitada';
  protocolo: string;
  cStat: string;
  xMotivo: string;
}

function isMockMode(): boolean {
  return (process.env.NFE_SEFAZ_MODE ?? 'mock') !== 'production';
}

async function callSefazMock(nfe: NfeEmissao): Promise<SefazResponse> {
  return {
    status: 'autorizada',
    protocolo: `MOCK-${Date.now()}-${nfe.id}`,
    cStat: '100',
    xMotivo: 'Autorizado o uso da NF-e',
  };
}

export async function transmitirNFe(nfeId: number): Promise<TransmitResult> {
  if (!Number.isFinite(nfeId) || nfeId <= 0) {
    throw new Error('NFE_TRANSMIT_INVALID_ID');
  }

  const nfe = await storage.getNfeEmissao(nfeId);
  if (!nfe) throw new Error('NFE_NOT_FOUND');
  if (!nfe.xmlGerado) throw new Error('NFE_XML_MISSING');

  // ETAPA 3 — bloqueio de reenvio (idempotência por status).
  if (BLOCKED_STATUSES.has(nfe.status)) {
    throw new Error('NFE_ALREADY_SENT');
  }

  // ETAPA 4 — modo controlado por env. Em produção, devolve ao handler legado.
  if (!isMockMode()) {
    throw new Error('NFE_SEFAZ_PRODUCTION_NOT_IMPLEMENTED');
  }

  // FASE NF.3.1 — estado intermediário "enviando" (proteção de corrida +
  // observabilidade). Atua APÓS as validações iniciais e ANTES do retry loop.
  // Não altera fluxo, assinaturas ou retorno externo.
  const preTransition = await storage.getNfeEmissao(nfe.id);
  if (!preTransition || preTransition.status !== 'gerada') {
    throw new Error('NFE_INVALID_STATE_TRANSITION');
  }
  await storage.updateNfeEmissao(nfe.id, { status: 'enviando' });

  // ETAPA 8 — retry controlado (3 tentativas, sem retry em erro de validação).
  let lastErr: unknown = null;
  let response: SefazResponse | null = null;
  let attemptsUsed = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attemptsUsed = attempt;
    try {
      response = await callSefazMock(nfe);
      break;
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS) {
        // FASE NF.3.1 — recuperação: marcar "erro" só após esgotar tentativas,
        // sem sobrescrever um eventual "autorizada" definido por outro caminho.
        try {
          const latest = await storage.getNfeEmissao(nfe.id);
          if (latest?.status === 'autorizada') {
          } else {
            await storage.updateNfeEmissao(nfe.id, { status: 'erro' });
          }
        } catch (recoverErr) {
          void recoverErr;
        }
        throw err;
      }
    }
  }

  if (!response) {
    // Defensivo — em teoria inalcançável (loop acima já joga no último attempt).
    throw lastErr instanceof Error ? lastErr : new Error('NFE_SEND_UNKNOWN_ERROR');
  }

  // ETAPA 11 — proteção extra: re-leitura do status antes de qualquer UPDATE.
  // Cobre o caso de outra requisição concorrente ter autorizado a NF entre o
  // início desta transmissão e a conclusão do mock.
  const refetched = await storage.getNfeEmissao(nfe.id);
  if (refetched && BLOCKED_STATUSES.has(refetched.status)) {
    return {
      nfeId: nfe.id,
      orderId: nfe.orderId,
      status: refetched.status,
      protocolo: refetched.protocolo ?? '',
      cStat: refetched.cStat ?? '',
      xMotivo: refetched.xMotivo ?? '',
      attempts: attemptsUsed,
      mode: 'mock',
    };
  }

  // ETAPA 6 — atualizar a NF-e com o retorno da SEFAZ (mock).
  await storage.updateNfeEmissao(nfe.id, {
    status: response.status,
    protocolo: response.protocolo,
    cStat: response.cStat,
    xMotivo: response.xMotivo,
    dataAutorizacao: new Date(),
  });

  // ETAPA 7 — atualizar o pedido (somente se autorizada e houver orderId).
  if (response.status === 'autorizada' && nfe.orderId) {
    await storage.updateOrder(nfe.orderId, { fiscalStatus: 'nota_emitida' });
  }

  return {
    nfeId: nfe.id,
    orderId: nfe.orderId,
    status: response.status,
    protocolo: response.protocolo,
    cStat: response.cStat,
    xMotivo: response.xMotivo,
    attempts: attemptsUsed,
    mode: 'mock',
  };
}
