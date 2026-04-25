#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const SCOPES = [
  "server/modules/orders/",
  "server/modules/finance/",
  "server/modules/users/",
  "server/modules/companies/",
  "server/modules/auth/",
  "server/modules/logistics/",
];

const result = spawnSync(
  "npx",
  ["tsc", "-p", "tsconfig.strict.json", "--noEmit", "--pretty", "false"],
  { encoding: "utf8" },
);

const raw = `${result.stdout ?? ""}${result.stderr ?? ""}`;
const lines = raw.split("\n");

const inScopeErrors = [];
let currentInScope = false;
for (const line of lines) {
  const startsError = /\.tsx?\(\d+,\d+\): error TS\d+:/.test(line);
  if (startsError) {
    currentInScope = SCOPES.some((s) => line.startsWith(s));
    if (currentInScope) inScopeErrors.push(line);
  } else if (currentInScope && line.length > 0) {
    inScopeErrors.push(line);
  }
}

if (inScopeErrors.length === 0) {
  console.log(`OK: 0 strict errors in ${SCOPES.join(", ")}`);
  process.exit(0);
}

console.log(inScopeErrors.join("\n"));
const errCount = inScopeErrors.filter((l) => /error TS\d+:/.test(l)).length;
console.log(`\nFAIL: ${errCount} strict error(s) in ${SCOPES.join(", ")}`);
process.exit(1);
