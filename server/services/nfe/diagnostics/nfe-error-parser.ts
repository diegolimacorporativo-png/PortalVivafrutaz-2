/**
 * nfe-error-parser.ts
 * Identifica o campo afetado, tabela e tela de cadastro a partir de erros SEFAZ ou de validação.
 */

export interface ParsedNFeError {
  codigoErro: string;
  mensagemOriginal: string;
  campoAfetado: string;
  descricaoAmigavel: string;
  tabela: string;
  telaCorrecao: string;
  campoFoco?: string;
}

const FIELD_MAP: Array<{
  patterns: RegExp[];
  campoAfetado: string;
  descricaoAmigavel: string;
  tabela: string;
  telaCorrecao: string;
  campoFoco?: string;
}> = [
  // ── Emitente ──────────────────────────────────────────────────
  {
    patterns: [/emitente\.cnpj/i, /cnpj.*emitente/i, /CNPJ do emitente/i],
    campoAfetado: 'emitente.cnpj',
    descricaoAmigavel: 'CNPJ do emitente inválido ou ausente',
    tabela: 'company_config',
    telaCorrecao: '/admin/company-config',
    campoFoco: 'cnpj',
  },
  {
    patterns: [/emitente\.cMun/i, /código.*ibge/i, /cMun.*emitente/i, /municipio.*emitente/i, /cMun obrigat/i],
    campoAfetado: 'emitente.cMun',
    descricaoAmigavel: 'Código IBGE do município do emitente não informado',
    tabela: 'company_config',
    telaCorrecao: '/admin/company-config',
    campoFoco: 'cep',
  },
  {
    patterns: [/emitente\.ie/i, /inscrição estadual.*emitente/i, /IE.*emitente/i],
    campoAfetado: 'emitente.ie',
    descricaoAmigavel: 'Inscrição Estadual do emitente ausente ou inválida',
    tabela: 'company_config',
    telaCorrecao: '/admin/company-config',
    campoFoco: 'stateRegistration',
  },
  {
    patterns: [/emitente\.xNome/i, /razão social.*emitente/i],
    campoAfetado: 'emitente.xNome',
    descricaoAmigavel: 'Razão social do emitente não preenchida',
    tabela: 'company_config',
    telaCorrecao: '/admin/company-config',
    campoFoco: 'companyName',
  },
  {
    patterns: [/emitente\.logradouro/i, /endereço.*emitente/i],
    campoAfetado: 'emitente.logradouro',
    descricaoAmigavel: 'Endereço do emitente não preenchido',
    tabela: 'company_config',
    telaCorrecao: '/admin/company-config',
    campoFoco: 'address',
  },
  {
    patterns: [/emitente\.uf/i, /uf.*emitente/i, /estado.*emitente/i],
    campoAfetado: 'emitente.uf',
    descricaoAmigavel: 'Estado (UF) do emitente não informado',
    tabela: 'company_config',
    telaCorrecao: '/admin/company-config',
    campoFoco: 'state',
  },
  {
    patterns: [/emitente\.cep/i, /cep.*emitente/i],
    campoAfetado: 'emitente.cep',
    descricaoAmigavel: 'CEP do emitente não informado',
    tabela: 'company_config',
    telaCorrecao: '/admin/company-config',
    campoFoco: 'cep',
  },
  {
    patterns: [/crt/i, /regime tributário/i, /regime.*tributar/i],
    campoAfetado: 'emitente.crt',
    descricaoAmigavel: 'Regime tributário não configurado (Simples / Lucro Presumido)',
    tabela: 'company_config',
    telaCorrecao: '/admin/company-config',
    campoFoco: 'regimeTributario',
  },

  // ── Destinatário ──────────────────────────────────────────────
  {
    patterns: [/destinatário\.cnpj/i, /cnpj.*destinat/i, /CNPJ do destinat/i, /destinatario.*cnpj/i],
    campoAfetado: 'destinatario.cnpj',
    descricaoAmigavel: 'CNPJ do destinatário inválido ou ausente',
    tabela: 'companies',
    telaCorrecao: '/admin/companies',
    campoFoco: 'cnpj',
  },
  {
    patterns: [/destinatário\.cpf/i, /cpf.*destinat/i],
    campoAfetado: 'destinatario.cpf',
    descricaoAmigavel: 'CPF do destinatário inválido',
    tabela: 'companies',
    telaCorrecao: '/admin/companies',
    campoFoco: 'cpf',
  },
  {
    patterns: [/destinatário\.cMun/i, /municipio.*destinat/i, /cMun.*destinat/i],
    campoAfetado: 'destinatario.cMun',
    descricaoAmigavel: 'Código IBGE do município do destinatário não informado',
    tabela: 'companies',
    telaCorrecao: '/admin/companies',
    campoFoco: 'addressZip',
  },
  {
    patterns: [/destinatário\.uf/i, /uf.*destinat/i, /estado.*destinat/i],
    campoAfetado: 'destinatario.uf',
    descricaoAmigavel: 'Estado (UF) do destinatário não informado',
    tabela: 'companies',
    telaCorrecao: '/admin/companies',
    campoFoco: 'addressState',
  },
  {
    patterns: [/destinatário\.xNome/i, /razão social.*destinat/i, /destinatario.*nome/i],
    campoAfetado: 'destinatario.xNome',
    descricaoAmigavel: 'Razão social do destinatário não preenchida',
    tabela: 'companies',
    telaCorrecao: '/admin/companies',
    campoFoco: 'companyName',
  },

  // ── Produtos ──────────────────────────────────────────────────
  {
    patterns: [/ncm/i, /código ncm/i, /ncm.*obrigat/i],
    campoAfetado: 'produto.ncm',
    descricaoAmigavel: 'NCM do produto não informado ou inválido (deve ter 8 dígitos)',
    tabela: 'products',
    telaCorrecao: '/admin/products',
    campoFoco: 'ncm',
  },
  {
    patterns: [/cfop/i, /código fiscal.*operação/i],
    campoAfetado: 'produto.cfop',
    descricaoAmigavel: 'CFOP não configurado no produto ou na empresa',
    tabela: 'products',
    telaCorrecao: '/admin/products',
    campoFoco: 'cfop',
  },
  {
    patterns: [/cean/i, /código.*ean/i, /ean.*inválid/i],
    campoAfetado: 'produto.cEAN',
    descricaoAmigavel: 'Código EAN (código de barras) inválido',
    tabela: 'products',
    telaCorrecao: '/admin/products',
    campoFoco: 'ean',
  },
  {
    patterns: [/unidade.*comercial/i, /ucom/i, /unidade.*medida/i],
    campoAfetado: 'produto.uCom',
    descricaoAmigavel: 'Unidade comercial do produto não informada',
    tabela: 'products',
    telaCorrecao: '/admin/products',
    campoFoco: 'unit',
  },

  // ── Certificado ───────────────────────────────────────────────
  {
    patterns: [/certificado/i, /cert_path/i, /cert_password/i, /pfx/i, /assinatura digital/i],
    campoAfetado: 'certificado',
    descricaoAmigavel: 'Certificado digital A1 não configurado',
    tabela: 'environment',
    telaCorrecao: '/admin/fiscal-config',
    campoFoco: 'cert',
  },

  // ── NF-e geral ────────────────────────────────────────────────
  {
    patterns: [/natureza.*operação/i, /natOp/i],
    campoAfetado: 'natOp',
    descricaoAmigavel: 'Natureza da operação não configurada',
    tabela: 'company_config',
    telaCorrecao: '/admin/fiscal-config',
    campoFoco: 'defaultNatureza',
  },
  {
    patterns: [/cfop.*padrão/i, /cfop.*empresa/i, /cfop.*config/i],
    campoAfetado: 'empresa.defaultCfop',
    descricaoAmigavel: 'CFOP padrão da empresa não configurado',
    tabela: 'company_config',
    telaCorrecao: '/admin/fiscal-config',
    campoFoco: 'defaultCfop',
  },
  {
    patterns: [/valor.*total.*zero/i, /valor.*total.*negativ/i, /vProd/i],
    campoAfetado: 'total',
    descricaoAmigavel: 'Valor total da NF-e é zero ou negativo',
    tabela: 'orders',
    telaCorrecao: '/admin/orders',
    campoFoco: 'totalValue',
  },
  {
    patterns: [/produtos.*obrigat/i, /ao menos um produto/i, /sem produto/i],
    campoAfetado: 'produtos',
    descricaoAmigavel: 'Pedido sem produtos vinculados',
    tabela: 'orders',
    telaCorrecao: '/admin/orders',
    campoFoco: 'items',
  },
];

