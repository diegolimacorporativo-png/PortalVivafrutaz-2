import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import * as XLSX from "xlsx";
import { clearUnreferencedSharedStrings, patchXlsxEntries, patchXlsxWorksheet, readXlsxEntries, type XlsxCellUpdate } from "../server/modules/production/xlsx-ooxml";

const [, , inNaturaInput, processedInput, outputDirectory = "server/modules/production/templates"] = process.argv;
if (!inNaturaInput || !processedInput) {
  throw new Error("Uso: tsx scripts/prepare-production-templates.mts <modelo-in-natura.xlsx> <modelo-processados.xlsx> [diretório-saída]");
}

function cellsToClear(workbook: XLSX.WorkBook, sheetName: string, startRow: number): Map<string, XlsxCellUpdate> {
  const sheet = workbook.Sheets[sheetName];
  const updates = new Map<string, XlsxCellUpdate>();
  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) continue;
    const cell = sheet[address];
    const row = XLSX.utils.decode_cell(address).r + 1;
    if (row < startRow) continue;
    const column = XLSX.utils.decode_cell(address).c;
    const columnName = XLSX.utils.encode_col(column);
    const value = typeof cell.v === "string" ? cell.v.trim() : "";
    const structuralLabel = (columnName === "B" && /^(?:TOTAL\b|POTE\b|FRUTAS PROCESSADAS\b|MANHÃ$|TARDE$)/i.test(value))
      || (columnName === "C" && /^(?:ATENÇÃO\b|DIA DO MÊS:|DIA DA SEMANA:)/i.test(value))
      || (columnName === "D" && /^POTE\b/i.test(value))
      || (columnName === "E" && /^(?:MIX ?FRUTAS|MIX ?4 FRUTAS)$/i.test(value))
      || (columnName === "K" && /^DIA DO (?:MÊS|SEMANA):/i.test(value))
      || /^(?:EMPRESA|ROTA|EMBA-?LAGEM|PRODUTO|QUANTIDADE|BAIXA|RESPONSÁVEL(?: POR FAZER OS POTES)?|NOME RESPONSAVEL)$/i.test(value);
    // Keep only static operational labels, never the full row: source models
    // contain historical customer names and quantities in many template rows.
    if (structuralLabel) continue;
    updates.set(address, cell.f ? { value: null, preserveFormula: true } : { value: null });
  }
  if (sheetName === "Controle Produção In Natura") updates.set("CH3", { value: "DATA: ____" });
  if (sheetName === "Processado") {
    for (const row of [2, 3, 85, 86, 175, 176, 193, 194, 223, 224, 252, 253, 326, 327, 570, 571]) {
      if (sheet[`L${row}`]) updates.set(`L${row}`, { value: null });
    }
  }
  return updates;
}

function scrubSharedStrings(entries: Map<string, Buffer>): void {
  const referenced = new Set<number>();
  for (const [name, content] of entries) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
    const xml = content.toString("utf8");
    for (const match of xml.matchAll(/<c\b[^>]*\bt="s"[^>]*>[\s\S]*?<v>(\d+)<\/v>[\s\S]*?<\/c>/g)) referenced.add(Number(match[1]));
  }
  const shared = entries.get("xl/sharedStrings.xml");
  if (shared) entries.set("xl/sharedStrings.xml", Buffer.from(clearUnreferencedSharedStrings(shared.toString("utf8"), referenced), "utf8"));
}

async function prepare(inputPath: string, outputPath: string, sheetIndex: number, startRow: number) {
  const source = await readFile(resolve(inputPath));
  const workbook = XLSX.read(source, { type: "buffer", cellStyles: true, cellFormula: true });
  const sheetName = workbook.SheetNames[sheetIndex];
  if (!sheetName) throw new Error("O modelo oficial não possui a aba esperada.");
  const sheetPath = `xl/worksheets/sheet${sheetIndex + 1}.xml`;
  const sourceXml = source;
  const updates = cellsToClear(workbook, sheetName, startRow);

  // Patch only worksheet cell XML. The workbook's styles, dimensions, merges,
  // drawings, formulas and other package entries remain intact.
  const output = patchXlsxWorksheet(sourceXml, sheetPath, updates);
  const entries = readXlsxEntries(output);
  scrubSharedStrings(entries);
  const final = patchXlsxEntries(output, entries);
  const checked = XLSX.read(final, { type: "buffer", cellStyles: true, cellFormula: true });
  if (checked.SheetNames.length !== workbook.SheetNames.length) throw new Error("A preparação alterou a quantidade de abas do modelo.");
  const checkedSheet = checked.Sheets[checked.SheetNames[sheetIndex]];
  const originalSheet = workbook.Sheets[sheetName];
  if ((checkedSheet["!merges"] ?? []).length !== (originalSheet["!merges"] ?? []).length) throw new Error("A preparação alterou as mesclagens do modelo.");
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(resolve(outputPath), final);
}

await prepare(inNaturaInput, resolve(outputDirectory, "in-natura-template.xlsx"), 0, 10);
await prepare(processedInput, resolve(outputDirectory, "processed-template.xlsx"), 0, 10);
console.log("Modelos oficiais preparados: estrutura visual preservada e dados operacionais anteriores removidos.");
