import fs from "node:fs";
import path from "node:path";

const schemaPath = path.resolve("shared/schema.ts");
const source = fs.readFileSync(schemaPath, "utf8");

const registryMatch = source.match(/export const SCHEMA_REGISTRY = ([\s\S]*?) as const;/);
if (!registryMatch) {
  throw new Error("Schema contract violation detected: SCHEMA_REGISTRY missing");
}

const registryKeys = [...source.matchAll(/\s(\w+):\s*\[/g)].map((m) => m[1]);
const exportMatches = [...source.matchAll(/export const (\w+) = pgTable\(/g)].map((m) => m[1]);
const actual = new Set(exportMatches);
const missing = registryKeys.filter((key) => !actual.has(key));
const unexpected = [...actual].filter((key) => !registryKeys.includes(key));

if (missing.length || unexpected.length) {
  throw new Error(`Schema contract violation detected${missing.length ? ` missing=${missing.join(",")}` : ""}${unexpected.length ? ` unexpected=${unexpected.join(",")}` : ""}`);
}

console.log("Schema contract validation passed");
