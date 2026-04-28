/**
 * CNAB 240 — Itaú (cobrança / remessa)
 *
 * FASE BANCO.1 — geração simplificada de arquivo de remessa CNAB 240
 * para envio ao Banco Itaú (código 341). Implementação ADITIVA: não altera
 * nenhum módulo existente, apenas LÊ os dados (`accounts_receivable`) e
 * exporta no layout posicional padrão CNAB 240.
 *
 * Estrutura gerada:
 *   1× HEADER DO ARQUIVO   (lote 0000, registro 0)
 *   1× HEADER DO LOTE      (lote 0001, registro 1)
 *   N× SEGMENTO P          (registro 3, segmento P — dados do título)
 *   N× SEGMENTO Q          (registro 3, segmento Q — dados do sacado)
 *   1× TRAILER DO LOTE     (registro 5)
 *   1× TRAILER DO ARQUIVO  (registro 9)
 *
 * Cada linha tem exatamente 240 caracteres. Linhas separadas por "\n".
 * Não validamos conformidade total com o manual Itaú v087: o objetivo
 * desta fase é gerar um arquivo estruturalmente válido (240 chars/linha,
 * tipos de registro corretos, totalizadores coerentes) que possa ser
 * baixado, inspecionado e usado como base para a fase 2 (envio real).
 */

const BANCO_ITAU = "341";
const LAYOUT_VERSION_ARQUIVO = "087";
const LAYOUT_VERSION_LOTE = "045";

// ── Helpers de formatação posicional ────────────────────────────────────

/** Pad numérico à esquerda com zeros, truncando se exceder o tamanho. */
function padN(value: string | number, length: number): string {
  const raw = String(value ?? "").replace(/\D/g, "");
  if (raw.length >= length) return raw.slice(-length);
  return raw.padStart(length, "0");
}

/** Pad alfanumérico à direita com espaços, truncando se exceder. */
function padA(value: string, length: number): string {
  const raw = (value ?? "").toString().toUpperCase();
  if (raw.length >= length) return raw.slice(0, length);
  return raw.padEnd(length, " ");
}

/** Brancos. */
function blanks(length: number): string {
  return " ".repeat(length);
}

/** Zeros. */
function zeros(length: number): string {
  return "0".repeat(length);
}

