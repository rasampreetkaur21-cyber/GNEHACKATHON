import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { HttpError } from "../utils/security.js";
export const MAX_PIXELS = 20000000;
export const MAX_DIMENSION = 8192;
export async function prepareImage(bytes, declaredMime, { maxAnalysisDimension = 1568 } = {}) {
  const type = await fileTypeFromBuffer(bytes).catch(() => null);
  if (
    !type ||
    !["image/jpeg", "image/png", "image/webp"].includes(type.mime) ||
    type.mime !== declaredMime
  )
    throw new HttpError(
      400,
      "INVALID_FILE",
      "File signature must match a JPEG, PNG or WebP image.",
    );
  try {
    const image = sharp(bytes, {
      limitInputPixels: MAX_PIXELS,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > MAX_DIMENSION ||
      metadata.height > MAX_DIMENSION ||
      (metadata.pages || 1) > 1
    )
      throw new Error("Image dimensions or animation are unsupported");
    // Fully decode and re-encode: rejects corrupt pixels, auto-orients, strips EXIF/GPS/XMP by default.
    const normalized = await image
      .rotate()
      .resize({
        width: Math.min(4096, maxAnalysisDimension),
        height: Math.min(4096, maxAnalysisDimension),
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 88 })
      .toBuffer();
    return {
      normalized,
      width: metadata.width,
      height: metadata.height,
      mime: type.mime,
    };
  } catch {
    throw new HttpError(
      400,
      "INVALID_IMAGE",
      "Image is corrupt, animated, or exceeds 8,192 px per side / 20 megapixels.",
    );
  }
}
