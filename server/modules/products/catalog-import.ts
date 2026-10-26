import * as XLSX from "xlsx";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../database/db";
import { categories, products, productSubCategories } from "@shared/schema";
import { currentTenantId } from "../../core/tenant/context";

type CatalogRow = { category: string; name: string; measure: string; price: number | null; sourceSheet: string; sourceRow: number };
type ProductVariant = { name: string; unit: string; measure: string; category: string; prices: Array<{ category: string; price: number }> };

const clean = (value: unknown) => String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const key = (value: string) => clean(value).toLocaleLowerCase("pt-BR");
const headerKey = (value: unknown) => clean(value)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("pt-BR")
  .replace(/[^a-z0-9]/g, "");
const numberValue = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let raw = String(value).replace(/R\$\s?/gi, "").replace(/\s/g, "").trim();
  if (raw.includes(",") && raw.includes(".")) raw = raw.replace(/\./g, "").replace(",", ".");
  else if (raw.includes(",")) raw = raw.replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, "");
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};
type CatalogHeader = { product: number; measure: number; price: number; category: number | null };
const findCatalogHeader = (row: unknown[]): CatalogHeader | null => {
  const headers = row.map(headerKey);
  const find = (aliases: string[]) => headers.findIndex(value => aliases.includes(value));
  const product = find(["produto", "produtos", "nomeproduto", "nomedoproduto", "descricaoproduto", "item", "descricao"]);
  const measure = find(["unidademedida", "unidadedemedida", "unidade", "medida", "apresentacao", "embalagem", "formatovenda", "formatodevenda"]);
  if (product < 0 || measure < 0) return null;

  let price = headers.findIndex(value =>
    ["precounitario", "valorunitario", "valorunit", "preco", "valor", "price", "unitprice"].includes(value),
  );
  if (price < 0) price = measure + 1;
  const category = find(["categoria", "category", "grupo"]);
  return { product, measure, price, category: category < 0 ? null : category };
};
const unitFromMeasure = (measure: string) => {
  const m = key(measure);
  if (m.includes("kg")) return "kg";
  if (m.includes("porção") || m.includes("pounch") || m.includes("pouch")) return "porcao";
  if (m.includes("pote")) return "pote";
  if (m.includes("display") || m.includes("fardo") || m.includes("caixa") || m.includes("cx ")) return "caixa";
  if (m.includes("pacote")) return "pacote";
  return "unidade";
};

export function parseOrderCatalog(buffer: Buffer): { categories: string[]; rows: CatalogRow[]; variants: ProductVariant[]; sourceSheets: string[] } {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheets = workbook.SheetNames;
  const preferred = sheets.find((s) => key(s).includes("uso exclusivo"));
  const orderedSheets = preferred ? [...sheets.filter((s) => s !== preferred), preferred] : sheets;
  const byRow = new Map<string, CatalogRow>();
  for (const sheetName of orderedSheets) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
    let header: CatalogHeader | null = null;
    let category = "";
    for (let i = 0; i < matrix.length; i++) {
      const row = matrix[i] || [];
      const detectedHeader = findCatalogHeader(row);
      if (detectedHeader) {
        header = detectedHeader;
        category = "";
        continue;
      }
      if (!header) continue;

      const name = clean(row[header.product]);
      const measure = clean(row[header.measure]);
      const categoryCell = header.category == null ? "" : clean(row[header.category]);
      const priceCell = row[header.price];
      const price = numberValue(priceCell);
      if (!name) continue;

      // Workbooks may put category names in section rows, or provide a
      // category column on every product row.
      if (header.category == null && !measure && price == null) {
        category = name;
        continue;
      }
      const rowCategory = categoryCell || category;
      if (!rowCategory || !measure) continue;
      const item: CatalogRow = { category: rowCategory, name, measure, price, sourceSheet: sheetName, sourceRow: i + 1 };
      const rowKey = `${key(rowCategory)}\0${key(name)}\0${key(measure)}`;
      // The dedicated internal sheet is authoritative when the same catalog row
      // is repeated in the weekday tabs.
      byRow.set(rowKey, item);
    }
  }
  const rows = [...byRow.values()];
  const variantMap = new Map<string, ProductVariant>();
  for (const row of rows) {
    const variantKey = `${key(row.category)}\0${key(row.name)}\0${unitFromMeasure(row.measure)}\0${key(row.measure)}`;
    const variant = variantMap.get(variantKey) || { name: row.name, unit: unitFromMeasure(row.measure), measure: row.measure, category: row.category, prices: [] };
    const existing = variant.prices.find((p) => key(p.category) === key(row.category));
    if (row.price != null && row.price > 0) {
      if (existing) existing.price = row.price;
      else variant.prices.push({ category: row.category, price: row.price });
    }
    variantMap.set(variantKey, variant);
  }
  return { categories: [...new Set(rows.map((r) => r.category))], rows, variants: [...variantMap.values()], sourceSheets: sheets };
}

