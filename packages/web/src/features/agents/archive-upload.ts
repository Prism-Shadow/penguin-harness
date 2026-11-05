/**
 * The raw upload of a picked file, archive-download.ts's counterpart: the file itself is the
 * request body with `Content-Type: application/octet-stream`, so an archive of any size travels
 * as it is rather than as base64 inside JSON, which the JSON-only api client would need. A
 * refusal is re-wrapped as an ApiError — the envelope's code, message and `details`, such as the
 * id a 409 names — so apiErrorText localizes it by code as usual.
 */
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";

export async function uploadArchive<T>(url: string, file: File): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
    credentials: "same-origin",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string; details?: unknown };
    } | null;
    throw new ApiError(
      res.status,
      body?.error?.code ?? "unknown",
      body?.error?.message ?? S.common.unknownError,
      undefined,
      stringDetails(body?.error?.details),
    );
  }
  return (await res.json()) as T;
}

/** The envelope's `details` when it is an object, its string values kept (the shape ApiError carries). */
function stringDetails(raw: unknown): Record<string, string> | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
