import { Router } from "express";
import multer from "multer";
import { authenticate } from "../middleware/auth";
import { uploadProductImage } from "../controllers/uploadController";

const router = Router();

/**
 * Multer configuration — stores files in memory (as Buffer) rather than
 * writing them to disk. This is appropriate for small images on serverless
 * platforms (e.g. Vercel) where the filesystem is read-only or ephemeral.
 *
 * Security:
 * - fileFilter rejects non-image MIME types at the multer layer before the
 *   controller even runs (defence in depth alongside the ext check in the controller)
 * - limits.fileSize caps uploads at 5 MB to prevent resource exhaustion
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Only JPEG, PNG, WebP and GIF are accepted.`));
    }
  },
});

// All upload routes require a valid JWT
router.use(authenticate);

/**
 * POST /api/upload/image
 * Accepts: multipart/form-data with field "image"
 * Returns: { success: true, data: { url: string } }
 */
router.post(
  "/upload/image",
  upload.single("image"), // parse the "image" field from the multipart body
  uploadProductImage
);

export default router;
