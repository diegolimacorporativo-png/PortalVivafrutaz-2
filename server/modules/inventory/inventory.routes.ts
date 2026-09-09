/**
 * Inventory router — wires HTTP method+path → controller methods.
 *
 * Authentication, RBAC and tenant resolution are applied at the HTTP
 * boundary. The controller keeps its own session/role check as defense in
 * depth for direct callers and to preserve the legacy 401 response shape.
 *
 * Static routes are listed before dynamic ones (`/settings` before
 * `/settings/:id`, `/entries` before `/entries/:id`).
 */
import { Router } from "express";
import { inventoryController } from "./inventory.controller";
import { requireAuth, requireRole } from "../../core/http/requireAuth";
import { requireTenant, tenantContext } from "../../middleware/tenant";
import {
  INVENTORY_READ_ROLES,
  INVENTORY_WRITE_ROLES,
} from "./inventory.policy";

const router = Router();

const readGuards = [
  requireAuth,
  requireRole([...INVENTORY_READ_ROLES]),
  tenantContext,
  requireTenant,
];
const writeGuards = [
  requireAuth,
  requireRole([...INVENTORY_WRITE_ROLES]),
  tenantContext,
  requireTenant,
];

// ── Settings ───────────────────────────────────────────────────────────
router.get("/settings", ...readGuards, inventoryController.listSettings);
router.post("/settings", ...writeGuards, inventoryController.createSetting);
router.put("/settings/:id", ...writeGuards, inventoryController.updateSetting);

// ── Entries ────────────────────────────────────────────────────────────
router.get("/entries", ...readGuards, inventoryController.listEntries);
router.post("/entries", ...writeGuards, inventoryController.createEntry);
router.delete("/entries/:id", ...writeGuards, inventoryController.deleteEntry);

// ── Movements ──────────────────────────────────────────────────────────
router.get("/movements", ...readGuards, inventoryController.listMovements);

// ── Physical Counts ────────────────────────────────────────────────────
router.get("/physical-counts", ...readGuards, inventoryController.listPhysicalCounts);
router.post("/physical-counts", ...writeGuards, inventoryController.createPhysicalCount);

export const inventoryRouter = router;