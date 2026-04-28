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

  for (const linha of linhas) {
    if (!linha || linha.length < 240) continue;
    // Tipo de registro precisa ser "3" (registro de detalhe).
    if (linha.charAt(7) !== "3") continue;
    // Apenas Segmento T — Segmento U traz juros/multa/abatimento e fica
    // fora do escopo desta fase.
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

      itens.push({
        codigoOcorrencia,
        nossoNumero,
        numeroDocumento,
        valorPagoCentavos,
        dataPagamento,
        orderId,
        isPago: OCORRENCIAS_LIQUIDACAO.has(codigoOcorrencia),
        rawLine: linha,
      });
    } catch {
      // Fail-safe: linha corrompida não interrompe o parse.
      continue;
    }
  }

  return itens;
}
