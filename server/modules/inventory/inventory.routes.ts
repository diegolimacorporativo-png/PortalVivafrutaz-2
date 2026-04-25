/**
 * Inventory router — wires HTTP method+path → controller methods.
 *
 * Architecture decision: NO router-wide `requireAuth`. The legacy inventory
 * surface uses a simple `if (!session.userId) return 401` check inside each
 * handler with the literal Portuguese message "Não autorizado". The
 * controller reproduces that gate per-method so behaviour and message
 * stay bit-for-bit identical.
 *
 * Static routes are listed before dynamic ones (`/settings` before
 * `/settings/:id`, `/entries` before `/entries/:id`). Express matches by
 * specificity at runtime, but ordering matters for the next maintainer.
 */
import { Router } from "express";
import { inventoryController } from "./inventory.controller";

const router = Router();

// ── Settings ───────────────────────────────────────────────────────────
router.get("/settings", inventoryController.listSettings);
router.post("/settings", inventoryController.createSetting);
router.put("/settings/:id", inventoryController.updateSetting);

// ── Entries ────────────────────────────────────────────────────────────
router.get("/entries", inventoryController.listEntries);
router.post("/entries", inventoryController.createEntry);
router.delete("/entries/:id", inventoryController.deleteEntry);

// ── Movements ──────────────────────────────────────────────────────────
router.get("/movements", inventoryController.listMovements);

// ── Physical Counts ────────────────────────────────────────────────────
router.get("/physical-counts", inventoryController.listPhysicalCounts);
router.post("/physical-counts", inventoryController.createPhysicalCount);

export const inventoryRouter = router;
