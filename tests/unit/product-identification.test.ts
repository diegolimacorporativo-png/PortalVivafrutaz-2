import assert from "node:assert/strict";
import { test } from "node:test";
import {
  makeSourceDescriptionSnapshot,
  normalizeProductDescription,
  resolveProductIdentity,
  type ProductAliasCandidate,
  type ProductIdentityCandidate,
} from "../../server/modules/products/product-identification";

const catalog: ProductIdentityCandidate[] = [
  { id: 1, name: "Maçã Gala", category: "Frutas", unit: "kg", productionClassification: null },
  { id: 2, name: "Maçã Gala 170g", category: "Frutas", unit: "unidade", productionClassification: "PROCESSADOS" },
  { id: 3, name: "Pera Williams", category: "Frutas", unit: "kg", productionClassification: "IN_NATURA" },
];

test("normalizes accents, punctuation and whitespace without deleting weight tokens", () => {
  assert.equal(normalizeProductDescription("  Maçã—GALA  "), "maca gala");
  assert.equal(normalizeProductDescription("Maçã Gala 170g"), "maca gala 170g");
});

test("resolves a normalized exact catalog name", () => {
  const match = resolveProductIdentity({ description: "Maca-Gala", companyId: 10 }, catalog);
  assert.equal(match.status, "exact");
  assert.equal(match.product?.id, 1);
});

test("uses a confirmed alias only for its source company", () => {
  const aliases: ProductAliasCandidate[] = [
    { productId: 1, companyId: 10, alias: "Gala Nacional", normalizedAlias: "gala nacional", status: "CONFIRMED" },
  ];
  const scoped = resolveProductIdentity({ description: "Gala Nacional", companyId: 10 }, catalog, aliases);
  assert.equal(scoped.status, "confirmed");
  assert.equal(scoped.product?.id, 1);

  const otherCompany = resolveProductIdentity({ description: "Gala Nacional", companyId: 11 }, catalog, aliases);
  assert.equal(otherCompany.status, "unmatched");
});

test("allows an explicit confirmed global alias", () => {
  const aliases: ProductAliasCandidate[] = [
    { productId: 3, companyId: null, alias: "Pera importada", normalizedAlias: "pera importada", status: "CONFIRMED" },
  ];
  const match = resolveProductIdentity({ description: "Pêra importada", companyId: 10 }, catalog, aliases);
  assert.equal(match.status, "confirmed");
  assert.equal(match.product?.id, 3);
  assert.equal(match.matchedBy, "global_alias");
});

test("conflicting confirmed alias targets are ambiguous and never selected", () => {
  const aliases: ProductAliasCandidate[] = [
    { productId: 1, companyId: 10, alias: "Maçã especial", normalizedAlias: "maca especial", status: "CONFIRMED" },
    { productId: 2, companyId: null, alias: "Maçã especial", normalizedAlias: "maca especial", status: "CONFIRMED" },
  ];
  const match = resolveProductIdentity({ description: "Maçã especial", companyId: 10 }, catalog, aliases);
  assert.equal(match.status, "ambiguous");
  assert.equal(match.product, null);
});

test("a confirmed alias cannot redirect an exact official product name", () => {
  const aliases: ProductAliasCandidate[] = [
    { productId: 3, companyId: 10, alias: "Maçã Gala", normalizedAlias: "maca gala", status: "CONFIRMED" },
  ];
  const match = resolveProductIdentity({ description: "Maçã Gala", companyId: 10 }, catalog, aliases);
  assert.equal(match.status, "ambiguous");
  assert.equal(match.product, null);
});

test("aliases without an explicit confirmed status are ignored", () => {
  const aliases: ProductAliasCandidate[] = [
    { productId: 1, companyId: 10, alias: "Gala Nacional", normalizedAlias: "gala nacional" },
  ];
  const match = resolveProductIdentity({ description: "Gala Nacional", companyId: 10 }, catalog, aliases);
  assert.equal(match.status, "unmatched");
});

test("category and unit mismatches prevent automatic exact recognition", () => {
  const wrongCategory = resolveProductIdentity({ description: "Maçã Gala", companyId: 10, category: "Processados" }, catalog);
  assert.equal(wrongCategory.status, "unmatched");

  const wrongUnit = resolveProductIdentity({ description: "Maçã Gala", companyId: 10, unit: "caixa" }, catalog);
  assert.equal(wrongUnit.status, "unmatched");
});

test("weight and presentation differences can only produce a review suggestion", () => {
  const match = resolveProductIdentity({ description: "Maçã Gala 170g", companyId: 10 }, [catalog[0]!]);
  assert.equal(match.status, "probable");
  assert.equal(match.product, null);
  assert.equal(match.candidates[0]?.id, 1);
});

test("same normalized name across distinct catalog products is ambiguous", () => {
  const variants = [
    { id: 20, name: "Maçã Gala", category: "Frutas", unit: "kg" },
    { id: 21, name: "Maçã Gala", category: "Frutas", unit: "unidade" },
  ];
  const match = resolveProductIdentity({ description: "Maçã Gala", companyId: 10 }, variants);
  assert.equal(match.status, "ambiguous");
});

test("unclassified and unmatched products remain visible without creating catalog items", () => {
  const match = resolveProductIdentity({ description: "Fruta desconhecida", companyId: 10 }, catalog);
  assert.equal(match.status, "unmatched");
  assert.equal(match.product, null);
  assert.equal(catalog.length, 3);
  assert.equal(catalog[0]?.productionClassification, null);
});

test("source snapshot preserves trusted wording and falls back to canonical name", () => {
  assert.equal(makeSourceDescriptionSnapshot("Gala Nacional", "Maçã Gala"), "Gala Nacional");
  assert.equal(makeSourceDescriptionSnapshot("  ", "Maçã Gala"), "Maçã Gala");
  assert.equal(makeSourceDescriptionSnapshot("x".repeat(600), "Maçã Gala")?.length, 500);
  assert.equal(makeSourceDescriptionSnapshot(null, null), null);
});
