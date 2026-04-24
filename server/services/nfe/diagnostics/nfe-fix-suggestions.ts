/**
 * nfe-fix-suggestions.ts
 * Gera sugestões de correção com base nos erros identificados.
 */

import type { ParsedNFeError } from './nfe-error-parser';

export interface FixSuggestion {
  campoAfetado: string;
  titulo: string;
  descricao: string;
  passos: string[];
  telaCorrecao: string;
  labelBotao: string;
  prioridade: 'CRITICA' | 'ALTA' | 'MEDIA';
}

const TELA_LABELS: Record<string, string> = {
  '/admin/company-config': 'Configuração da Empresa',
  '/admin/fiscal-config': 'Configuração Fiscal',
  '/admin/companies': 'Cadastro de Clientes',
  '/admin/products': 'Cadastro de Produtos',
  '/admin/orders': 'Pedidos',
};

const PRIORITY_MAP: Record<string, 'CRITICA' | 'ALTA' | 'MEDIA'> = {
  'emitente.cnpj': 'CRITICA',
  'emitente.cMun': 'CRITICA',
  'emitente.ie': 'ALTA',
  'emitente.xNome': 'ALTA',
  'emitente.logradouro': 'ALTA',
  'emitente.uf': 'ALTA',
  'emitente.cep': 'ALTA',
  'emitente.crt': 'ALTA',
  'destinatario.cnpj': 'CRITICA',
  'destinatario.cpf': 'CRITICA',
  'destinatario.cMun': 'ALTA',
  'produto.ncm': 'CRITICA',
  'produto.cfop': 'ALTA',
  'certificado': 'CRITICA',
  'total': 'CRITICA',
  'produtos': 'CRITICA',
};

const STEPS_MAP: Record<string, string[]> = {
  'emitente.cnpj': [
    '1. Acesse Configuração da Empresa',
    '2. Localize o campo "CNPJ"',
    '3. Informe o CNPJ correto com 14 dígitos',
    '4. Salve e tente emitir novamente',
  ],
  'emitente.cMun': [
    '1. Acesse Configuração da Empresa',
    '2. Preencha o campo "CEP" corretamente',
    '3. O sistema buscará o código IBGE automaticamente',
    '4. Verifique se a cidade está correta',
    '5. Salve e tente emitir novamente',
  ],
  'emitente.ie': [
    '1. Acesse Configuração da Empresa',
    '2. Preencha a "Inscrição Estadual" da empresa',
    '3. Para Simples Nacional isento, informe "ISENTO"',
    '4. Salve e tente emitir novamente',
  ],
  'emitente.xNome': [
    '1. Acesse Configuração da Empresa',
    '2. Preencha o campo "Razão Social"',
    '3. Salve e tente emitir novamente',
  ],
  'emitente.logradouro': [
    '1. Acesse Configuração da Empresa',
    '2. Preencha o endereço completo (logradouro, número, bairro)',
    '3. Salve e tente emitir novamente',
  ],
  'emitente.uf': [
    '1. Acesse Configuração da Empresa',
    '2. Selecione o "Estado (UF)" correto',
    '3. Salve e tente emitir novamente',
  ],
  'emitente.crt': [
    '1. Acesse Configuração Fiscal',
    '2. Configure o "Regime Tributário" (Simples Nacional, Lucro Presumido etc.)',
    '3. Salve e tente emitir novamente',
  ],
  'destinatario.cnpj': [
    '1. Acesse o Cadastro de Clientes',
    '2. Localize a empresa destinatária',
    '3. Preencha o campo "CNPJ" com 14 dígitos',
    '4. Salve e tente emitir novamente',
  ],
  'destinatario.cMun': [
    '1. Acesse o Cadastro de Clientes',
    '2. Localize a empresa destinatária',
    '3. Preencha o CEP para obter o código IBGE automaticamente',
    '4. Salve e tente emitir novamente',
  ],
  'destinatario.uf': [
    '1. Acesse o Cadastro de Clientes',
    '2. Localize a empresa destinatária',
    '3. Preencha o campo Estado/UF no endereço',
    '4. Salve e tente emitir novamente',
  ],
  'produto.ncm': [
    '1. Acesse o Cadastro de Produtos',
    '2. Localize o produto em questão',
    '3. Preencha o campo "NCM" (8 dígitos)',
    '4. Consulte a tabela NCM da Receita Federal se necessário',
    '5. Salve e tente emitir novamente',
  ],
  'produto.cfop': [
    '1. Acesse o Cadastro de Produtos ou Configuração Fiscal',
    '2. Configure o CFOP adequado (ex: 5102 para venda dentro do estado)',
    '3. Salve e tente emitir novamente',
  ],
  'certificado': [
    '1. Obtenha um certificado digital A1 (.pfx) para a empresa',
    '2. Acesse Configuração Fiscal',
    '3. Defina as variáveis CERT_PATH e CERT_PASSWORD',
    '4. Reinicie o servidor para aplicar as configurações',
    '5. Tente transmitir ao SEFAZ novamente',
  ],
  'total': [
    '1. Verifique se o pedido possui itens com valores',
    '2. Confirme que o total do pedido é maior que zero',
    '3. Tente emitir novamente',
  ],
  'produtos': [
    '1. Acesse o pedido',
    '2. Adicione pelo menos um produto',
    '3. Salve o pedido e tente emitir novamente',
  ],
};

export function generateFixSuggestion(parsed: ParsedNFeError): FixSuggestion {
  const passos = STEPS_MAP[parsed.campoAfetado] || [
    '1. Identifique o campo descrito no erro',
    '2. Acesse a tela indicada',
    '3. Corrija o valor e salve',
    '4. Tente emitir a NF-e novamente',
  ];

  const tela = TELA_LABELS[parsed.telaCorrecao] || 'Configuração';
  const prioridade = PRIORITY_MAP[parsed.campoAfetado] || 'MEDIA';

  return {
    campoAfetado: parsed.campoAfetado,
    titulo: `Erro: ${parsed.descricaoAmigavel}`,
    descricao: `Campo "${parsed.campoAfetado}" retornou erro. ${parsed.mensagemOriginal}`,
    passos,
    telaCorrecao: parsed.telaCorrecao,
    labelBotao: `Corrigir em ${tela}`,
    prioridade,
  };
}

export function generateFixSuggestions(parsedErrors: ParsedNFeError[]): FixSuggestion[] {
  const seen = new Set<string>();
  const suggestions: FixSuggestion[] = [];
  for (const e of parsedErrors) {
    if (!seen.has(e.campoAfetado)) {
      seen.add(e.campoAfetado);
      suggestions.push(generateFixSuggestion(e));
    }
  }
  suggestions.sort((a, b) => {
    const order = { CRITICA: 0, ALTA: 1, MEDIA: 2 };
    return order[a.prioridade] - order[b.prioridade];
  });
  return suggestions;
}
