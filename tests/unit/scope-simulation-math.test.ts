import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateWeightedAverages } from "../../client/src/lib/scope-simulation-math";

test("calcula preço e custo médios ponderados pela quantidade e frequência", () => {
  const result = calculateWeightedAverages([
    { unit: "kg", quantity: 2, frequency: 1, unitPrice: 10, avgCost: 6 },
    { unit: "kg", quantity: 1, frequency: 2, unitPrice: 16, avgCost: 8 },
  ]);

  assert.deepEqual(result, [{
    unit: "kg",
    productCount: 2,
    weeklyQuantity: 4,
    averageUnitPrice: 13,
    averageUnitCost: 7,
  }]);
});

test("mantém unidades diferentes em médias separadas", () => {
  const result = calculateWeightedAverages([
    { unit: "kg", quantity: 2, frequency: 1, unitPrice: 10, avgCost: 6 },
    { unit: "un", quantity: 3, frequency: 1, unitPrice: 4, avgCost: 2 },
  ]);

  assert.deepEqual(result, [
    { unit: "kg", productCount: 1, weeklyQuantity: 2, averageUnitPrice: 10, averageUnitCost: 6 },
    { unit: "un", productCount: 1, weeklyQuantity: 3, averageUnitPrice: 4, averageUnitCost: 2 },
  ]);
});

test("ignora linhas com quantidade ou valor inválido", () => {
  const result = calculateWeightedAverages([
    { unit: "kg", quantity: 0, frequency: 1, unitPrice: 10, avgCost: 6 },
    { unit: "kg", quantity: 1, frequency: 1, unitPrice: Number.NaN, avgCost: 6 },
  ]);

  assert.deepEqual(result, []);
});
