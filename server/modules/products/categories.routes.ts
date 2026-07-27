/**
 * Categories router — exposes the legacy /api/categories surface inside
 * the products module so the catalog domain owns its own router.
 *
 * Behaviour is bit-for-bit identical to the legacy inline handlers in
 * server/routes/routes.ts (validation, error codes, status codes,
 * Portuguese messages preserved exactly).
 */
import { Router } from "express";
import { productController } from "./products.controller";
// F1-E2: close public GET endpoint
// B3-FIX: mutating endpoints require admin-level role
import { requireSession, requireRole } from "../../core/http/requireAuth";

const router = Router();

router.get("/", requireSession, (req, res) => productController.listCategories(req, res));
// B3-FIX: mutations require admin-level role (was unauthenticated)
router.post("/", requireSession, requireRole(['ADMIN','MASTER','DEVELOPER','DIRECTOR']), (req, res) => productController.createCategory(req, res));
router.put("/:id", requireSession, requireRole(['ADMIN','MASTER','DEVELOPER','DIRECTOR']), (req, res) => productController.updateCategory(req, res));
router.delete("/:id", requireSession, requireRole(['ADMIN','MASTER','DEVELOPER','DIRECTOR']), (req, res) => productController.deleteCategory(req, res));

export const categoriesRouter = router;
