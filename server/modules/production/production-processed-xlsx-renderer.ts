import * as XLSX from "xlsx";
import { ValidationError } from "../../shared/errors/AppError";
import { classifyProcessedPackaging, type ProcessedPackaging, type ProductionExportBatch, type ProductionExportItem } from "./production-xlsx-mapping";
import { patchXlsxWorksheet, type XlsxCellUpdate } from "./xlsx-ooxml";

export type ProductionShift = "morning" | "afternoon";

interface ProcessedBlock {
  packaging: ProcessedPackaging;
  firstRow: number;
  lastRow: number;
}

const BLOCKS: Record<ProductionShift, ProcessedBlock[]> = {
  morning: [
    { packaging: "BIO_100G", firstRow: 10, lastRow: 71 },
    { packaging: "P07_PLASTIC_100G", firstRow: 91, lastRow: 170 },
    { packaging: "POT_200G", firstRow: 181, lastRow: 182 },
    { packaging: "PET", firstRow: 200, lastRow: 214 },
    { packaging: "KG", firstRow: 231, lastRow: 240 },
  ],
  afternoon: [
    { packaging: "P07_PLASTIC_100G", firstRow: 259, lastRow: 304 },
    { packaging: "BIO_100G", firstRow: 310, lastRow: 322 },
    { packaging: "PET", firstRow: 331, lastRow: 333 },
  ],
};

interface CompanyDemand {
  companyId: number;
  companyName: string;
  routes: Set<string>;
  lines: Map<string, { item: ProductionExportItem; quantity: number }>;
}

interface RowGroup { first: number; last: number }
interface ProductSlot { row: number; productCell: string; quantityCell: string }

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();

