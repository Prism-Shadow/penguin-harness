/**
 * Turning a picked image file into the data URL the profile route stores.
 *
 * Three decisions live here, and only the last of them needs a browser:
 *
 * 1. **The crop.** An avatar is drawn in a circle, so the square the centre crop keeps is the
 *    only part a viewer ever sees; cropping before scaling is what keeps a wide photo from
 *    being squeezed into it.
 * 2. **The size.** 128x128 is the largest rung any surface draws (the Profile page's preview
 *    is 64px, the nav tile 28px), doubled for a 2x screen. A bigger source buys nothing and is
 *    paid for on every page load, since the data URL travels inside `GET /api/me`.
 * 3. **The format.** PNG first, because a flat or generated image stays small and stays sharp;
 *    a photograph does not, so a PNG over its budget is re-exported as JPEG.
 *
 * Everything but `avatarDataUrlFromFile` is pure, and the format decision takes its encoder as
 * an argument rather than reaching for a canvas: this package's vitest runs in Node with no
 * DOM, so a size/format rule that could only be exercised through a real canvas could not be
 * exercised at all.
 *
 * Both budgets are measured in CHARACTERS OF THE DATA URL, which is also the unit the server's
 * cap is written in — so "fits" means the same thing on both sides of the request, with no
 * base64-expansion arithmetic in between to get wrong.
 */

/** Edge of the stored square, in pixels. */
export const AVATAR_EDGE = 128;

/**
 * Where PNG stops being worth it. Under this, the sharper lossless encoding is kept; over it,
 * the image is photographic enough that JPEG is both smaller and indistinguishable at 128px.
 */
export const AVATAR_PNG_BUDGET = 100 * 1024;

/** The hard cap, in data-URL characters — the same number `PUT /api/me/profile` enforces. */
export const AVATAR_MAX_CHARS = 128 * 1024;

/** JPEG quality for the re-export: visually clean at 128px, and roughly a third of q=1. */
export const AVATAR_JPEG_QUALITY = 0.85;

export type AvatarMimeType = "image/png" | "image/jpeg";

/** Encodes the already-drawn 128x128 surface as a data URL. `canvas.toDataURL`, injected. */
export type AvatarEncoder = (type: AvatarMimeType, quality?: number) => string;

/** The source rectangle a centre crop keeps: the largest square centred on the image. */
export function centreCropRect(
  width: number,
  height: number,
): { x: number; y: number; size: number } {
  const size = Math.min(width, height);
  return { x: Math.round((width - size) / 2), y: Math.round((height - size) / 2), size };
}

/**
 * The data URL to store, or null when even the JPEG re-export is over the cap.
 *
 * Null is a real outcome rather than an error: a 128x128 JPEG past 128 KiB means the encoder
 * produced something the server will not take, which the page reports inline instead of
 * sending a request that is certain to 400.
 */
export function fitAvatarDataUrl(encode: AvatarEncoder): string | null {
  const png = encode("image/png");
  if (png.length <= AVATAR_PNG_BUDGET) return png;
  const jpeg = encode("image/jpeg", AVATAR_JPEG_QUALITY);
  return jpeg.length <= AVATAR_MAX_CHARS ? jpeg : null;
}

/** Decodes a picked file into an element `drawImage` accepts. Rejects if it is not an image. */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // The bitmap is already decoded into the element, so the blob URL has done its job.
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The picked file could not be decoded as an image."));
    };
    img.src = url;
  });
}

/**
 * A picked file as a stored avatar: centre-cropped, drawn at AVATAR_EDGE, encoded by the rule
 * above. Null means it did not fit; it throws only when the file is not a readable image.
 */
export async function avatarDataUrlFromFile(file: File): Promise<string | null> {
  const image = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_EDGE;
  canvas.height = AVATAR_EDGE;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("This browser did not provide a 2D canvas context.");
  const crop = centreCropRect(image.naturalWidth, image.naturalHeight);
  ctx.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, AVATAR_EDGE, AVATAR_EDGE);
  return fitAvatarDataUrl((type, quality) => canvas.toDataURL(type, quality));
}
