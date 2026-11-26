/**
 * A machine's link to the server that added it (the hub): the WebSocket that server opens to
 * `/api/builtin-browser/hub/ws` through its ssh connection (hub-ws.ts admits it). Over it the
 * person's own browser over there — its built-in browser, or the Chrome its admin paired — is
 * driven for this machine's Sessions: the driver, the page scripts and the actions stay here, and
 * every command they send is carried out by the hub in that browser.
 *
 * The protocol is the extension's (extension-link.ts: this server speaks first, pings every
 * 20 s, a later socket replaces an earlier one). What differs is the profile:
 *
 * - The hub's hello is `{ version: 1, backend, hub: true }`: `backend` is the browser its admin's
 *   agents drive now, and the link's backend follows it. When that admin switches, the hub
 *   closes the socket and dials again, and the next hello names the other one.
 * - The hub creates, closes and focuses the tabs (`open-tab` names the machine's Session and its
 *   Project), throttles and measures them itself, and lets no cookie command through.
 * - Each tab belongs to the Session that opened it, and an agent's action is told to the hub
 *   (`activity`) so its window shows the agent at work.
 * - While no hub is connected the backend is `hub_disconnected`.
 */
import type { BrowserHello } from "@prismshadow/penguin-server/api";
import { SocketLink } from "./extension-link.js";
import type { ExtensionLinkTiming, SocketLinkProfile } from "./extension-link.js";
import { HUB_CAPABILITIES } from "./link.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The hub's hello, validated; null when it is not one this server speaks. */
export function parseHubHello(value: unknown): BrowserHello | null {
  if (!isRecord(value) || value.version !== 1 || value.hub !== true) return null;
  if (value.backend !== "builtin" && value.backend !== "chrome") return null;
  return { version: 1, backend: value.backend, hub: true };
}

export const HUB_LINK_PROFILE: SocketLinkProfile = {
  capabilities: HUB_CAPABILITIES,
  downReason: "hub_disconnected",
  parseHello: parseHubHello,
  // What the hub's admin drives by default on a desktop, until a hello says otherwise.
  backend: "builtin",
  name: "The server this machine was added from",
  peer: "the hub",
  logName: "hub browser",
};

/** This machine's one link to the hub, outliving its sockets. */
export class HubLink extends SocketLink {
  constructor(timing: Partial<ExtensionLinkTiming> = {}, log: (line: string) => void = () => {}) {
    super(HUB_LINK_PROFILE, timing, log);
  }
}