function workbookDateFields(sheet: XLSX.WorkSheet, productionDate: string): Map<string, XlsxCellUpdate> {
  const date = new Date(`${productionDate}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== productionDate) {
    throw new ValidationError("A data salva no lote é inválida e não pode ser exportada.");
  }
  const weekdays = ["DOMINGO", "SEGUNDA-FEIRA", "TERÇA-FEIRA", "QUARTA-FEIRA", "QUINTA-FEIRA", "SEXTA-FEIRA", "SÁBADO"];
  const updates = new Map<string, XlsxCellUpdate>();
  for (const [dayRow, weekRow] of [[2, 3], [85, 86], [175, 176], [193, 194], [223, 224], [252, 253], [326, 327], [570, 571]]) {
    const dayCell = `M${dayRow}`;
    const weekdayCell = `M${weekRow}`;
    if (!sheet[dayCell]?.f) updates.set(dayCell, { value: Number(productionDate.slice(8, 10)) });
    // Formula cells compute their label from the date anchors; preserve them.
    if (!sheet[weekdayCell]?.f) updates.set(weekdayCell, { value: weekdays[date.getUTCDay()] });
  }
  return updates;
}

function blockGroups(sheet: XLSX.WorkSheet, block: ProcessedBlock): RowGroup[] {
  const verticalMerges = (sheet["!merges"] ?? []).filter((merge) =>
    merge.s.c === 1 && merge.e.c === 1 && merge.s.r + 1 >= block.firstRow && merge.e.r + 1 <= block.lastRow && merge.e.r > merge.s.r,
  );
  const covered = new Set<number>();
  const groups = verticalMerges.map((merge) => {
    const first = merge.s.r + 1;
    const last = merge.e.r + 1;
    for (let row = first + 1; row <= last; row++) covered.add(row);
    return { first, last };
  });

  for (let row = block.firstRow; row <= block.lastRow; row++) {
    if (covered.has(row) || groups.some((group) => group.first === row)) continue;
    const note = sheet[`C${row}`]?.v;
    if (typeof note === "string" && note.trim()) continue;
    const label = sheet[`B${row}`]?.v;
    if (typeof label === "string" && /^(?:TOTAL\b|POTE\b|FRUTAS PROCESSADAS\b|MANHÃ$|TARDE$)/i.test(label.trim())) continue;
    groups.push({ first: row, last: row });
  }
  return groups.sort((a, b) => a.first - b.first);
}

function mergeAnchor(sheet: XLSX.WorkSheet, column: number, row: number): string {
  const merge = (sheet["!merges"] ?? []).find((entry) => entry.s.c <= column && entry.e.c >= column && entry.s.r <= row - 1 && entry.e.r >= row - 1);
  return XLSX.utils.encode_cell({ r: merge?.s.r ?? row - 1, c: merge?.s.c ?? column });
}

function productSlots(sheet: XLSX.WorkSheet, group: RowGroup): ProductSlot[] {
  const result: ProductSlot[] = [];
  const used = new Set<string>();
  const usedQuantities = new Set<string>();
  for (let row = group.first; row <= group.last; row++) {
    const productCell = mergeAnchor(sheet, 4, row);
    const quantityCell = mergeAnchor(sheet, 6, row);
    if (used.has(productCell) || usedQuantities.has(quantityCell)) continue;
    const productRow = XLSX.utils.decode_cell(productCell).r + 1;
    const quantityRow = XLSX.utils.decode_cell(quantityCell).r + 1;
    if (productRow < group.first || productRow > group.last || quantityRow < group.first || quantityRow > group.last) continue;
    if (sheet[productCell]?.f || sheet[quantityCell]?.f) continue;
    used.add(productCell);
    usedQuantities.add(quantityCell);
    result.push({ row: productRow, productCell, quantityCell });
  }
  return result;
}

function collectDemand(batch: ProductionExportBatch): Map<ProcessedPackaging, CompanyDemand[]> {
  const grouped = new Map<ProcessedPackaging, Map<number, CompanyDemand>>();
  const unsupported: Array<Record<string, unknown>> = [];
  const productNames = new Map<number, string>();

  for (const item of batch.items.filter((candidate) => candidate.productionClassification === "PROCESSADOS")) {
    const priorName = productNames.get(item.productId);
    if (priorName && normalize(priorName) !== normalize(item.productName)) {
      unsupported.push({ orderId: item.orderBreakdown[0]?.orderId ?? 0, productId: item.productId, reason: "NOME_DIVERGENTE_PARA_O_MESMO_PRODUCT_ID_NO_SNAPSHOT" });
      continue;
    }
    productNames.set(item.productId, item.productName);
    const sourceTotal = item.orderBreakdown.reduce((sum, source) => sum + Number(source.quantity), 0);
    if (!Number.isFinite(Number(item.totalQuantity)) || Math.abs(sourceTotal - Number(item.totalQuantity)) > 0.000001) {
      unsupported.push({ orderId: item.orderBreakdown[0]?.orderId ?? 0, productId: item.productId, reason: "TOTAL_DO_SNAPSHOT_DIVERGE_DA_COMPOSICAO_DE_ORIGEM" });
      continue;
    }
    for (const source of item.orderBreakdown) {
      const packaging = source.manualPackaging ?? classifyProcessedPackaging(source.subCategoryName, item.category, item.productName);
      if (!packaging) {
        unsupported.push({ batchItemId: item.batchItemId, itemId: source.itemId, sourceKey: source.itemId != null ? `item:${source.itemId}` : source.requestId ? `manual:${source.requestId}` : null, sourceType: source.sourceType, orderId: source.orderId, companyId: source.companyId, companyName: source.companyName, productId: item.productId, productName: item.productName, subCategoryName: source.subCategoryName, reason: "EMBALAGEM_OU_BLOCO_NAO_IDENTIFICADO" });
        continue;
      }
      if (!Number.isFinite(Number(source.quantity)) || Number(source.quantity) <= 0) {
        unsupported.push({ itemId: source.itemId, orderId: source.orderId, productId: item.productId, reason: "QUANTIDADE_DE_ORIGEM_INVALIDA" });
        continue;
      }
      const lineKey = `${item.productId}:${item.unit}:${source.subCategoryId ?? "null"}:${normalize(source.subCategoryName ?? "")}`;
      let addresses = grouped.get(packaging);
      if (!addresses) grouped.set(packaging, addresses = new Map());
      let demand = addresses.get(source.companyId);
      if (!demand) {
        demand = { companyId: source.companyId, companyName: source.companyName, routes: new Set(), lines: new Map() };
        addresses.set(source.companyId, demand);
      }
      if (source.routeName?.trim() && source.routeName !== "Sem Rota") demand.routes.add(source.routeName.trim());
      const previous = demand.lines.get(lineKey);
      demand.lines.set(lineKey, { item, quantity: (previous?.quantity ?? 0) + Number(source.quantity) });
    }
  }
  if (unsupported.length) {
    throw new ValidationError("A exportação de Processados foi bloqueada: existem embalagens, quantidades ou origens que precisam de conferência manual.", { unresolved: unsupported });
  }
  return new Map([...grouped].map(([packaging, addresses]) => [packaging, [...addresses.values()]]));
}

/** Writes snapshot-only Processados rows into the official template for the selected shift. */
export function renderProcessedWorkbook(
  template: Buffer,
  batch: ProductionExportBatch,
  options: { shift: ProductionShift; responsibleName: string },
): Buffer {
  const workbook = XLSX.read(template, { type: "buffer", cellStyles: true, cellFormula: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new ValidationError("O modelo Processados não contém a aba operacional esperada.");
  const demands = collectDemand(batch);
  if (!demands.size) throw new ValidationError("O lote não possui itens Processados com origem para exportar.");

  const updates = workbookDateFields(sheet, batch.productionDate);
  for (const [packaging, companies] of demands) {
    const block = BLOCKS[options.shift].find((candidate) => candidate.packaging === packaging);
    if (!block) throw new ValidationError(`O modelo oficial não possui bloco de ${packaging} para o turno selecionado.`, { shift: options.shift, packaging });
    const groups = blockGroups(sheet, block);
    const assignedGroups = new Set<RowGroup>();
    for (const company of companies) {
      const lines = [...company.lines.values()].sort((a, b) => a.item.productName.localeCompare(b.item.productName, "pt-BR") || a.item.productId - b.item.productId);
      const lineOptions = groups.map((group) => {
        const available = productSlots(sheet, group);
        const used = new Set<ProductSlot>();
        const slots = lines.map(({ item }) => {
          const match = available.find((slot) => {
            if (used.has(slot)) return false;
            const existing = sheet[slot.productCell]?.v;
            return existing == null || String(existing).trim() === "" || normalize(String(existing)) === normalize(item.productName);
          });
          if (match) used.add(match);
          return match;
        });
        return { group, slots };
      }).filter(({ group, slots }) => !assignedGroups.has(group) && slots.every(Boolean));
      const match = lineOptions[0] as { group: RowGroup; slots: ProductSlot[] } | undefined;
      if (!match) throw new ValidationError("O modelo oficial não tem linhas suficientes para manter cada empresa e seus produtos separados.", { shift: options.shift, packaging, companyId: company.companyId, itemCount: lines.length });
      assignedGroups.add(match.group);
      const companyCell = mergeAnchor(sheet, 1, match.group.first);
      const routeCell = mergeAnchor(sheet, 2, match.group.first);
      updates.set(companyCell, { value: company.companyName });
      const routes = [...company.routes].sort().join(" / ");
      if (routes) updates.set(routeCell, { value: routes });
      lines.forEach(({ item, quantity }, index) => {
        const slot = match.slots[index];
        const existingProduct = sheet[slot.productCell]?.v;
        if (existingProduct == null || String(existingProduct).trim() === "") updates.set(slot.productCell, { value: item.productName });
        updates.set(slot.quantityCell, { value: quantity });
        const responsibleCell = mergeAnchor(sheet, 13, slot.row);
        updates.set(responsibleCell, { value: options.responsibleName.trim() });
      });
    }
  }

  return patchXlsxWorksheet(template, "xl/worksheets/sheet1.xml", updates);
}
