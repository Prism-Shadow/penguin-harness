/**
 * What this runtime still knows of the agent browser by name, for a platform pushed before the
 * generic seams it now goes through (2026-11-19). A runtime restores whatever version was pushed
 * last, older than itself included, and such a platform has neither seam:
 *
 * - no WebSocket endpoints (`HttpModule.upgrades`): its browser module provides only the gate the
 *   runtime used to look up by name, `BuiltinBrowserModule` / `BrowserExtensionGate`, so the
 *   runtime runs the extension's handshake (builtin-browser/extension-ws.ts) over that gate —
 *   503 when the generation has no browser;
 * - no `Http.ownOrigin`: the runtime's same-origin check in front of the seam (app.ts) exempts
 *   the extension's pairing route by its path, as the hard-coded rule did.
 *
 * The other direction needs no code here: an installed runtime older than the seams only ever
 * does that name lookup, so the browser module keeps providing those two names beside its
 * contributed endpoint (builtin-browser/module.ts).
 *
 * Compatibility code, kept until 1.0 like the repo's other compatibility code; it goes together
 * with those two names. Nothing else in the runtime names the browser.
 */
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { EXTENSION_WS_PATH, extensionUpgrade } from "../builtin-browser/extension-ws.js";
import type { ExtensionGate } from "../builtin-browser/extension-ws.js";
import type { ServerHmrHost } from "./platform.js";

const PAIR_PATH = "/api/builtin-browser/extension/pair";

/** The pairing route's exemption, for a generation that cannot name its own-origin groups. */
export function legacyOwnOrigin(path: string): boolean {
  return path.replace(/\/+$/, "") === PAIR_PATH;
}

/**
 * The extension's WebSocket over the gate the current generation provides by name: the seam's
 * fallback (upgrade-seam.ts), taking only the extension's own path.
 */
export function legacyExtensionUpgrade(
  hmr: ServerHmrHost,
  log: (line: string) => void,
): (request: IncomingMessage, socket: Duplex, head: Buffer) => boolean {
  const endpoint = extensionUpgrade({
    gate: async (): Promise<ExtensionGate | null> => {
      const platform = await hmr.ensure();
      const tree = typeof platform.api.business === "function" ? platform.api.business() : null;
      if (tree === null || !tree.has("BuiltinBrowserModule")) return null;
      try {
        return tree.api<ExtensionGate>("BuiltinBrowserModule", "BrowserExtensionGate");
      } catch {
        // A pushed platform from before the extension: no gate, so the upgrade is a 503.
        return null;
      }
    },
    log,
  });
  return (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname !== EXTENSION_WS_PATH) return false;
    endpoint.upgrade(request, socket, head);
    return true;
  };
}
