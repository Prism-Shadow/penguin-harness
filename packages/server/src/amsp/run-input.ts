/**
 * The input of an Agent API run, as `POST …/runs` and `POST …/sessions/:id/tasks` take it:
 * `input` is a string, or text and `image_url` items, and becomes the run's user messages — texts
 * first, then images, as the composer submits them.
 */
import { imageUrlMessage, userText } from "@prismshadow/penguin-core";
import type { AmspRecord } from "@prismshadow/penguin-core";
import { badRequest } from "../http/validate.js";
import { INLINE_IMAGE_MAX_BYTES, INLINE_IMAGE_MAX_MB } from "../services/attachment-limits.js";

/**
 * A base64 `data:` URL of an image: an `image/*` MIME, the `;base64,` marker, a non-empty body.
 * The same shape the tasks route admits, narrowed to images: the API takes no files in v1.
 */
const IMAGE_DATA_URL = /^data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/;

/** Decoded size of a base64 data URL, from its length (padding and whitespace carry no bytes). */
function dataUrlBytes(url: string): number {
  const payload = url.slice(url.indexOf(",") + 1).replace(/[=\s]+/g, "");
  return Math.floor((payload.length * 3) / 4);
}

/**
 * `input` as the run's messages: a string is one user text; items are texts and images, texts
 * first. At least one non-empty text or one image. A `data:` image must be an image MIME within
 * the inline-image cap, and all of them together within the admin's per-message total; an
 * http(s) URL is passed on untouched (the server does not fetch it).
 */
export function parseRunInput(input: unknown, totalImageBytes: number): AmspRecord[] {
  const empty = () =>
    badRequest("input must be a non-empty string, or an array of text and image_url items.");
  if (typeof input === "string") {
    if (input.trim() === "") throw empty();
    return [userText(input)];
  }
  if (!Array.isArray(input) || input.length === 0) throw empty();
  const texts: AmspRecord[] = [];
  const images: AmspRecord[] = [];
  let imageBytes = 0;
  input.forEach((item: unknown, i) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw badRequest(`input[${i}] must be an object.`);
    }
    const part = item as Record<string, unknown>;
    if (part.type === "text") {
      if (typeof part.text !== "string" || part.text.trim() === "") {
        throw badRequest(`input[${i}].text must be a non-empty string.`);
      }
      texts.push(userText(part.text));
      return;
    }
    if (part.type === "image_url") {
      const url = part.image_url;
      if (typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"))) {
        images.push(imageUrlMessage(url));
        return;
      }
      if (typeof url !== "string" || !url.startsWith("data:image/")) {
        throw badRequest(
          `input[${i}].image_url must be an http(s) URL or a base64 data URL of an image (data:image/<type>;base64,<bytes>).`,
        );
      }
      // Sized before it is pattern-checked: an oversized body is refused without a scan.
      const bytes = dataUrlBytes(url);
      if (bytes > INLINE_IMAGE_MAX_BYTES) {
        throw badRequest(
          `input[${i}].image_url exceeds the ${INLINE_IMAGE_MAX_MB}MB inline image limit.`,
        );
      }
      if (!IMAGE_DATA_URL.test(url)) {
        throw badRequest(
          `input[${i}].image_url must be an http(s) URL or a base64 data URL of an image (data:image/<type>;base64,<bytes>).`,
        );
      }
      imageBytes += bytes;
      images.push(imageUrlMessage(url));
      return;
    }
    if (part.type === "file") {
      throw badRequest(`input[${i}]: the Agent API takes no files; send text and image_url items.`);
    }
    throw badRequest(`input[${i}].type must be text or image_url.`);
  });
  if (imageBytes > totalImageBytes) {
    throw badRequest(
      `input's images exceed the ${Math.floor(totalImageBytes / (1024 * 1024))}MB per-message limit.`,
    );
  }
  return [...texts, ...images];
}
