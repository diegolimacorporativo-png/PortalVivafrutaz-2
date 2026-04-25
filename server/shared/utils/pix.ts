/**
 * buildPixPayload — generates a PIX Copia e Cola (BR Code) string.
 *
 * Follows the BACEN EMV QR Code specification for instant payments.
 * Extracted as a shared utility because it is needed by both the
 * workflow transaction (INVOICED → AR seeding) and the legacy
 * PATCH /orders/:id CONFIRMED path (seedAccountReceivableOnConfirm).
 *
 * @param cnpj        Recipient CNPJ (digits only or formatted — both accepted).
 * @param total       Payment amount in BRL (e.g. 150.00).
 * @param companyName Recipient name shown in the payer's app (≤ 25 chars).
 * @param city        Recipient city shown in the payer's app (≤ 15 chars).
 */
export function buildPixPayload(
  cnpj: string,
  total: number,
  companyName?: string,
  city?: string,
): string {
  const chave = String(cnpj).replace(/\D/g, "");

  /** Remove non-alphanumeric/space chars and clamp length. */
  const sanitize = (s: string, max: number) =>
    (s || "").replace(/[^\w\s]/gi, "").slice(0, max).trim() || "VIVA";

  /** EMV TLV (Tag-Length-Value) encoder. */
  const tlv = (idTag: string, v: string) =>
    `${idTag}${String(v.length).padStart(2, "0")}${v}`;

  const merchant = tlv("00", "br.gov.bcb.pix") + tlv("01", chave.slice(0, 77));
  const addData  = tlv("62", tlv("05", `AR${Date.now().toString().slice(-10)}`));

  let payload =
    tlv("00", "01") +
    tlv("26", merchant) +
    tlv("52", "0000") +
    tlv("53", "986") +
    tlv("54", total.toFixed(2)) +
    tlv("58", "BR") +
    tlv("59", sanitize(companyName || "VIVAFRUTAZ", 25)) +
    tlv("60", sanitize(city || "SAOPAULO", 15)) +
    addData +
    "6304";

  // CRC-16/CCITT-FALSE — required by the BACEN spec.
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }

  return payload + (crc & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}
