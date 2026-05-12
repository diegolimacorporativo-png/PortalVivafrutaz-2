/**
 * FASE NF-e 1.2 — T1202: XML Guard
 *
 * Valida o XML ANTES de enviar ao SEFAZ. Bloqueia explicitamente:
 *   - XML vazio ou não-string
 *   - XML sem declaração <?xml
 *   - XML sem tag <NFe> ou <envEvento> (estrutura básica)
 *   - XML sem assinatura <Signature (ainda não assinado)
 *   - XML contendo NaN/undefined (montagem corrompida)
 *
 * Chamado por enviarNFeSEFAZ, cancelarNFe e enviarCCe ANTES do axios.
 * Não modifica o XML — só valida. Lança NFE_XML_GUARD_* errors.
 *
 * NOTA: validação contra XSD oficial da SEFAZ requer biblioteca externa
 * (libxmljs2/xsd-schema-validator) + arquivos .xsd. Documentado como gap
 * pendente de instalação em ambiente produtivo.
 */

export type NFeXmlKind = "nfe" | "evento";

export interface XmlGuardOptions {
  kind: NFeXmlKind;
  /** Identificador de correlação para rastreabilidade nos logs. */
  requestId?: string;
  /** orderId ou chaveNFe para contexto no log de erro. */
  context?: string | number;
}

/**
 * Valida o XML assinado antes de enviar ao SEFAZ.
 * Lança Error com código NFE_XML_GUARD_* se inválido.
 */
export function validateXmlBeforeSend(xml: unknown, opts: XmlGuardOptions): void {
  const { kind, requestId = "n/a", context = "" } = opts;

  const logCtx = { kind, requestId, context };

  // 1. Tipo + vazio
  if (typeof xml !== "string" || xml.length === 0) {
    console.error("[NFE_XML_GUARD_EMPTY]", logCtx);
    throw new Error("NFE_XML_GUARD_EMPTY");
  }

  // 2. Declaração XML
  if (!xml.startsWith("<?xml")) {
    console.error("[NFE_XML_GUARD_NO_DECL]", logCtx);
    throw new Error("NFE_XML_GUARD_NO_DECL");
  }

  // 3. Tag raiz correta por tipo
  if (kind === "nfe") {
    if (!xml.includes("<NFe") || !xml.includes("</NFe>")) {
      console.error("[NFE_XML_GUARD_MISSING_NFE]", logCtx);
      throw new Error("NFE_XML_GUARD_MISSING_NFE");
    }
    // infNFe Id obrigatório
    if (!xml.includes("infNFe")) {
      console.error("[NFE_XML_GUARD_MISSING_INFNFE]", logCtx);
      throw new Error("NFE_XML_GUARD_MISSING_INFNFE");
    }
  } else {
    // evento: cancelamento ou CC-e
    if (!xml.includes("<envEvento") || !xml.includes("</envEvento>")) {
      console.error("[NFE_XML_GUARD_MISSING_EVENTO]", logCtx);
      throw new Error("NFE_XML_GUARD_MISSING_EVENTO");
    }
    if (!xml.includes("<infEvento") || !xml.includes("</infEvento>")) {
      console.error("[NFE_XML_GUARD_MISSING_INFEVENTO]", logCtx);
      throw new Error("NFE_XML_GUARD_MISSING_INFEVENTO");
    }
  }

  // 4. Assinatura digital — DEVE estar presente
  if (!xml.includes("<Signature") || !xml.includes("</Signature>")) {
    console.error("[NFE_XML_GUARD_UNSIGNED]", logCtx);
    throw new Error("NFE_XML_GUARD_UNSIGNED");
  }

  // 5. Conteúdo corrompido
  if (xml.includes("NaN") || xml.includes("undefined")) {
    console.error("[NFE_XML_GUARD_CORRUPTED_CONTENT]", logCtx);
    throw new Error("NFE_XML_GUARD_CORRUPTED_CONTENT");
  }

  // 6. Tamanho mínimo razoável (< 500 bytes é suspeito para qualquer NF-e)
  if (xml.length < 500) {
    console.error("[NFE_XML_GUARD_TOO_SHORT]", { ...logCtx, length: xml.length });
    throw new Error("NFE_XML_GUARD_TOO_SHORT");
  }

  console.info("[NFE_XML_GUARD_OK]", { ...logCtx, length: xml.length });
}
