/**
 * Which origins speak for the PenguinHarness Browser extension, on its WebSocket and its
 * pairing route: its own, whose id the manifest's pinned key fixes (the same unpacked and from
 * the Chrome Web Store), and — on a dev-profile server only — any extension's, so a build
 * loaded with another id can be tried. A web page's origin never does.
 *
 * Runs in the runtime's upgrade handler as well as in the platform, so it imports nothing of
 * the platform's.
 */
import { profileFromEnv } from "../machines/layout.js";

/** The extension's id, as its pinned manifest key fixes it. */
export const PENGUIN_EXTENSION_ID = "dodgfhpcbmkjfcbgnoidablfgjjhhmgp";

export function isPenguinExtensionOrigin(
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "chrome-extension:") return false;
  return url.host === PENGUIN_EXTENSION_ID || profileFromEnv(env) === "dev";
}