export function parseNFeError(codigoErro: string, mensagem: string): ParsedNFeError {
  const combined = `${codigoErro} ${mensagem}`.toLowerCase();

  for (const rule of FIELD_MAP) {
    if (rule.patterns.some(p => p.test(combined) || p.test(mensagem))) {
      return {
        codigoErro,
        mensagemOriginal: mensagem,
        campoAfetado: rule.campoAfetado,
        descricaoAmigavel: rule.descricaoAmigavel,
        tabela: rule.tabela,
        telaCorrecao: rule.telaCorrecao,
        campoFoco: rule.campoFoco,
      };
    }
  }

  return {
    codigoErro,
    mensagemOriginal: mensagem,
    campoAfetado: 'desconhecido',
    descricaoAmigavel: mensagem,
    tabela: 'desconhecido',
    telaCorrecao: '/admin/fiscal-config',
  };
}

export function parseNFeErrors(erros: Array<{ campo: string; mensagem: string } | { codigo?: string; mensagem: string }>): ParsedNFeError[] {
  return erros.map(e => {
    const campo = (e as any).campo || '';
    const codigo = (e as any).codigo || (e as any).codigoErro || '422';
    return parseNFeError(codigo, campo ? `${campo}: ${e.mensagem}` : e.mensagem);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FASE NF.4.3 — TRADUÇÃO DE ERROS FISCAIS (UX)
// ─────────────────────────────────────────────────────────────────────────────
// Wrapper user-facing: recebe um Error/code cru lançado pelo pipeline NF
// (FASES NF.1 / NF.2 / NF.4.2) e devolve { code, message } em português,
// pronto para resposta HTTP. NÃO substitui parseNFeError() acima — esse
// continua sendo usado pelo diagnóstico interno (FIELD_MAP).
//
// Mapeamento curado dos erros lançados pelo builder e pelo generator.
// Códigos não mapeados caem na mensagem genérica.

const NFE_USER_MESSAGES: Record<string, string> = {
  // FASE NF.4.2 — fail-fast do builder
  NFE_MISSING_NCM: 'Produto sem NCM cadastrado. Cadastre o NCM antes de emitir a nota.',
  NFE_MISSING_COMPANY_NAME: 'Nome da empresa não configurado. Verifique o cadastro fiscal.',
  NFE_MISSING_EMITENTE_ADDRESS: 'Endereço da empresa não configurado.',
  NFE_MISSING_EMITENTE_IE: 'Inscrição estadual da empresa não informada.',
  NFE_INVALID_IBGE_CODE: 'Cidade inválida ou não encontrada na base do IBGE.',
  NFE_BUILD_VALIDATION_FAILED: 'Dados fiscais incompletos no pedido. Revise produtos e cadastro do cliente.',

  // FASE NF.2 — fail-fast do gerador de XML
  NFE_XML_MISSING_EMITENTE: 'CNPJ da empresa emitente não configurado.',
  NFE_XML_MISSING_DESTINATARIO: 'Razão social do destinatário não preenchida.',
  NFE_XML_NO_ITEMS: 'Pedido sem itens para faturar.',
  NFE_XML_EMPTY_EMITENTE_NOME: 'Razão social da empresa emitente não preenchida.',
  NFE_XML_EMPTY_DESTINATARIO: 'Razão social do destinatário não preenchida.',
  NFE_XML_INVALID_QCOM: 'Quantidade inválida em um dos produtos do pedido.',
  NFE_XML_INVALID_VUNCOM: 'Valor unitário inválido em um dos produtos do pedido.',
  NFE_XML_INVALID_VPROD: 'Valor total inválido em um dos produtos do pedido.',
  NFE_XML_INVALID_NUMBER: 'Valor numérico inválido encontrado durante a geração da nota.',
  NFE_XML_EMPTY: 'Falha interna ao gerar o XML da nota fiscal.',
  NFE_XML_INVALID_STRUCTURE: 'XML da nota fiscal foi gerado em formato inválido.',
  NFE_XML_CORRUPTED: 'XML da nota fiscal foi gerado corrompido. Tente novamente.',
  NFE_XML_CORRUPTED_CONTENT: 'XML da nota contém valores inválidos. Revise os dados do pedido.',
};

const NFE_GENERIC_MESSAGE =
  'Erro ao gerar nota fiscal. Verifique os dados e tente novamente.';

/**
 * Recebe qualquer Error / código / string e devolve uma resposta amigável
 * para o usuário final. Nunca lança. Não toca em logs nem em stack trace.
 *
 * Convenção: quando o código não é reconhecido, retorna code='NFE_UNKNOWN_ERROR'
 * com a mensagem genérica — o código original continua disponível no log
 * técnico do chamador (que NÃO é alterado por esta função).
 */
export function translateNFeError(error: any): { code: string; message: string } {
  const raw = String(error?.message ?? error?.code ?? error ?? '').trim();
  const direct = NFE_USER_MESSAGES[raw];
  if (direct) {
    return { code: raw, message: direct };
  }
  // Tenta extrair um código no formato NFE_* mesmo quando vier prefixado/sufixado.
  const match = raw.match(/NFE_[A-Z0-9_]+/);
  if (match && NFE_USER_MESSAGES[match[0]]) {
    return { code: match[0], message: NFE_USER_MESSAGES[match[0]] };
  }
  return { code: 'NFE_UNKNOWN_ERROR', message: NFE_GENERIC_MESSAGE };
}
