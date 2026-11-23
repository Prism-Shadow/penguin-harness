/**
 * Reading a file as text for a preview, bounded: shared by the Files panel's browser and the
 * read-only directory browser, both of which read through the Files panel's content routes.
 */
import { TEXT_PREVIEW_LIMIT, looksLikeText, utf8Complete } from "./workspace-tree";

/** Bytes examined to decide whether a file with an unknown extension is text. */
export const SNIFF_BYTES = 8 * 1024;

/**
 * Reads a file as text, bounded to TEXT_PREVIEW_LIMIT bytes: the body is read as a stream
 * and cancelled past the cap, so a large log never downloads whole for a preview. With
 * `sniff`, the first chunk decides whether the file is text at all — null means it is not,
 * and nothing more of it is read. A response with no stream is thrown on rather than read
 * whole: `arrayBuffer()` would pull the entire file into memory, which is the one thing the
 * cap exists to prevent.
 *
 * The version marker is read alongside the bytes and is required: it is what the editor
 * saves against, and a response that carries content without it could only mean the
 * endpoint is broken — better a thrown read than a save with no precondition.
 */
export async function fetchTextPreview(
  url: string,
  sniff: boolean,
): Promise<{ content: string; truncated: boolean; version: string } | null> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(String(res.status));
  if (res.body === null) throw new Error("no response body");
  const version = res.headers.get("etag");
  if (version === null) throw new Error("no version header");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (chunks.length === 0 && sniff && !looksLikeText(value.subarray(0, SNIFF_BYTES))) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
    total += value.length;
    if (total > TEXT_PREVIEW_LIMIT) {
      await reader.cancel();
      break;
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const truncated = total > TEXT_PREVIEW_LIMIT;
  const shown = truncated ? utf8Complete(bytes.subarray(0, TEXT_PREVIEW_LIMIT)) : bytes;
  return { content: new TextDecoder().decode(shown), truncated, version };
}
