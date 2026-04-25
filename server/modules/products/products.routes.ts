import { Router } from "express";
import { productController } from "./products.controller";

const router = Router();

router.get("/", (req, res, next) => productController.list(req, res, next));
router.get("/:id", (req, res, next) => productController.getById(req, res, next));
router.post("/", (req, res, next) => productController.create(req, res, next));
router.patch("/:id", (req, res, next) => productController.update(req, res, next));
router.delete("/:id", (req, res, next) => productController.remove(req, res, next));

export { router as productsRouter };
