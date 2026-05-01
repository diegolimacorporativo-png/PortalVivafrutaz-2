/**
 * nfe-validator.ts
 * Validação completa antes de enviar a NF-e — verifica empresa, cliente, produtos e configuração fiscal.
 */

import { db } from '../../../database/db';
import { companies, orders, orderItems, products } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { validarCNPJ, validarCPF } from '../nfeValidator';
import { parseNFeError } from './nfe-error-parser';
import { generateFixSuggestion } from './nfe-fix-suggestions';
import type { FixSuggestion } from './nfe-fix-suggestions';
import { storage } from '../../storage';
// FASE 9B — fiscal hardening
import { logSecurity } from '../../../core/security/securityLogger';

export interface DiagnosticResult {
  orderId: number;
  orderCode: string;
  bloqueado: boolean;
  erros: DiagnosticError[];
  avisos: DiagnosticError[];
  sugestoes: FixSuggestion[];
  resumo: {
    total: number;
    criticos: number;
    altos: number;
    medios: number;
  };
}

export interface DiagnosticError {
  campo: string;
  mensagem: string;
  prioridade: 'CRITICA' | 'ALTA' | 'MEDIA';
  telaCorrecao: string;
  labelBotao: string;
}

export async function validateNFeBeforeSend(orderId: number): Promise<DiagnosticResult> {
  const erros: DiagnosticError[] = [];
  const avisos: DiagnosticError[] = [];

  // ── Carrega pedido ──────────────────────────────────────────────────────────
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) {
    return {
      orderId,
      orderCode: `#${orderId}`,
      bloqueado: true,
      erros: [{ campo: 'pedido', mensagem: 'Pedido não encontrado', prioridade: 'CRITICA', telaCorrecao: '/admin/orders', labelBotao: 'Ver Pedidos' }],
      avisos: [],
      sugestoes: [],
      resumo: { total: 1, criticos: 1, altos: 0, medios: 0 },
    };
  }

  // ── Carrega empresa (destinatário) ──────────────────────────────────────────
  const [company] = order.companyId
    ? await db.select().from(companies).where(eq(companies.id, order.companyId))
    : [null];

  // ── Carrega config da empresa emitente ──────────────────────────────────────
  const { storage: storageSvc } = await import('../../storage');
  const config = await storageSvc.getCompanyConfig();

  // ── Validação do emitente ───────────────────────────────────────────────────
  function addEmit(campo: string, msg: string, prio: 'CRITICA' | 'ALTA' | 'MEDIA' = 'ALTA') {
    const parsed = parseNFeError('422', `${campo}: ${msg}`);
    const sug = generateFixSuggestion(parsed);
    erros.push({ campo, mensagem: msg, prioridade: prio, telaCorrecao: parsed.telaCorrecao, labelBotao: sug.labelBotao });
  }

  const cnpjEmit = (config?.cnpj || '').replace(/\D/g, '');
  if (!cnpjEmit || !validarCNPJ(cnpjEmit)) addEmit('emitente.cnpj', 'CNPJ do emitente inválido ou ausente', 'CRITICA');
  if (!config?.companyName?.trim()) addEmit('emitente.xNome', 'Razão social do emitente não preenchida', 'ALTA');
  if (!config?.stateRegistration?.trim()) addEmit('emitente.ie', 'Inscrição Estadual não informada', 'ALTA');
  if (!config?.state?.trim()) addEmit('emitente.uf', 'Estado (UF) do emitente não configurado', 'ALTA');
  if (!config?.cep?.replace(/\D/g, '')) addEmit('emitente.cMun', 'CEP do emitente não preenchido — código IBGE indisponível', 'CRITICA');
  if (!config?.address?.trim()) addEmit('emitente.logradouro', 'Endereço do emitente não preenchido', 'ALTA');
  if (!config?.defaultCfop?.trim()) {
    const parsed = parseNFeError('422', 'empresa.defaultCfop: CFOP padrão da empresa não configurado');
    const sug = generateFixSuggestion(parsed);
    avisos.push({ campo: 'empresa.defaultCfop', mensagem: 'CFOP padrão não configurado. Será usado 5102.', prioridade: 'MEDIA', telaCorrecao: parsed.telaCorrecao, labelBotao: sug.labelBotao });
  }

  // ── Validação do certificado ────────────────────────────────────────────────
  if (!process.env.CERT_PATH || !process.env.CERT_PASSWORD) {
    const parsed = parseNFeError('cert', 'certificado: Certificado digital não configurado');
    const sug = generateFixSuggestion(parsed);
    erros.push({ campo: 'certificado', mensagem: 'Certificado digital A1 não configurado (CERT_PATH / CERT_PASSWORD)', prioridade: 'CRITICA', telaCorrecao: parsed.telaCorrecao, labelBotao: sug.labelBotao });
  }

  // ── Validação do destinatário ───────────────────────────────────────────────
  function addDest(campo: string, msg: string, prio: 'CRITICA' | 'ALTA' | 'MEDIA' = 'ALTA') {
    const parsed = parseNFeError('422', `${campo}: ${msg}`);
    const sug = generateFixSuggestion(parsed);
    erros.push({ campo, mensagem: msg, prioridade: prio, telaCorrecao: parsed.telaCorrecao, labelBotao: sug.labelBotao });
  }

  if (!company) {
    addDest('destinatario', 'Empresa destinatária não encontrada', 'CRITICA');
  } else {
    const cnpjDest = (company.cnpj || '').replace(/\D/g, '');
    if (!cnpjDest || !validarCNPJ(cnpjDest)) addDest('destinatario.cnpj', 'CNPJ do destinatário inválido', 'CRITICA');
    if (!company.companyName?.trim()) addDest('destinatario.xNome', 'Razão social do destinatário não preenchida', 'ALTA');
    if (!company.addressState?.trim()) addDest('destinatario.uf', 'Estado (UF) do destinatário não informado', 'ALTA');
    if (!company.addressZip?.replace(/\D/g, '')) addDest('destinatario.cMun', 'CEP do destinatário não preenchido — código IBGE indisponível', 'CRITICA');
  }

  // ── Validação dos produtos do pedido ────────────────────────────────────────
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  if (!items.length) {
    erros.push({ campo: 'produtos', mensagem: 'Pedido não possui itens', prioridade: 'CRITICA', telaCorrecao: '/admin/orders', labelBotao: 'Ver Pedido' });
  } else {
    const prodIds = [...new Set(items.map(i => i.productId).filter(Boolean))];
    const prods = prodIds.length
      ? await db.select().from(products).where(
          prodIds.reduce((acc, id, idx) => idx === 0 ? eq(products.id, id!) : acc, eq(products.id, prodIds[0]!))
        )
      : [];
    const prodMap = new Map(prods.map(p => [p.id, p]));

    let totalValue = 0;
    for (const item of items) {
      const prod = item.productId ? prodMap.get(item.productId) : null;
      const nome = prod?.name || (item as any).productName || `Item #${item.id}`;

      if (!prod?.ncm?.replace(/\D/g, '').trim()) {
        erros.push({ campo: `produto.ncm:${item.productId}`, mensagem: `Produto "${nome}": NCM não informado`, prioridade: 'CRITICA', telaCorrecao: '/admin/products', labelBotao: 'Corrigir Produtos' });
      }
      // FASE 9B — bloqueia item com valor zerado; preserva o contrato de retorno DiagnosticResult
      if (!item.totalPrice && !item.unitPrice) {
        logSecurity(`[SECURITY] NFE_ZERO_VALUE_DETECTED | orderId=${orderId} | itemId=${item.id}`);
        erros.push({
          campo: `produto.valor:${item.id}`,
          mensagem: `Item "${nome}": valor zerado (totalPrice e unitPrice ausentes)`,
          prioridade: 'CRITICA',
          telaCorrecao: '/admin/orders',
          labelBotao: 'Corrigir Pedido',
        });
      } else {
        totalValue += parseFloat(String(item.totalPrice || item.unitPrice || 0)) * (item.quantity || 1);
      }
    }
    if (totalValue <= 0) {
      erros.push({ campo: 'total', mensagem: 'Valor total do pedido é zero', prioridade: 'CRITICA', telaCorrecao: '/admin/orders', labelBotao: 'Ver Pedido' });
    }
  }

  // ── Monta sugestões ─────────────────────────────────────────────────────────
  const { parseNFeErrors } = await import('./nfe-error-parser');
  const { generateFixSuggestions } = await import('./nfe-fix-suggestions');
  const allMsgs = [...erros, ...avisos].map(e => ({ campo: e.campo, mensagem: e.mensagem }));
  const sugestoes = generateFixSuggestions(parseNFeErrors(allMsgs));

  const resumo = {
    total: erros.length + avisos.length,
    criticos: erros.filter(e => e.prioridade === 'CRITICA').length,
    altos: erros.filter(e => e.prioridade === 'ALTA').length,
    medios: avisos.length,
  };

  return {
    orderId,
    orderCode: order.orderCode || `#${orderId}`,
    bloqueado: erros.length > 0,
    erros,
    avisos,
    sugestoes,
    resumo,
  };
}
