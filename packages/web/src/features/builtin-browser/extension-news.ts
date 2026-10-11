/**
 * The chrome entry of a server's backends after its word on the user's Chrome
 * (`builtin_browser_extension`), for the reducer in browser-state.ts.
 */
import type {
  BrowserBackendInfo,
  BrowserExtensionRecord,
  BuiltinBrowserServerEvent,
} from "@prismshadow/penguin-server/api";

/** A paired Chrome as GET /status's chrome entry carries it. */
function extensionInfo(record: BrowserExtensionRecord): BrowserBackendInfo["extension"] {
  return {
    id: record.id,
    name: record.name,
    version: record.version,
    connected: record.connected,
    lastSeenAt: record.lastSeenAt,
  };
}

/**
 * The chrome entry after the server's word on the user's Chrome. A connection makes it
 * drivable; a disconnection does not, unless the admin's switch is why; a replacement names the
 * new Chrome and waits for it to connect; a revoked Chrome that was the one shown goes, and the
 * status read that follows says whether another is still paired.
 */
export function chromeAfter(
  info: BrowserBackendInfo,
  event: Extract<BuiltinBrowserServerEvent, { type: "builtin_browser_extension" }>,
): BrowserBackendInfo {
  const record = event.extension;
  switch (event.state) {
    case "connected": {
      const shown =
        record !== undefined ? extensionInfo(record) : info.extension && { ...info.extension };
      return {
        backend: "chrome",
        available: true,
        ...(shown !== undefined ? { extension: { ...shown, connected: true } } : {}),
      };
    }
    case "disconnected": {
      const shown =
        record !== undefined ? extensionInfo(record) : info.extension && { ...info.extension };
      return {
        backend: "chrome",
        available: false,
        reason:
          info.reason === "extension_disabled" ? "extension_disabled" : "extension_disconnected",
        ...(shown !== undefined ? { extension: { ...shown, connected: false } } : {}),
      };
    }
    case "replaced":
      return record !== undefined ? { ...info, extension: extensionInfo(record) } : info;
    case "revoked": {
      if (record === undefined || info.extension?.id !== record.id) return info;
      const { extension: _revoked, ...rest } = info;
      return {
        ...rest,
        available: false,
        reason:
          info.reason === "extension_disabled" ? "extension_disabled" : "extension_disconnected",
      };
    }
  }
}
