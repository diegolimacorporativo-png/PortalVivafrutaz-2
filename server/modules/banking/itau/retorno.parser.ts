/**
 * CNAB 240 — Itaú (retorno / liquidação)
 *
 * FASE BANCO.3 — leitura simplificada de arquivo de retorno CNAB 240.
 * Função PURA: recebe o conteúdo do .ret e devolve a lista de eventos
 * relevantes (Segmento T) já normalizados. Não faz IO, não consulta DB,
 * não dispara baixa — quem orquestra é `retorno.service.ts`.
 *
 * Convenção de posições (CNAB 240, 1-indexed conforme manual Itaú):
 *
 *   Posição 1   →  índice 0 da string
 *   Posição N   →  índice N-1
 *   substring(start-1, end)  → extrai posições start..end inclusive
 *
 * Para um registro Segmento T (tipo 3, segmento T):
 *   - posições  8        → tipo registro = "3"
 *   - posições 14        → segmento     = "T"
 *   - posições 15-17     → código de ocorrência (3 dígitos)
 *   - posições 37-57     → nosso número (21 chars)
 *   - posições 58-72     → número do documento (15 chars) — onde achamos "PED-{orderId}"
 *   - posições 77-91     → valor pago em centavos (15 dígitos)
 *   - posições 137-144   → data do pagamento (DDMMYYYY)
 *
 * Códigos de ocorrência relevantes (Itaú):
 *   06 → Liquidação normal
 *   17 → Liquidação após baixa
 *   (outros) → ignorados nesta fase; ficam no resultado com isPago=false.
 */

export interface RetornoItauItem {
  /** Código de ocorrência normalizado para 2 dígitos. Ex.: "06" → liquidação. */
  codigoOcorrencia: string;
  /** Nosso número devolvido pelo banco (string trim). */
  nossoNumero: string;
  /** Número do documento informado na remessa (string trim). */
  numeroDocumento: string;
  /** Valor pago — string com 15 dígitos em centavos (sem decimal). */
  valorPagoCentavos: string;
  /** Data do pagamento (DDMMYYYY) ou string vazia. */
  dataPagamento: string;
  /** orderId extraído do número do documento ("PED-123") ou null. */
  orderId: number | null;
  /** True quando codigoOcorrencia indica liquidação (06 ou 17). */
  isPago: boolean;
  /** Linha original (debug). */
  rawLine: string;
  /**
   * FASE 6.2 — Segmento U (juros / multa / desconto) em centavos como número.
   * Vem 0 quando o título não tinha Segmento U pareado, ou quando o Itaú
   * enviou os campos zerados. Não há diferença semântica entre os dois.
   */
  jurosCentavos: number;
  multaCentavos: number;
  descontoCentavos: number;
}

/**
 * FASE 6.2 — dados extraídos de um Segmento U.
 *
 * O Segmento U vem SEMPRE pareado com um Segmento T do mesmo título
 * (mesmo `nossoNumero`). Ele transporta os valores acessórios da
 * liquidação: juros, multa e descontos/abatimentos.
 *
 * Em FASE 6.2 esses dados são apenas extraídos e propagados em memória
 * (parser → service → repository signature). A persistência separada
 * fica para FASE 6.3.
 */
interface SegmentoUData {
  jurosCentavos: number;
  multaCentavos: number;
  descontoCentavos: number;
}

const OCORRENCIAS_LIQUIDACAO = new Set(["06", "17"]);

