/**
 * Admin product image upload — mounted at /api/admin/products.
 *
 * Single endpoint:
 *   POST /upload-image  → multipart/form-data with field "file"
 *
 * Saves the file to `uploads/products/<rand>.<ext>` and returns
 * `{ imageUrl: "/uploads/products/<rand>.<ext>" }` so the admin form
 * can persist the value as the product's `imageUrl`.
 *
 * Auth: requireAuth + requireRole(['ADMIN']).
 */
import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { requireAuth, requireRole } from "../../core/http/requireAuth";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "products");
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 5 * 1024 * 1024;

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 8) || ".bin";
    const rand = crypto.randomBytes(12).toString("hex");
    cb(null, `${Date.now()}-${rand}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("Tipo de arquivo não permitido. Use JPG, PNG, WEBP ou GIF."));
    }
    cb(null, true);
  },
});

const router = Router();

router.post(
  "/upload-image",
  requireAuth,
  requireRole(["ADMIN"]),
  (req: Request, res: Response) => {
    upload.single("file")(req, res, (err: any) => {
      if (err) {
        const msg =
          err?.code === "LIMIT_FILE_SIZE"
            ? "Arquivo muito grande (máx 5MB)."
            : err?.message || "Falha no upload";
        return res.status(400).json({ message: msg });
      }
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) {
        return res.status(400).json({ message: "Nenhum arquivo enviado." });
      }
      const imageUrl = `/uploads/products/${file.filename}`;
      res.json({ imageUrl });
    });
  },
);

export const productUploadRouter = router;
