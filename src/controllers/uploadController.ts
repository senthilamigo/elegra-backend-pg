import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../config/supabase";
import { AppError } from "../middleware/errorHandler";
import { ApiResponse } from "../types";
import path from "path";

/**
 * POST /api/upload/image
 *
 * Accepts a single image file via multipart/form-data (field name: "image"),
 * uploads it to the Supabase Storage bucket "images-bucket" under the
 * "products/" folder, and returns the public URL.
 *
 * Security considerations:
 * - Route is protected by the authenticate middleware (JWT required)
 * - File type is validated server-side against an allowlist — never trust
 *   the client-supplied MIME type alone; we check the file extension too
 * - File size is capped by the multer limit (5 MB) set in the route file
 * - Files are stored with a unique timestamped name to prevent collisions
 *   and to avoid path traversal attacks from user-supplied filenames
 */

const BUCKET      = "image-bucket";
const FOLDER      = "products";
const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif"];

export const uploadProductImage = async (
  req: Request,
  res: Response<ApiResponse<{ url: string }>>,
  next: NextFunction
): Promise<void> => {
  try {
    // multer attaches the parsed file to req.file
    if (!req.file) {
      throw new AppError("No image file provided. Send a file under the field name 'image'.", 400);
    }

    const { originalname, mimetype, buffer } = req.file;

    // Validate file extension server-side (belt-and-suspenders on top of multer's fileFilter)
    const ext = path.extname(originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      throw new AppError(
        `File type '${ext}' is not allowed. Accepted types: ${ALLOWED_EXT.join(", ")}`,
        400
      );
    }

    // Build a unique storage path: products/1700000000000-originalname.jpg
    // Prefixing with a timestamp avoids collisions and makes ordering easy
    const storagePath = `${FOLDER}/${Date.now()}-${originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

    // Upload the file buffer to Supabase Storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: mimetype,
        upsert: false, // never silently overwrite an existing file
      });

    if (uploadError) {
      throw new AppError(`Storage upload failed: ${uploadError.message}`, 500);
    }

    // Retrieve the public URL for the uploaded file
    const { data: urlData } = supabaseAdmin.storage
      .from(BUCKET)
      .getPublicUrl(storagePath);

    if (!urlData?.publicUrl) {
      throw new AppError("File uploaded but could not retrieve the public URL.", 500);
    }

    res.status(201).json({
      success: true,
      message: "Image uploaded successfully",
      data: { url: urlData.publicUrl },
    });
  } catch (err) {
    next(err);
  }
};