/** Extrai orderId de "PED-123" (ou variantes "PED 123", "PED123"). */
function extractOrderIdFromDocumento(doc: string): number | null {
  const m = doc.match(/PED[\s\-]?(\d+)/i);
  if (!m || !m[1]) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Faz parse do conteúdo de um arquivo CNAB 240 de retorno do Itaú.
 * Retorna apenas os Segmentos T encontrados (1 por título).
 *
 * Tolerante:
 *   • aceita linhas com CR/LF;
 *   • ignora linhas com tamanho < 240 (cabeçalhos malformados, EOF);
 *   • nunca lança — se a linha for inválida, ela é silenciosamente pulada.
 */
export function parseItauRetornoCnab240(content: string): RetornoItauItem[] {
  if (!content) return [];

  const linhas = content.split(/\r?\n/);
  const itens: RetornoItauItem[] = [];

  // FASE 6.2 — primeiro passe: indexa Segmentos U por `nossoNumero`.
  // Vínculo T↔U é por `nossoNumero` (chave do título no banco). Fazemos
  // duas passadas para manter o parsing de T 100% intacto e adicionar U
  // de forma puramente aditiva. Custo: O(N) — uma varredura extra.
  const segmentoUMap = new Map<string, SegmentoUData>();
  for (const linha of linhas) {
    if (!linha || linha.length < 240) continue;
    if (linha.charAt(7) !== "3") continue;
    if (linha.charAt(13) !== "U") continue;

    try {
      // Posições conforme manual Itaú CNAB 240 (Segmento U):
      //   18-32  → juros / encargos     (15 dígitos, centavos)
      //   33-47  → desconto concedido   (15 dígitos, centavos)
      //   48-62  → abatimento concedido (15 dígitos, centavos)
      //   78-92  → multa (raramente usada — fallback)
      // Mantemos a mesma filosofia do T: extrair sem validar profundamente.
      // O `nossoNumero` está em posição diferente do T (38-57, 20 chars),
      // mas ambos passam por `.trim()`, então a chave do Map bate.
      const nossoNumero = linha.substring(37, 57).trim();
      const jurosCentavos = Number(linha.substring(17, 32)) || 0;
      const descontoCentavos = Number(linha.substring(32, 47)) || 0;
      const abatimentoCentavos = Number(linha.substring(47, 62)) || 0;
      const multaCentavos = Number(linha.substring(77, 92)) || 0;

      segmentoUMap.set(nossoNumero, {
        jurosCentavos,
        multaCentavos,
        // Tratamos abatimento como desconto para esta fase — ambos reduzem
        // o valor recebido e não há campo separado downstream.
        descontoCentavos: descontoCentavos + abatimentoCentavos,
      });
    } catch {
      // Fail-safe: U corrompido não bloqueia o T correspondente — o
      // título cai no `?? 0` na hora do enrich.
      continue;
    }
  }

  // Segundo passe: percorre Segmentos T (lógica original preservada) e
  // enriquece com U via lookup no Map.
  for (const linha of linhas) {
    if (!linha || linha.length < 240) continue;
    // Tipo de registro precisa ser "3" (registro de detalhe).
    if (linha.charAt(7) !== "3") continue;
    // Apenas Segmento T nesta passada — U já foi consumido acima.
    if (linha.charAt(13) !== "T") continue;

    try {
      // Posições 15-17 = 3 chars. O Itaú usa códigos de 2 dígitos ("06",
      // "17"); dependendo da impressão, vem como "006", "06 ", " 06" ou
      // "06". Normalizamos para 2 dígitos com zero à esquerda para
      // matchar o spec ("codigoOcorrencia === '06'") em todos os casos.
      const codigoOcorrenciaRaw = linha.substring(14, 17);
      const codigoOcorrencia = codigoOcorrenciaRaw
        .replace(/\D/g, "")
        .padStart(2, "0")
        .slice(-2);
      const nossoNumero = linha.substring(36, 57).trim();
      const numeroDocumento = linha.substring(57, 72).trim();
      const valorPagoCentavos = linha.substring(76, 91);
      const dataPagamento = linha.substring(136, 144);
      const orderId = extractOrderIdFromDocumento(numeroDocumento);

      // FASE 6.2 — enrich com U pareado (default 0 quando ausente).
      const u = segmentoUMap.get(nossoNumero);

      itens.push({
        codigoOcorrencia,
        nossoNumero,
        numeroDocumento,
        valorPagoCentavos,
        dataPagamento,
        orderId,
        isPago: OCORRENCIAS_LIQUIDACAO.has(codigoOcorrencia),
        rawLine: linha,
        jurosCentavos: u?.jurosCentavos ?? 0,
        multaCentavos: u?.multaCentavos ?? 0,
        descontoCentavos: u?.descontoCentavos ?? 0,
      });
    } catch {
      // Fail-safe: linha corrompida não interrompe o parse.
      continue;
    }
  }

  return itens;
}
