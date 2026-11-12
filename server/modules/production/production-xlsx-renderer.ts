import * as XLSX from "xlsx";
import { ValidationError } from "../../shared/errors/AppError";
import {
  deliveryAddressDisplay,
  resolveInNaturaHeader,
  type HeaderCandidate,
  type ProductionExportBatch,
  type ProductionExportItem,
  type ProductionExportSource,
} from "./production-xlsx-mapping";
import { patchXlsxWorksheet, type XlsxCellUpdate } from "./xlsx-ooxml";

const IN_NATURA_FIRST_DATA_ROW = 12;
const IN_NATURA_LAST_DATA_ROW = 219;

function dateLabel(value: string): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ValidationError("A data salva no lote é inválida e não pode ser exportada.");
  }
  const weekdays = ["DOMINGO", "SEGUNDA-FEIRA", "TERÇA-FEIRA", "QUARTA-FEIRA", "QUINTA-FEIRA", "SEXTA-FEIRA", "SÁBADO"];
  return `DATA: ${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)} - ${weekdays[date.getUTCDay()]}`;
}

function excelColumn(columnNumber: number): string {
  return XLSX.utils.encode_col(columnNumber - 1);
}

function collectSources(batch: ProductionExportBatch, classification: ProductionExportItem["productionClassification"]): Array<{
  item: ProductionExportItem;
  source: ProductionExportSource;
}> {
  return batch.items.filter((item) => item.productionClassification === classification)
    .flatMap((item) => item.orderBreakdown.map((source) => ({ item, source })));
}

/** Renders into the official sanitized template and changes only selected cell XML values. */
export function renderInNaturaWorkbook(template: Buffer, batch: ProductionExportBatch): Buffer {
  const workbook = XLSX.read(template, { type: "buffer", cellStyles: true, cellFormula: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new ValidationError("O modelo In Natura não contém a aba operacional esperada.");

  const candidates: HeaderCandidate[] = [];
  for (let column = 0; column < 126; column++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 7, c: column })];
    if (typeof cell?.v === "string" && cell.v.trim()) candidates.push({ column: column + 1, header: cell.v.trim() });
  }
  if (!candidates.length) throw new ValidationError("O modelo In Natura está sem cabeçalhos de produtos.");

  const addresses = new Map<string, {
    display: string;
    routes: Set<string>;
    productQuantities: Map<number, { quantity: number; subCategoryId: number | null; productId: number }>;
  }>();
  const unresolved: Array<Record<string, unknown>> = [];
  const columnOwners = new Map<number, string>();
  for (const { item, source } of collectSources(batch, "IN_NATURA")) {
    const display = deliveryAddressDisplay(source);
    if (!display) {
      unresolved.push({ itemId: source.itemId, orderId: source.orderId, companyId: source.companyId, reason: "ENDERECO_DE_ENTREGA_AUSENTE_NO_SNAPSHOT" });
      continue;
    }
    const resolved = resolveInNaturaHeader(item.productName, source.subCategoryName, candidates);
    if (resolved.status !== "matched") {
      unresolved.push({ itemId: source.itemId, orderId: source.orderId, productId: item.productId, productName: item.productName, subCategoryId: source.subCategoryId ?? null, subCategoryName: source.subCategoryName ?? null, reason: resolved.status === "ambiguous" ? "CABECALHO_EXCEL_AMBIGUO" : "PRODUTO_SEM_COLUNA_EXATA_NO_MODELO" });
      continue;
    }
    const normalizedSubCategory = (source.subCategoryName ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
    const identity = `${item.productId}:${item.unit}:${normalizedSubCategory}`;
    const columnOwner = columnOwners.get(resolved.column);
    if (columnOwner && columnOwner !== identity) {
      unresolved.push({ itemId: source.itemId, orderId: source.orderId, productId: item.productId, productName: item.productName, reason: "COLISAO_GLOBAL_DE_IDENTIDADE_NA_COLUNA_EXCEL" });
      continue;
    }
    columnOwners.set(resolved.column, identity);
    const key = `${source.companyId}:${source.deliveryAddressId}`;
    const destination = addresses.get(key) ?? { display, routes: new Set<string>(), productQuantities: new Map() };
    if (source.routeName?.trim() && source.routeName !== "Sem Rota") destination.routes.add(source.routeName.trim());
    const previous = destination.productQuantities.get(resolved.column);
    if (previous && (previous.productId !== item.productId || previous.subCategoryId !== (source.subCategoryId ?? null))) {
      unresolved.push({ itemId: source.itemId, orderId: source.orderId, productId: item.productId, productName: item.productName, reason: "COLISAO_DE_PRODUTO_OU_EMBALAGEM_NA_MESMA_COLUNA" });
      continue;
    }
    destination.productQuantities.set(resolved.column, {
      quantity: (previous?.quantity ?? 0) + Number(source.quantity),
      productId: item.productId,
      subCategoryId: source.subCategoryId ?? null,
    });
    addresses.set(key, destination);
  }
  if (unresolved.length) {
    const explain = (reason: unknown) => {
      switch (reason) {
        case "ENDERECO_DE_ENTREGA_AUSENTE_NO_SNAPSHOT": return "endereço de entrega ausente no lote";
        case "PRODUTO_SEM_COLUNA_EXATA_NO_MODELO": return "sem coluna correspondente no modelo oficial";
        case "CABECALHO_EXCEL_AMBIGUO": return "mais de uma coluna possível no modelo oficial";
        case "COLISAO_GLOBAL_DE_IDENTIDADE_NA_COLUNA_EXCEL": return "colisão de produtos na mesma coluna oficial";
        case "COLISAO_DE_PRODUTO_OU_EMBALAGEM_NA_MESMA_COLUNA": return "produto/embalagem incompatível na coluna oficial";
        default: return String(reason).toLocaleLowerCase("pt-BR");
      }
    };
    const examples = unresolved.slice(0, 3).map((entry) => {
      const subject = entry.productName ? `produto “${entry.productName}”` : `pedido ${entry.orderId}`;
      return `${subject}: ${explain(entry.reason)}`;
    }).join("; ");
    throw new ValidationError(
      `A exportação In Natura foi bloqueada: ${examples}${unresolved.length > 3 ? `; e mais ${unresolved.length - 3} pendência(s)` : ""}.`,
      { unresolved },
    );
  }
  if (!addresses.size) throw new ValidationError("O lote não possui itens In Natura com origem para exportar.");
  const addressRows = [...addresses.entries()];
  if (addressRows.length > IN_NATURA_LAST_DATA_ROW - IN_NATURA_FIRST_DATA_ROW + 1) {
    throw new ValidationError(`O modelo In Natura comporta ${IN_NATURA_LAST_DATA_ROW - IN_NATURA_FIRST_DATA_ROW + 1} linhas de destino; o lote possui ${addressRows.length}.`);
  }

  const updates: Map<string, XlsxCellUpdate> = new Map([["CH3", { value: dateLabel(batch.productionDate) }]]);
  addressRows.forEach(([, address], index) => {
    const row = IN_NATURA_FIRST_DATA_ROW + index;
    updates.set(`B${row}`, { value: address.display });
    updates.set(`C${row}`, { value: [...address.routes].sort().join(" / ") });
    for (const [column, value] of address.productQuantities) updates.set(`${excelColumn(column)}${row}`, { value: value.quantity });
  });
  return patchXlsxWorksheet(template, "xl/worksheets/sheet1.xml", updates);
}