/** YYYY-MM-DD ou Date → DDMMYYYY. */
function fmtDate(input: string | Date | null | undefined): string {
  if (!input) return "00000000";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "00000000";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}${mm}${yyyy}`;
}

/** HHMMSS atual. */
function fmtNow(): string {
  const d = new Date();
  return (
    String(d.getHours()).padStart(2, "0") +
    String(d.getMinutes()).padStart(2, "0") +
    String(d.getSeconds()).padStart(2, "0")
  );
}

/** Valor decimal → inteiro em centavos, sem separador, padronizado. */
function valorEmCentavos(valor: string | number, length: number): string {
  const n = typeof valor === "number" ? valor : parseFloat(String(valor || "0"));
  if (!Number.isFinite(n)) return zeros(length);
  const centavos = Math.round(n * 100);
  return padN(centavos, length);
}

// ── Tipo de entrada (esperado pelo gerador) ──────────────────────────────

export interface CnabRemessaItem {
  /** ID interno (orderId ou ar.id) — usado em "número do documento". */
  id: number;
  /** Valor em reais (string ou number). */
  valor: string | number;
  /** YYYY-MM-DD. */
  dataVencimento: string | Date;
  /** Texto livre — vai como "número do documento" se id ausente. */
  descricao?: string;
  /** Identificação interna (orderId, se houver). */
  orderId?: number | null;
  /** Sacado — opcional; se ausente usamos mock (fase 1). */
  sacado?: {
    nome?: string;
    documento?: string; // CPF/CNPJ apenas dígitos
    endereco?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;
    cep?: string;
  };
}

export interface CnabRemessaContext {
  /** CNPJ do cedente (empresa) — apenas dígitos. */
  cnpjCedente?: string;
  /** Nome do cedente (até 30 chars). */
  nomeCedente?: string;
  /** Agência (sem dígito). */
  agencia?: string;
  /** Conta corrente (sem dígito). */
  conta?: string;
  /** Dígito verificador da conta. */
  dacConta?: string;
  /** Número sequencial do arquivo (NSA). */
  nsa?: number;
  /** Carteira de cobrança Itaú (ex.: 109, 175, 198). */
  carteira?: string;
}

// ── Registros ────────────────────────────────────────────────────────────

function buildHeaderArquivo(ctx: CnabRemessaContext): string {
  const linha =
    BANCO_ITAU + // 001-003
    "0000" + // 004-007 lote
    "0" + // 008 tipo registro
    blanks(9) + // 009-017 CNAB
    "2" + // 018 tipo inscrição (2=CNPJ)
    padN(ctx.cnpjCedente || "0", 14) + // 019-032 CNPJ
    blanks(20) + // 033-052 uso exclusivo Itaú
    padN(ctx.agencia || "0", 5) + // 053-057 agência
    blanks(1) + // 058 DAC agência
    padN(ctx.conta || "0", 12) + // 059-070 conta
    padN(ctx.dacConta || "0", 1) + // 071 DAC conta
    blanks(1) + // 072 DAC agência/conta
    padA(ctx.nomeCedente || "EMPRESA", 30) + // 073-102
    padA("BANCO ITAU SA", 30) + // 103-132
    blanks(10) + // 133-142
    "1" + // 143 código remessa (1=remessa, 2=retorno)
    fmtDate(new Date()) + // 144-151 data geração
    fmtNow() + // 152-157 hora geração
    padN(ctx.nsa ?? 1, 6) + // 158-163 NSA
    LAYOUT_VERSION_ARQUIVO + // 164-166 versão layout (087)
    zeros(5) + // 167-171 densidade
    blanks(20) + // 172-191
    blanks(20) + // 192-211 reservado banco
    blanks(29); // 212-240 reservado empresa

  return ensure240(linha, "HEADER_ARQUIVO");
}

function buildHeaderLote(ctx: CnabRemessaContext): string {
  const linha =
    BANCO_ITAU + // 001-003
    "0001" + // 004-007 lote
    "1" + // 008 tipo registro
    "R" + // 009 tipo operação (R=remessa)
    "01" + // 010-011 tipo serviço (01=cobrança)
    "00" + // 012-013 forma lançamento
    LAYOUT_VERSION_LOTE + // 014-016 versão layout do lote
    blanks(1) + // 017
    "2" + // 018 tipo inscrição empresa (2=CNPJ)
    padN(ctx.cnpjCedente || "0", 15) + // 019-033 CNPJ (com 1 a mais)
    blanks(20) + // 034-053
    padN(ctx.agencia || "0", 5) + // 054-058
    blanks(1) + // 059
    padN(ctx.conta || "0", 12) + // 060-071
    padN(ctx.dacConta || "0", 1) + // 072
    blanks(1) + // 073
    padA(ctx.nomeCedente || "EMPRESA", 30) + // 074-103
    blanks(40) + // 104-143 mensagem 1
    blanks(40) + // 144-183 mensagem 2
    padN(ctx.nsa ?? 1, 8) + // 184-191 número remessa
    fmtDate(new Date()) + // 192-199 data gravação
    "00000000" + // 200-207 data crédito
    blanks(33); // 208-240

  return ensure240(linha, "HEADER_LOTE");
}

function buildSegmentoP(
  item: CnabRemessaItem,
  ctx: CnabRemessaContext,
  numRegistro: number,
): string {
  const carteira = ctx.carteira || "109";
  const nossoNumero = padN(item.id, 8);
  const linha =
    BANCO_ITAU + // 001-003
    "0001" + // 004-007 lote
    "3" + // 008 tipo registro
    padN(numRegistro, 5) + // 009-013 nº seq registro no lote
    "P" + // 014 segmento
    blanks(1) + // 015
    "01" + // 016-017 código instrução (01=entrada de título)
    padN(ctx.agencia || "0", 5) + // 018-022
    blanks(1) + // 023
    padN(ctx.conta || "0", 12) + // 024-035
    padN(ctx.dacConta || "0", 1) + // 036
    blanks(1) + // 037
    padA(carteira, 3) + // 038-040 carteira
    nossoNumero + // 041-048 nosso número (8)
    blanks(7) + // 049-055
    "0" + // 056 dígito ag/conta
    padA(String(item.id), 15) + // 057-071 número documento
    fmtDate(item.dataVencimento) + // 072-079 vencimento
    valorEmCentavos(item.valor, 15) + // 080-094 valor título
    "00000" + // 095-099 agência cobradora
    "0" + // 100 DAC ag cobradora
    "01" + // 101-102 espécie título (01=duplicata)
    "N" + // 103 aceite
    fmtDate(new Date()) + // 104-111 data emissão
    "0" + // 112 código juros mora
    "00000000" + // 113-120 data juros
    zeros(15) + // 121-135 valor juros
    "0" + // 136 código desconto 1
    "00000000" + // 137-144 data desconto
    zeros(15) + // 145-159 valor desconto
    zeros(15) + // 160-174 valor IOF
    zeros(15) + // 175-189 valor abatimento
    padA(item.descricao || `PED-${item.orderId ?? item.id}`, 25) + // 190-214 ident título empresa
    "3" + // 215 código protesto (3=não protestar)
    "00" + // 216-217 prazo protesto
    "1" + // 218 código baixa (1=baixar)
    "090" + // 219-221 prazo baixa (dias)
    "00" + // 222-223 moeda
    zeros(10) + // 224-233 nº contrato
    blanks(7); // 234-240

  return ensure240(linha, "SEGMENTO_P");
}

function buildSegmentoQ(
  item: CnabRemessaItem,
  ctx: CnabRemessaContext,
  numRegistro: number,
): string {
  // Fase 1: sacado mockado se não vier no item.
  const sacado = item.sacado ?? {};
  const documento = (sacado.documento || "00000000000").replace(/\D/g, "");
  const tipoInscricao = documento.length > 11 ? "2" : "1"; // 1=CPF, 2=CNPJ

  const linha =
    BANCO_ITAU + // 001-003
    "0001" + // 004-007 lote
    "3" + // 008 tipo registro
    padN(numRegistro, 5) + // 009-013 nº seq registro no lote
    "Q" + // 014 segmento
    blanks(1) + // 015
    "01" + // 016-017 código instrução
    tipoInscricao + // 018 tipo inscrição sacado
    padN(documento, 15) + // 019-033 doc sacado
    padA(sacado.nome || "CLIENTE", 40) + // 034-073 nome sacado
    padA(sacado.endereco || "ENDERECO NAO INFORMADO", 40) + // 074-113
    padA(sacado.bairro || "CENTRO", 15) + // 114-128
    padN(sacado.cep || "0", 8) + // 129-136 CEP
    padA(sacado.cidade || "SAO PAULO", 15) + // 137-151
    padA(sacado.uf || "SP", 2) + // 152-153
    "0" + // 154 tipo inscrição sacador
    zeros(15) + // 155-169 doc sacador
    padA("", 40) + // 170-209 nome sacador
    "000" + // 210-212 banco correspondente
    blanks(20) + // 213-232 nosso nº correspondente
    blanks(8); // 233-240

  return ensure240(linha, "SEGMENTO_Q");
}

function buildTrailerLote(qtdRegistrosLote: number): string {
  const linha =
    BANCO_ITAU + // 001-003
    "0001" + // 004-007
    "5" + // 008 tipo registro
    blanks(9) + // 009-017
    padN(qtdRegistrosLote, 6) + // 018-023 qtd registros no lote
    zeros(6) + // 024-029 qtd cobrança simples
    zeros(17) + // 030-046 valor cobrança simples
    zeros(6) + // 047-052
    zeros(17) + // 053-069
    zeros(6) + // 070-075
    zeros(17) + // 076-092
    blanks(8) + // 093-100 número aviso lançamento
    blanks(117) + // 101-217
    blanks(23); // 218-240

  return ensure240(linha, "TRAILER_LOTE");
}

function buildTrailerArquivo(qtdRegistros: number): string {
  const linha =
    BANCO_ITAU + // 001-003
    "9999" + // 004-007 lote
    "9" + // 008 tipo registro
    blanks(9) + // 009-017
    "000001" + // 018-023 qtd lotes
    padN(qtdRegistros, 6) + // 024-029 qtd registros total
    "000000" + // 030-035 qtd contas concil
    blanks(205); // 036-240

  return ensure240(linha, "TRAILER_ARQUIVO");
}

/** Garante exatamente 240 caracteres — fail-safe defensivo. */
function ensure240(linha: string, tag: string): string {
  if (linha.length === 240) return linha;
  if (linha.length > 240) {
    console.warn(`[CNAB] ${tag} excedeu 240 (${linha.length}) — truncando.`);
    return linha.slice(0, 240);
  }
  console.warn(`[CNAB] ${tag} aquém de 240 (${linha.length}) — completando com brancos.`);
  return linha.padEnd(240, " ");
}

// ── API pública ──────────────────────────────────────────────────────────

/**
 * Gera o conteúdo (string) de um arquivo CNAB 240 de remessa Itaú.
 * Recebe a lista de remessas (geralmente uma por AR) e o contexto da
 * empresa/conta cedente. Retorna string com linhas separadas por "\n".
 *
 * Não persiste nada. Não dispara IO. Função pura.
 */
export function generateItauCnab240(
  remessas: CnabRemessaItem[],
  ctx: CnabRemessaContext = {},
): string {
  const linhas: string[] = [];

  linhas.push(buildHeaderArquivo(ctx));
  linhas.push(buildHeaderLote(ctx));

  let numRegistroLote = 0;
  for (const item of remessas) {
    numRegistroLote += 1;
    linhas.push(buildSegmentoP(item, ctx, numRegistroLote));
    numRegistroLote += 1;
    linhas.push(buildSegmentoQ(item, ctx, numRegistroLote));
  }

  // Trailer lote: qtd = header(1) + N detalhes + trailer(1) = 2 + N
  const qtdRegistrosLote = 2 + numRegistroLote;
  linhas.push(buildTrailerLote(qtdRegistrosLote));

  // Trailer arquivo: qtd total = header arquivo + lote completo + trailer arquivo
  const qtdRegistrosArquivo = linhas.length + 1;
  linhas.push(buildTrailerArquivo(qtdRegistrosArquivo));

  return linhas.join("\n");
}
