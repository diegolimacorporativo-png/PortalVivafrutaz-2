import axios from 'axios';

export interface ItauConfig {
  clientId: string;
  clientSecret: string;
  agencia: string;
  conta: string;
  ambiente: 'sandbox' | 'producao';
}

export interface ItauTransaction {
  id: string;
  tipo: 'credito' | 'debito';
  valor: number;
  data: string;
  descricao: string;
  documento?: string;
  saldoApos?: number;
}

export interface ItauSaldo {
  saldo: number;
  dataConsulta: string;
}

export interface ItauBoleto {
  codigoBarras: string;
  linhaDigitavel: string;
  nossoNumero: string;
  vencimento: string;
  valor: number;
  sacado: string;
  status: string;
}

const ITAU_AUTH_URL_SANDBOX = 'https://sts.itau.com.br/api/oauth/token';
const ITAU_AUTH_URL_PRODUCAO = 'https://sts.itau.com.br/api/oauth/token';
const ITAU_API_BASE_SANDBOX = 'https://api.itau.com.br';
const ITAU_API_BASE_PRODUCAO = 'https://api.itau.com.br';

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(config: ItauConfig): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;

  const authUrl = config.ambiente === 'sandbox' ? ITAU_AUTH_URL_SANDBOX : ITAU_AUTH_URL_PRODUCAO;
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

  const response = await axios.post(authUrl,
    'grant_type=client_credentials&scope=cash_management',
    {
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 10000,
    }
  );

  const { access_token, expires_in } = response.data;
  tokenCache = {
    token: access_token,
    expiresAt: Date.now() + (expires_in - 60) * 1000,
  };
  return access_token;
}

function getApiBase(config: ItauConfig): string {
  return config.ambiente === 'sandbox' ? ITAU_API_BASE_SANDBOX : ITAU_API_BASE_PRODUCAO;
}

export async function getItauSaldo(config: ItauConfig): Promise<ItauSaldo> {
  const token = await getAccessToken(config);
  const base = getApiBase(config);
  const response = await axios.get(
    `${base}/cash_management/v2/saldo/conta-corrente`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-itau-apikey': config.clientId,
        'x-itau-agencia': config.agencia,
        'x-itau-conta': config.conta,
        'x-itau-tipo-conta': 'CCI',
      },
      timeout: 15000,
    }
  );
  const d = response.data;
  return {
    saldo: parseFloat(d.saldo_disponivel || d.saldo || '0'),
    dataConsulta: d.data_saldo || new Date().toISOString().split('T')[0],
  };
}

export async function getItauExtrato(
  config: ItauConfig,
  dataInicio: string,
  dataFim: string
): Promise<ItauTransaction[]> {
  const token = await getAccessToken(config);
  const base = getApiBase(config);
  const response = await axios.get(
    `${base}/cash_management/v2/extrato/conta-corrente`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-itau-apikey': config.clientId,
        'x-itau-agencia': config.agencia,
        'x-itau-conta': config.conta,
        'x-itau-tipo-conta': 'CCI',
      },
      params: {
        data_inicio: dataInicio,
        data_fim: dataFim,
      },
      timeout: 15000,
    }
  );

  const lancamentos = response.data?.lancamentos || response.data?.data || [];
  return lancamentos.map((l: any) => ({
    id: l.id_lancamento || l.codigo || String(Math.random()),
    tipo: (l.tipo_lancamento === 'C' || l.indicador_dc === 'C') ? 'credito' : 'debito',
    valor: Math.abs(parseFloat(l.valor || '0')),
    data: l.data_lancamento || l.data || '',
    descricao: l.descricao || l.historico || '',
    documento: l.documento || l.numero_documento || '',
    saldoApos: parseFloat(l.saldo_apos || '0'),
  }));
}

export async function criarBoletItau(
  config: ItauConfig,
  dados: {
    valor: number;
    vencimento: string;
    sacadoNome: string;
    sacadoCnpjCpf: string;
    sacadoLogradouro: string;
    sacadoCidade: string;
    sacadoUf: string;
    sacadoCep: string;
    nossoNumero: string;
    instrucoes?: string;
  }
): Promise<ItauBoleto> {
  const token = await getAccessToken(config);
  const base = getApiBase(config);

  const payload = {
    beneficiario: {
      id_beneficiario: config.conta,
    },
    dado_boleto: {
      tipo_boleto: 'a vista',
      tipo_especie: 'DM',
      valor_total_titulo: dados.valor.toFixed(2),
      data_vencimento: dados.vencimento,
      numero_nosso_numero: dados.nossoNumero,
      codigo_carteira: '109',
      mensagem: {
        instrucao_linha_1: dados.instrucoes || 'Não receber após o vencimento.',
        instrucao_linha_2: '',
        instrucao_linha_3: '',
      },
    },
    sacado: {
      tipo_pessoa: dados.sacadoCnpjCpf.replace(/\D/g, '').length === 14 ? 'PJ' : 'PF',
      nome_sacado: dados.sacadoNome.slice(0, 45),
      cnpj_cpf: dados.sacadoCnpjCpf.replace(/\D/g, ''),
      endereco: dados.sacadoLogradouro.slice(0, 45),
      cidade: dados.sacadoCidade.slice(0, 20),
      estado: dados.sacadoUf,
      cep: dados.sacadoCep.replace(/\D/g, ''),
    },
  };

  const response = await axios.post(
    `${base}/cash_management/v2/boletos`,
    payload,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-itau-apikey': config.clientId,
        'x-itau-agencia': config.agencia,
        'x-itau-conta': config.conta,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );

  const d = response.data;
  return {
    codigoBarras: d.codigo_barras || '',
    linhaDigitavel: d.linha_digitavel || '',
    nossoNumero: d.numero_nosso_numero || dados.nossoNumero,
    vencimento: dados.vencimento,
    valor: dados.valor,
    sacado: dados.sacadoNome,
    status: d.situacao_boleto || 'emitido',
  };
}

export async function consultarBoletItau(
  config: ItauConfig,
  nossoNumero: string
): Promise<ItauBoleto> {
  const token = await getAccessToken(config);
  const base = getApiBase(config);
  const response = await axios.get(
    `${base}/cash_management/v2/boletos/${nossoNumero}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'x-itau-apikey': config.clientId,
        'x-itau-agencia': config.agencia,
        'x-itau-conta': config.conta,
      },
      timeout: 10000,
    }
  );
  const d = response.data;
  return {
    codigoBarras: d.codigo_barras || '',
    linhaDigitavel: d.linha_digitavel || '',
    nossoNumero: d.numero_nosso_numero || nossoNumero,
    vencimento: d.data_vencimento || '',
    valor: parseFloat(d.valor_total_titulo || '0'),
    sacado: d.sacado?.nome_sacado || '',
    status: d.situacao_boleto || 'desconhecido',
  };
}

export function getItauConfigFromEnv(): ItauConfig | null {
  const clientId = process.env.ITAU_CLIENT_ID;
  const clientSecret = process.env.ITAU_CLIENT_SECRET;
  const agencia = process.env.ITAU_AGENCIA;
  const conta = process.env.ITAU_CONTA;
  if (!clientId || !clientSecret || !agencia || !conta) return null;
  return {
    clientId, clientSecret, agencia, conta,
    ambiente: (process.env.ITAU_AMBIENTE as 'sandbox' | 'producao') || 'sandbox',
  };
}
