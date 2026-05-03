import fs from "node:fs";
import path from "node:path";

const schemaPath = path.resolve("shared/schema.ts");
const source = fs.readFileSync(schemaPath, "utf8");
const tableExports = [...source.matchAll(/export const (\w+) = pgTable\(/g)].map((m) => m[1]);
const declaredTypes = [...source.matchAll(/export type (\w+) = typeof (\w+)\.\$inferSelect;/g)].map((m) => m[2]);
const missingTypes = tableExports.filter((name) => !declaredTypes.includes(name));

if (missingTypes.length) {
  throw new Error(`Schema contract violation detected missing types for: ${missingTypes.join(",")}`);
}

console.log("Schema contract validation passed");
