/**
 * Save a zip the server builds from a POSTed list: fetch it, then save it through a temporary
 * object-URL anchor. A bare `<a download>` cannot POST, and a failure would be saved as a
 * file; fetching first lets a failure come back as an ApiError the caller can word. The
 * server's Content-Disposition names the file; `fallbackName` covers a missing header.
 */
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";

export async function downloadBundle(
  url: string,
  body: unknown,
  fallbackName: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network_error", S.errors.networkError);
  }
  if (!res.ok) {
    const error = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiError(
      res.status,
      error?.error?.code ?? "http_error",
      error?.error?.message ?? S.common.unknownError,
    );
  }
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(
    res.headers.get("content-disposition") ?? "",
  )?.[1];
  let name = fallbackName;
  try {
    if (encoded) name = decodeURIComponent(encoded);
  } catch {
    // A malformed header keeps the fallback name.
  }
  const objectUrl = URL.createObjectURL(await res.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked after the click has been handed to the browser's download.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
