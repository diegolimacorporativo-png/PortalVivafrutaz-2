/**
 * Products router — wires HTTP method+path → controller methods.
 *
 * The controller already implements every method (the legacy routes.ts
 * was a pure thin delegator). This file just re-registers them on a
 * Router so the central module loader can mount them at /api/products.
 *
 * Static routes are listed BEFORE dynamic ones (`/safra-alerts`,
 * `/next-code`, etc. before `/:id`) so the next maintainer's intent is
 * obvious. Express matches by registration order, so this also guards
 * against the dynamic `/:id` accidentally swallowing the literal paths.
 */
import { Router } from "express";
import { productController } from "./products.controller";

const router = Router();

// ── Static GET routes (must precede /:id) ──────────────────────────────
router.get("/safra-alerts", (req, res) => productController.safraAlerts(req, res));
router.get("/next-code", (req, res, next) => productController.nextCode(req, res, next));
router.get("/check-code", (req, res) => productController.checkCode(req, res));
router.get("/check-duplicate", (req, res) => productController.checkDuplicate(req, res));
router.get("/price-alerts", (req, res) => productController.priceAlerts(req, res));

// ── List + CRUD by id ──────────────────────────────────────────────────
router.get("/", (req, res, next) => productController.list(req, res, next));
router.get("/:id", (req, res, next) => productController.getById(req, res, next));
router.post("/", (req, res, next) => productController.create(req, res, next));
router.put("/:id", (req, res, next) => productController.update(req, res, next));
router.delete("/:id", (req, res, next) => productController.remove(req, res, next));

// ── Out-of-season toggle ───────────────────────────────────────────────
router.patch("/:id/out-of-season", (req, res) => productController.setOutOfSeason(req, res));

// ── Sub-categories (per-product) ───────────────────────────────────────
router.get("/:productId/sub-categories", (req, res) => productController.listSubCategories(req, res));
router.post("/:productId/sub-categories", (req, res) => productController.createSubCategory(req, res));
router.delete("/:productId/sub-categories", (req, res) => productController.deleteAllSubCategoriesForProduct(req, res));

// ── Sub-categories (by sub-category id) ────────────────────────────────
router.patch("/sub-categories/:id", (req, res) => productController.updateSubCategory(req, res));
router.delete("/sub-categories/:id", (req, res) => productController.deleteSubCategory(req, res));

export const productsRouter = router;
