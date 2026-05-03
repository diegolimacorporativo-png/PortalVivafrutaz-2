import { validateSchemaIntegrity } from "@shared/schema";

export const SCHEMA_ENFORCEMENT_MODE = true;

export function enforceSchemaContract(): void {
  if (!SCHEMA_ENFORCEMENT_MODE) return;
  try {
    validateSchemaIntegrity();
  } catch (error) {
    console.error("SCHEMA ENFORCEMENT FAILED - SYSTEM BLOCKED", error);
    throw error instanceof Error ? error : new Error("SCHEMA ENFORCEMENT FAILED - SYSTEM BLOCKED");
  }
}
