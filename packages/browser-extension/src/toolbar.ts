/**
 * The toolbar button: a grey icon while no server is connected (or while paused), the coloured
 * one while at least one is; the badge counts the tabs handed over; the title says which.
 *
 * A click on an ordinary tab hands it over at once (the user's consent gesture) when exactly one
 * server is paired and nothing needs the user's attention. Everywhere else (a tab already handed
 * over, a page Chrome does not let extensions drive, several servers to choose from, a paused
 * extension, a connection another Chrome took over) the click opens the popup instead.
 */
import { isRestrictedUrl } from "./policy.js";
import type { ConnectionStatus } from "./storage.js";
import { strings } from "./strings.js";

export const POPUP_PAGE = "pages/popup.html";

const SIZES = [16, 32, 48, 128] as const;
const iconSet = (prefix: string) =>
  Object.fromEntries(SIZES.map((size) => [String(size), `/icons/${prefix}-${size}.png`]));

export interface ToolbarInput {
  servers: { label: string; status: ConnectionStatus | undefined }[];
  paused: boolean;
  driven: number;
}

export function toolbarState(input: ToolbarInput): {
  lit: boolean;
  title: string;
  badge: string;
} {
  const connected = input.servers.filter((s) => s.status === "connected").map((s) => s.label);
  const badge = input.driven > 0 ? String(input.driven) : "";
  if (input.paused) return { lit: false, title: strings.titlePaused, badge };
  if (connected.length === 0) return { lit: false, title: strings.titleNotConnected, badge };
  return { lit: true, title: strings.titleConnected(connected.join(", ")), badge };
}

export async function applyToolbar(input: ToolbarInput): Promise<void> {
  const { lit, title, badge } = toolbarState(input);
  await Promise.all([
    chrome.action.setIcon({ path: iconSet(lit ? "icon" : "icon-grey") }),
    chrome.action.setTitle({ title }),
    chrome.action.setBadgeText({ text: badge }),
    chrome.action.setBadgeBackgroundColor({ color: "#1d4ed8" }),
  ]).catch(() => {});
}

export interface PopupInput {
  url: string | undefined;
  /** The tab is handed over (and not released). */
  driven: boolean;
  servers: number;
  /** The only server's connection needs the user (replaced, protocol mismatch). */
  attention: boolean;
  paused: boolean;
}

/** The popup a tab's toolbar click opens, or "" when the click hands the tab over. */
export function popupFor(input: PopupInput): string {
  if (input.servers === 0) return input.driven ? POPUP_PAGE : "";
  if (input.driven || isRestrictedUrl(input.url)) return POPUP_PAGE;
  if (input.servers > 1 || input.attention || input.paused) return POPUP_PAGE;
  return "";
}
