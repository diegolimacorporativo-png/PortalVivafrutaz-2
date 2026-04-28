/**
 * FASE FISCAL 8.1 — mapa de correção semi-automática de NF-e.
 *
 * Função PURA, sem IO, sem efeitos colaterais. Mapeia o `cStat` retornado
 * pela SEFAZ em uma sugestão estruturada que o frontend usa para decidir:
 *   • qual MENSAGEM exibir ao operador
 *   • qual TIPO de correção (RECALCULAR / VALIDAR_XML / REEMITIR / MANUAL)
 *   • se o botão "Corrigir e Reenviar" deve aparecer (apenas quando
 *     `tipo` ∈ {RECALCULAR, REEMITIR})
 *
 * Escopo intencionalmente CURTO. Por design (ver spec 8.1) cobrimos
 * apenas os 4 códigos de rejeição mais frequentes e operacionalmente
 * recuperáveis sem necessidade de intervenção fiscal especializada.
 * Códigos fora do mapa caem em MANUAL — o sistema NÃO tenta adivinhar.
 *
 *   533 → divergência no total de ICMS (recalcular pedido + reemitir)
 *   215 → falha de schema XML (revisar dados do pedido)
 *   539 → duplicidade de NF-e (gerar nova numeração)
 *   110 → uso indevido / NF-e denegada (intervenção manual obrigatória)
 *
 * Garantias:
 *   • NÃO altera estrutura do XML
 *   • NÃO altera cálculo de impostos
 *   • NÃO altera getAliquotaICMS
 *   • Não conhece/depende de tenant — é apenas uma tabela de tradução
 */

export type CorrecaoTipo = 'RECALCULAR' | 'VALIDAR_XML' | 'REEMITIR' | 'MANUAL';

export interface CorrecaoSugerida {
  /**
   * Discriminador usado pelo backend (`/corrigir-reenviar`) para decidir se
   * pode reaproveitar o fluxo de emissão e pelo frontend para decidir se
   * exibe o botão "Corrigir e Reenviar".
   */
  tipo: CorrecaoTipo;
  /**
   * Texto curto, humano, em PT-BR, exibido no card de motivos de rejeição.
   * Nunca contém PII — apenas instrução genérica de correção.
   */
  mensagem: string;
}

/**
 * Devolve a sugestão de correção para um `cStat` SEFAZ.
 *
 * @param cStat código de status retornado pela SEFAZ na rejeição
 *              (string de 3 dígitos). `undefined` ou desconhecido cai em MANUAL.
 */
export function getCorrecaoSugerida(cStat?: string | null): CorrecaoSugerida {
  switch (cStat) {
    case '533':
      return {
        tipo: 'RECALCULAR',
        mensagem:
          'Diferença no total de ICMS. Recalcular valores da nota a partir do pedido e reemitir.',
      };
    case '215':
      return {
        tipo: 'VALIDAR_XML',
        mensagem:
          'Erro de schema XML. Verificar estrutura da nota e campos obrigatórios do pedido.',
      };
    case '539':
      return {
        tipo: 'REEMITIR',
        mensagem:
          'Duplicidade de NF-e detectada. Gerar nova NF-e com numeração distinta.',
      };
    case '110':
      return {
        tipo: 'MANUAL',
        mensagem:
          'Uso indevido / NF-e denegada pela SEFAZ. Intervenção fiscal manual é obrigatória.',
      };
    default:
      return {
        tipo: 'MANUAL',
        mensagem:
          'Erro fora do catálogo de correção semi-automática. Revisar pedido manualmente conforme retorno da SEFAZ antes de reemitir.',
      };
  }
}
