import { deflateRawSync, inflateRawSync } from "node:zlib";

interface ZipEntry {
  name: string;
  data: Buffer;
  versionMadeBy: number;
  versionNeeded: number;
  flags: number;
  method: number;
  time: number;
  date: number;
  internalAttributes: number;
  externalAttributes: number;
}

export type XlsxCellUpdate = { value: string | number | null; formula?: string; preserveFormula?: boolean };

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function readZip(input: Buffer): ZipEntry[] {
  let end = -1;
  for (let offset = input.length - 22; offset >= Math.max(0, input.length - 65_557); offset--) {
    if (input.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new Error("Modelo XLSX inválido: diretório ZIP ausente.");
  const entryCount = input.readUInt16LE(end + 10);
  if (entryCount === 0xffff) throw new Error("Modelo XLSX ZIP64 não é suportado.");
  let cursor = input.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < entryCount; index++) {
    if (input.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Modelo XLSX inválido: diretório ZIP corrompido.");
    const versionMadeBy = input.readUInt16LE(cursor + 4);
    const versionNeeded = input.readUInt16LE(cursor + 6);
    const flags = input.readUInt16LE(cursor + 8);
    const method = input.readUInt16LE(cursor + 10);
    const time = input.readUInt16LE(cursor + 12);
    const date = input.readUInt16LE(cursor + 14);
    const compressedSize = input.readUInt32LE(cursor + 20);
    const uncompressedSize = input.readUInt32LE(cursor + 24);
    const nameLength = input.readUInt16LE(cursor + 28);
    const extraLength = input.readUInt16LE(cursor + 30);
    const commentLength = input.readUInt16LE(cursor + 32);
    const internalAttributes = input.readUInt16LE(cursor + 36);
    const externalAttributes = input.readUInt32LE(cursor + 38);
    const localOffset = input.readUInt32LE(cursor + 42);
    const nameBuffer = input.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = nameBuffer.toString(flags & 0x800 ? "utf8" : "latin1");
    const localNameLength = input.readUInt16LE(localOffset + 26);
    const localExtraLength = input.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = input.subarray(dataOffset, dataOffset + compressedSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed);
    else throw new Error(`Modelo XLSX usa compressão ZIP não suportada (${method}).`);
    if (data.length !== uncompressedSize) throw new Error("Modelo XLSX inválido: tamanho de entrada ZIP divergente.");
    entries.push({ name, data, versionMadeBy, versionNeeded, flags, method, time, date, internalAttributes, externalAttributes });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function writeZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = entry.method === 0 ? entry.data : deflateRawSync(entry.data, { level: 6 });
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.versionNeeded || 20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt16LE(entry.time, 10);
    local.writeUInt16LE(entry.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    localParts.push(local, compressed);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.versionMadeBy || 0x0314, 4);
    central.writeUInt16LE(entry.versionNeeded || 20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt16LE(entry.time, 12);
    central.writeUInt16LE(entry.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(entry.internalAttributes, 36);
    central.writeUInt32LE(entry.externalAttributes, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function columnNumber(reference: string): number {
  let number = 0;
  for (const letter of reference.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "") number = number * 26 + letter.charCodeAt(0) - 64;
  return number;
}

function renderCell(reference: string, style: string, update: XlsxCellUpdate): string {
  const styleAttribute = style ? ` s="${style}"` : "";
  if (update.value === null && !update.formula) return `<c r="${reference}"${styleAttribute}/>`;
  if (update.formula) return `<c r="${reference}"${styleAttribute}><f>${xmlEscape(update.formula)}</f><v></v></c>`;
  if (typeof update.value === "number") {
    if (!Number.isFinite(update.value)) throw new Error(`Valor numérico inválido em ${reference}.`);
    return `<c r="${reference}"${styleAttribute}><v>${update.value}</v></c>`;
  }
  const text = xmlEscape(String(update.value ?? ""));
  return `<c r="${reference}"${styleAttribute} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

export function patchWorksheetXml(xml: string, updates: Map<string, XlsxCellUpdate>): string {
  const pending = new Map(updates);
  const rows = new Map<number, string>();
  for (const reference of pending.keys()) {
    const row = Number(reference.match(/\d+$/)?.[0]);
    if (!Number.isSafeInteger(row) || row < 1) throw new Error(`Referência de célula XLSX inválida: ${reference}`);
    const list = rows.get(row) ?? "";
    rows.set(row, list);
  }

  for (const rowNumber of rows.keys()) {
    const rowPattern = new RegExp(`<row\\b(?=[^>]*\\br="${rowNumber}")[^>]*>[\\s\\S]*?<\\/row>`);
    const rowMatch = xml.match(rowPattern);
    if (!rowMatch) throw new Error(`A linha ${rowNumber} não existe no modelo XLSX.`);
    let rowXml = rowMatch[0];
    const rowUpdates = [...pending.entries()].filter(([reference]) => Number(reference.match(/\d+$/)?.[0]) === rowNumber)
      .sort(([a], [b]) => columnNumber(a) - columnNumber(b));
    for (const [reference, update] of rowUpdates) {
      const cellPattern = new RegExp(`<c\\b(?=[^>]*\\br="${reference}")[^>]*\\/>|<c\\b(?=[^>]*\\br="${reference}")[^>]*>[\\s\\S]*?<\\/c>`);
      const existing = rowXml.match(cellPattern)?.[0];
      if (existing) {
        if (update.preserveFormula) {
          if (!/<f\b/.test(existing)) throw new Error(`A célula ${reference} não contém fórmula para preservar.`);
          const emptiedCache = existing.replace(/<v\b[^>]*>[\s\S]*?<\/v>/, "<v></v>");
          if (emptiedCache === existing) throw new Error(`Não foi possível limpar o valor calculado da fórmula em ${reference}.`);
          rowXml = rowXml.replace(existing, emptiedCache);
        } else {
          const style = existing.match(/\bs="([^"]+)"/)?.[1] ?? "";
          rowXml = rowXml.replace(existing, renderCell(reference, style, update));
        }
      } else {
        const newCell = renderCell(reference, "", update);
        const cells = [...rowXml.matchAll(/<c\b(?=[^>]*\br="([A-Z]+\d+)")[^>]*\/>|<c\b(?=[^>]*\br="([A-Z]+\d+)")[^>]*>[\s\S]*?<\/c>/g)];
        const next = cells.find((cell) => columnNumber(cell[1] ?? cell[2]) > columnNumber(reference));
        const insertAt = next?.index ?? rowXml.lastIndexOf("</row>");
        rowXml = rowXml.slice(0, insertAt) + newCell + rowXml.slice(insertAt);
      }
      pending.delete(reference);
    }
    xml = xml.replace(rowMatch[0], rowXml);
  }
  return xml;
}

export function patchXlsxEntries(input: Buffer, updates: Map<string, Buffer>): Buffer {
  const entries = readZip(input);
  for (const [name, data] of updates) {
    const target = entries.find((entry) => entry.name === name);
    if (!target) throw new Error(`A entrada ${name} não existe no modelo XLSX.`);
    target.data = data;
  }
  return writeZip(entries);
}

export function readXlsxEntries(input: Buffer): Map<string, Buffer> {
  return new Map(readZip(input).map((entry) => [entry.name, entry.data]));
}

export function patchXlsxWorksheet(input: Buffer, worksheetPath: string, updates: Map<string, XlsxCellUpdate>): Buffer {
  const entries = readZip(input);
  const target = entries.find((entry) => entry.name === worksheetPath);
  if (!target) throw new Error(`A aba ${worksheetPath} não existe no modelo XLSX.`);
  target.data = Buffer.from(patchWorksheetXml(target.data.toString("utf8"), updates), "utf8");
  return writeZip(entries);
}

export function clearUnreferencedSharedStrings(xml: string, referencedIndices: Set<number>): string {
  let index = -1;
  return xml.replace(/<si(?:\s[^>]*)?>[\s\S]*?<\/si>/g, (entry) => {
    index++;
    return referencedIndices.has(index) ? entry : "<si><t></t></si>";
  });
}
