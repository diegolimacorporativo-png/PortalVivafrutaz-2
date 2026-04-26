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

const router = Router();

router.get("/", (req, res) => productController.listCategories(req, res));
router.post("/", (req, res) => productController.createCategory(req, res));
router.put("/:id", (req, res) => productController.updateCategory(req, res));
router.delete("/:id", (req, res) => productController.deleteCategory(req, res));

export const categoriesRouter = router;
