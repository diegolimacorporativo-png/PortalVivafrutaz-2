export type NFeValidationError = { campo: string; mensagem: string };

export function validarCNPJ(cnpj: string): boolean {
  const c = cnpj.replace(/\D/g, '');
  if (c.length !== 14) return false;
  if (/^(\d)\1+$/.test(c)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(c[i]) * (i < 4 ? 5 - i : 13 - i);
  let r = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (r !== parseInt(c[12])) return false;
  sum = 0;
  for (let i = 0; i < 13; i++) sum += parseInt(c[i]) * (i < 5 ? 6 - i : 14 - i);
  r = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  return r === parseInt(c[13]);
}

export function validarCPF(cpf: string): boolean {
  const c = cpf.replace(/\D/g, '');
  if (c.length !== 11) return false;
  if (/^(\d)\1+$/.test(c)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(c[i]) * (10 - i);
  let r = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (r !== parseInt(c[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(c[i]) * (11 - i);
  r = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  return r === parseInt(c[10]);
}

export interface NFeEmitente {
  cnpj: string;
  xNome: string;
  xFant?: string;
  ie: string;
  crt: string; // 1=SN, 3=Lucro Real/Presumido
  logradouro: string;
  numero: string;
  bairro: string;
  cMun: string;
  xMun: string;
  uf: string;
  cep: string;
  fone?: string;
}

export interface NFeDestinatario {
  cnpj?: string;
  cpf?: string;
  xNome: string;
  ie?: string;
  logradouro: string;
  numero?: string;
  bairro?: string;
  cMun: string;
  xMun: string;
  uf: string;
  cep: string;
  email?: string;
  fone?: string;
}

export interface NFeProduto {
  cProd: string;
  xProd: string;
  ncm: string;
  cfop: string;
  uCom: string;
  qCom: number;
  vUnCom: number;
  vProd: number;
  cEAN?: string;
  uTrib?: string;
  qTrib?: number;
  vUnTrib?: number;
  csosn?: string;
  // FASE NF.6 — CST do ICMS para regime normal (CRT=3). Opcional: quando
  // ausente, gerarNFeXML usa default '00' preservando o comportamento atual.
  // Não afeta Simples Nacional (CRT=1/2), que segue usando csosn.
  cst?: string;
}

export interface NFeInput {
  emitente: NFeEmitente;
  destinatario: NFeDestinatario;
  produtos: NFeProduto[];
  natOp?: string;
  serie?: string;
  tpAmb?: '1' | '2'; // 1=producao 2=homologacao
  indPag?: '0' | '1' | '2'; // 0=a vista 1=a prazo 2=outros
  valorFrete?: number;
  valorSeguro?: number;
  valorDesconto?: number;
  informacoesAdicionais?: string;
  orderId?: number;
  orderCode?: string;
}

/**
 * FASE NF.5.1 — ETAPA 3: validação CRT sem fallback silencioso.
 * O generator antes mascarava CRT ausente/inválido com `|| '1'`, escolhendo
 * Simples Nacional por engano. Aqui falhamos rápido com NFE_INVALID_CRT
 * (aceito apenas '1', '2' ou '3', conforme manual SEFAZ).
 */
export function validarCRT(input: NFeInput): void {
  if (!['1', '2', '3'].includes(input.emitente.crt)) {
    throw new Error('NFE_INVALID_CRT');
  }
}

export function validarNFeInput(input: NFeInput): NFeValidationError[] {
  const erros: NFeValidationError[] = [];

  // Emitente
  const cnpjEmit = input.emitente.cnpj?.replace(/\D/g, '') || '';
  if (!cnpjEmit || !validarCNPJ(cnpjEmit)) erros.push({ campo: 'emitente.cnpj', mensagem: 'CNPJ do emitente inválido' });
  if (!input.emitente.xNome?.trim()) erros.push({ campo: 'emitente.xNome', mensagem: 'Razão social do emitente obrigatória' });
  if (!input.emitente.ie?.trim()) erros.push({ campo: 'emitente.ie', mensagem: 'Inscrição Estadual do emitente obrigatória' });
  if (!input.emitente.uf?.trim()) erros.push({ campo: 'emitente.uf', mensagem: 'UF do emitente obrigatória' });
  if (!input.emitente.cMun?.trim()) erros.push({ campo: 'emitente.cMun', mensagem: 'Código IBGE do município do emitente obrigatório' });
  if (!input.emitente.logradouro?.trim()) erros.push({ campo: 'emitente.logradouro', mensagem: 'Endereço do emitente obrigatório' });

  // Destinatário
  const cnpjDest = input.destinatario.cnpj?.replace(/\D/g, '') || '';
  const cpfDest = input.destinatario.cpf?.replace(/\D/g, '') || '';
  if (!cnpjDest && !cpfDest) {
    erros.push({ campo: 'destinatario.cnpj', mensagem: 'CNPJ ou CPF do destinatário obrigatório' });
  } else if (cnpjDest && !validarCNPJ(cnpjDest)) {
    erros.push({ campo: 'destinatario.cnpj', mensagem: 'CNPJ do destinatário inválido' });
  } else if (cpfDest && !validarCPF(cpfDest)) {
    erros.push({ campo: 'destinatario.cpf', mensagem: 'CPF do destinatário inválido' });
  }
  if (!input.destinatario.xNome?.trim()) erros.push({ campo: 'destinatario.xNome', mensagem: 'Razão social do destinatário obrigatória' });
  if (!input.destinatario.uf?.trim()) erros.push({ campo: 'destinatario.uf', mensagem: 'UF do destinatário obrigatória' });

  // Produtos
  if (!input.produtos?.length) {
    erros.push({ campo: 'produtos', mensagem: 'NF-e deve ter ao menos um produto' });
  } else {
    input.produtos.forEach((p, i) => {
      if (!p.xProd?.trim()) erros.push({ campo: `produto[${i}].xProd`, mensagem: `Produto ${i + 1}: nome obrigatório` });
      if (!p.ncm?.replace(/\D/g, '').trim()) erros.push({ campo: `produto[${i}].ncm`, mensagem: `Produto ${i + 1}: NCM obrigatório (8 dígitos)` });
      if (!p.cfop?.trim()) erros.push({ campo: `produto[${i}].cfop`, mensagem: `Produto ${i + 1}: CFOP obrigatório` });
      if (!p.qCom || p.qCom <= 0) erros.push({ campo: `produto[${i}].qCom`, mensagem: `Produto ${i + 1}: quantidade inválida` });
      if (!p.vUnCom || p.vUnCom <= 0) erros.push({ campo: `produto[${i}].vUnCom`, mensagem: `Produto ${i + 1}: valor unitário inválido` });
    });
  }

  // Total
  const total = input.produtos.reduce((s, p) => s + (p.vProd || 0), 0);
  if (total <= 0) erros.push({ campo: 'total', mensagem: 'Valor total da NF-e deve ser maior que zero' });

  return erros;
}
