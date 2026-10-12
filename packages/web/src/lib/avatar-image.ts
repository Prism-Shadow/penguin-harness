/**
 * Turning a picked image file into the data URL the profile route stores.
 *
 * Three decisions live here, and only the last of them needs a browser:
 *
 * 1. **The crop.** An avatar is a square tile, so the square that is kept is the only part a
 *    viewer ever sees; cropping before scaling is what keeps a wide photo from being squeezed
 *    into it. Which square is the person's to say (`AvatarCrop`: a zoom and a centre, chosen
 *    in components/ui/avatar-crop-dialog.tsx); the centre crop is where that choice starts.
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

/** How far in a crop may go: past this a 128px tile is drawn from fewer source pixels than it has. */
export const AVATAR_MAX_ZOOM = 4;

/**
 * A crop as the person chose it: `zoom` 1 keeps the largest square the image holds, 2 a square
 * half that edge, and `(cx, cy)` is the square's centre in the image's own pixels.
 */
export interface AvatarCrop {
  zoom: number;
  cx: number;
  cy: number;
}

/** Where every crop starts: the whole centre square. */
export function initialCrop(width: number, height: number): AvatarCrop {
  return { zoom: 1, cx: width / 2, cy: height / 2 };
}

/**
 * The crop made legal: the zoom within [1, AVATAR_MAX_ZOOM], and the centre moved just far
 * enough that the square lies inside the image — so dragging past an edge stops at it rather
 * than showing nothing, and zooming out near an edge slides the square back in.
 */
export function clampCrop(width: number, height: number, crop: AvatarCrop): AvatarCrop {
  const zoom = Math.min(AVATAR_MAX_ZOOM, Math.max(1, crop.zoom));
  const half = Math.min(width, height) / zoom / 2;
  const within = (v: number, max: number) => Math.min(max - half, Math.max(half, v));
  return { zoom, cx: within(crop.cx, width), cy: within(crop.cy, height) };
}

/** The source rectangle a crop keeps, in the image's pixels. */
export function cropRect(
  width: number,
  height: number,
  crop: AvatarCrop,
): { x: number; y: number; size: number } {
  const c = clampCrop(width, height, crop);
  const size = Math.min(width, height) / c.zoom;
  return { x: c.cx - size / 2, y: c.cy - size / 2, size };
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
export function loadAvatarImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // The URL is kept: the crop dialog shows this same image by its `src`. It is released
      // by `releaseAvatarImage` once the choice is made.
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The picked file could not be decoded as an image."));
    };
    img.src = url;
  });
}

/** Lets go of the blob URL a decoded image was loaded from, once nothing shows it any more. */
export function releaseAvatarImage(image: HTMLImageElement): void {
  if (image.src.startsWith("blob:")) URL.revokeObjectURL(image.src);
}

/**
 * The chosen square of a decoded image as a stored avatar: drawn at AVATAR_EDGE, encoded by
 * the rule above. Null means it did not fit the cap.
 */
export function avatarDataUrlFromImage(image: HTMLImageElement, crop: AvatarCrop): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_EDGE;
  canvas.height = AVATAR_EDGE;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("This browser did not provide a 2D canvas context.");
  const rect = cropRect(image.naturalWidth, image.naturalHeight, crop);
  ctx.drawImage(image, rect.x, rect.y, rect.size, rect.size, 0, 0, AVATAR_EDGE, AVATAR_EDGE);
  return fitAvatarDataUrl((type, quality) => canvas.toDataURL(type, quality));
}
