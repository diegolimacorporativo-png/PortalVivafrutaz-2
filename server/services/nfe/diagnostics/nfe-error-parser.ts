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