export async function importOrderCatalog(buffer: Buffer, mode: "preview" | "commit") {
  const parsed = parseOrderCatalog(buffer);
  if (mode === "preview") return { mode, sourceSheets: parsed.sourceSheets, sourceRows: parsed.rows.length, categories: parsed.categories, products: parsed.variants.length, subCategories: parsed.variants.reduce((n, p) => n + p.prices.length, 0), variants: parsed.variants };
  const empresaId = currentTenantId();
  let categoriesCreated = 0;
  let productsCreated = 0;
  let productsUpdated = 0;
  let subCategoriesCreated = 0;
  await db.transaction(async (tx) => {
    for (const name of parsed.categories) {
      const existing = await tx.select().from(categories).where(eq(categories.name, name)).limit(1);
      if (existing[0]) continue;
      await tx.insert(categories).values({ name, description: "Importada da tabela de pedidos", active: true, empresaId });
      categoriesCreated++;
    }
    for (const variant of parsed.variants) {
      const observation = `Medida original da planilha: ${variant.measure}`;
      const condition = empresaId == null
        ? and(sql`lower(${products.name}) = ${key(variant.name)}`, eq(products.category, variant.category), eq(products.unit, variant.unit), eq(products.observation, observation))
        : and(eq(products.empresaId, empresaId), sql`lower(${products.name}) = ${key(variant.name)}`, eq(products.category, variant.category), eq(products.unit, variant.unit), eq(products.observation, observation));
      const existing = await tx.select().from(products).where(condition).limit(1);
      let product = existing[0];
      if (!product) {
        const [created] = await tx.insert(products).values({ name: variant.name, category: variant.category, unit: variant.unit, active: true, basePrice: null, isIndustrialized: key(variant.category).includes("industrializado") || key(variant.category).includes("bebida"), isSeasonal: false, observation, empresaId }).returning();
        product = created;
        productsCreated++;
      } else {
        await tx.update(products).set({ active: true, basePrice: null, observation, category: variant.category }).where(eq(products.id, product.id));
        productsUpdated++;
      }
      for (const price of variant.prices) {
        const categoryName = price.category;
        const existingSub = await tx.select().from(productSubCategories).where(and(eq(productSubCategories.productId, product.id), eq(productSubCategories.categoryName, categoryName))).limit(1);
        if (existingSub[0]) {
          await tx.update(productSubCategories).set({ price: String(price.price), active: true, empresaId }).where(eq(productSubCategories.id, existingSub[0].id));
        } else {
          await tx.insert(productSubCategories).values({ productId: product.id, categoryName, price: String(price.price), active: true, empresaId });
          subCategoriesCreated++;
        }
      }
    }
  });
  return { mode, sourceSheets: parsed.sourceSheets, sourceRows: parsed.rows.length, categories: parsed.categories.length, products: parsed.variants.length, categoriesCreated, productsCreated, productsUpdated, subCategoriesCreated };
}
