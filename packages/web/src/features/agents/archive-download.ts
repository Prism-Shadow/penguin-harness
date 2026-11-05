/**
 * "Export as zip" for the Skills, Hooks and Workbenches tabs and the Agent export: fetch the
 * archive, then save it through a temporary object-URL anchor. The codebase's other downloads
 * are bare `<a href download>` anchors (trace download), but a bare anchor would save the error
 * JSON as a file when the request fails — fetching first lets a failure surface as a toast
 * instead. The JSON-only api client can't carry binary, hence the raw fetch (errors re-wrapped
 * as ApiError so apiErrorText localizes by code as usual). The server's Content-Disposition is
 * the authority on the filename (it appends -v<version> when the installed copy declares one),
 * in its encoded or its plain quoted form; `<fallbackName>.zip` covers a missing or unparseable
 * header.
 */
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";

export async function downloadArchive(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiError(
      res.status,
      body?.error?.code ?? "unknown",
      body?.error?.message ?? S.common.unknownError,
    );
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  // The plain quoted form, for a name that needs no encoding (an Agent's `<id>-<yyyymmdd>.zip`).
  const plain = /filename="([^"]+)"/i.exec(disposition)?.[1];
  const objectUrl = URL.createObjectURL(await res.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = encoded ? decodeURIComponent(encoded) : (plain ?? `${fallbackName}.zip`);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
