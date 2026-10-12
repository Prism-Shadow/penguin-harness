/**
 * The chrome backend for every user: one ExtensionLink and one backend runtime per user who has
 * connected a paired Chrome, keyed by user id. One connected Chrome per user — the last one to
 * connect wins, and the one it replaces is closed 4001 — while a user may have several paired.
 *
 * The hub decides what a presented token may do (`admit`), takes the socket on (`connect`),
 * answers the facade's questions (`state`, `info`, `list`) and acts on the user's and the
 * admin's decisions: Revoke closes that Chrome 4003, the admin's switch closes every socket 4009
 * and refuses new ones. The windows of the user hear `builtin_browser_extension` as their Chrome
 * connects, goes away, is replaced or revoked.
 */
import type {
  BrowserBackendInfo,
  BrowserExtensionRecord,
  BrowserExtensionsResponse,
  BuiltinBrowserServerEvent,
  BuiltinBrowserUnavailableReason,
} from "../api/types.js";
import type { BrowserExtensionRow, BrowserExtensionStore } from "../db/repos/browser-extensions.js";
import { BrowserBackendRuntime } from "./backend-runtime.js";
import type { BackendRuntimeDeps } from "./backend-runtime.js";
import { CLOSE, ExtensionLink } from "./extension-link.js";
import type { ExtensionLinkTiming, ExtensionSocket } from "./extension-link.js";
import { tokenHash } from "./extension-pairing.js";

/** What a presented token may do: connect, or be refused (401), or be told why with a close code. */
export type BrowserExtensionAdmission = "ok" | "unknown" | "revoked" | "disabled";

export interface ExtensionHubDeps {
  store: BrowserExtensionStore;
  /** The admin's switch (server_settings browserExtensionsEnabled). */
  enabled(): boolean;
  /** One user's channel. */
  publish(userId: string, event: BuiltinBrowserServerEvent): void;
  /** What every user's runtime shares: the homepage, the address check, timing, the log. */
  runtime: Omit<BackendRuntimeDeps, "link" | "publish" | "history">;
  linkTiming?: Partial<ExtensionLinkTiming>;
  log(line: string): void;
  now(): number;
}

interface Entry {
  userId: string;
  link: ExtensionLink;
  runtime: BrowserBackendRuntime;
  /** The pairing whose socket the link holds now (or held last). */
  extensionId: string | null;
}

export class ExtensionHub {
  private readonly entries = new Map<string, Entry>();
  private disposed = false;

  constructor(private readonly deps: ExtensionHubDeps) {}

  /** Before the upgrade: unknown tokens get a 401; the rest are let in and, if refused, told why. */
  admit(token: string): BrowserExtensionAdmission {
    const row = this.deps.store.findByTokenHash(tokenHash(token));
    if (row === null) return "unknown";
    if (row.revokedAt !== null) return "revoked";
    if (!this.deps.enabled() || this.disposed) return "disabled";
    return "ok";
  }

  /** After the upgrade: the socket becomes its user's link, or is closed with the reason. */
  connect(token: string, socket: ExtensionSocket): void {
    const admission = this.admit(token);
    const row = this.deps.store.findByTokenHash(tokenHash(token));
    if (admission !== "ok" || row === null) {
      // Revoked (or gone since the upgrade began): the extension forgets this server.
      const [code, reason] =
        admission === "disabled" ? [CLOSE.disabled, "disabled"] : [CLOSE.revoked, "revoked"];
      try {
        socket.close(code, reason);
      } catch {
        // Gone already.
      }
      return;
    }
    const entry = this.entryFor(row.userId);
    const replacing = entry.link.attached;
    entry.extensionId = row.extensionId;
    entry.link.attach(socket);
    if (replacing) {
      this.publish(entry, "replaced");
      this.deps.log(`chrome browser: ${row.userId}'s Chrome was replaced by '${row.name}'`);
    }
  }

  /** The user's chrome runtime, once they have connected a Chrome during this server's life. */
  runtimeFor(userId: string): BrowserBackendRuntime | null {
    return this.entries.get(userId)?.runtime ?? null;
  }

  /** Why the user's Chrome cannot be driven now, or null when it can. */
  unavailability(userId: string): BuiltinBrowserUnavailableReason | null {
    if (!this.deps.enabled()) return "extension_disabled";
    if (this.entries.get(userId)?.link.connected === true) return null;
    return this.deps.store.listByUser(userId).length === 0
      ? "extension_not_paired"
      : "extension_disconnected";
  }

  /** The chrome entry of GET /status's `backends`. */
  info(userId: string): BrowserBackendInfo {
    const reason = this.unavailability(userId);
    const listed = this.list(userId);
    const shown =
      listed.paired.find((record) => record.connected) ??
      [...listed.paired].sort((a, b) => (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? ""))[0];
    return {
      backend: "chrome",
      available: reason === null,
      ...(reason !== null ? { reason } : {}),
      ...(shown !== undefined
        ? {
            extension: {
              id: shown.id,
              name: shown.name,
              version: shown.version,
              connected: shown.connected,
              lastSeenAt: shown.lastSeenAt,
            },
          }
        : {}),
    };
  }

  /** GET /extension: the user's paired Chromes, which one is connected, and the admin's switch. */
  list(userId: string): BrowserExtensionsResponse {
    const connected = this.connectedId(userId);
    return {
      paired: this.deps.store.listByUser(userId).map((row) => this.record(row, connected)),
      ...(connected !== null ? { connected } : {}),
      enabled: this.deps.enabled(),
    };
  }

  /** DELETE /extension/:id: forgets the pairing, and closes its socket 4003 when it is the connected one. */
  revoke(userId: string, extensionId: string): boolean {
    const row = this.deps.store.findById(extensionId);
    if (row === null || row.userId !== userId) return false;
    if (!this.deps.store.revoke(userId, extensionId, new Date(this.deps.now()).toISOString())) {
      return false;
    }
    const entry = this.entries.get(userId);
    if (entry !== undefined && entry.extensionId === extensionId && entry.link.attached) {
      entry.link.close(CLOSE.revoked, "revoked");
    }
    this.deps.publish(userId, {
      type: "builtin_browser_extension",
      state: "revoked",
      extension: this.record(row, null),
    });
    return true;
  }

  /** The admin's switch went off: every connected Chrome is closed 4009 (and refused until it is on). */
  closeAll(): void {
    for (const entry of this.entries.values()) {
      if (entry.link.attached) entry.link.close(CLOSE.disabled, "disabled");
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) entry.runtime.dispose();
    this.entries.clear();
  }

  private connectedId(userId: string): string | null {
    const entry = this.entries.get(userId);
    return entry?.link.connected === true ? entry.extensionId : null;
  }

  private record(row: BrowserExtensionRow, connected: string | null): BrowserExtensionRecord {
    return {
      id: row.extensionId,
      name: row.name,
      version: row.version,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      connected: row.extensionId === connected,
    };
  }

  private entryFor(userId: string): Entry {
    const existing = this.entries.get(userId);
    if (existing !== undefined) return existing;
    const link = new ExtensionLink(this.deps.linkTiming, this.deps.log);
    const runtime = new BrowserBackendRuntime({
      ...this.deps.runtime,
      link,
      publish: (event) => this.deps.publish(userId, event),
    });
    const entry: Entry = { userId, link, runtime, extensionId: null };
    // After the runtime's own (it refreshes the tab list first), so "connected" means ready.
    link.onConnect(() => {
      if (entry.extensionId !== null) {
        this.deps.store.seen(
          entry.extensionId,
          new Date(this.deps.now()).toISOString(),
          link.hello?.extension?.version,
        );
      }
      this.publish(entry, "connected");
    });
    link.onDisconnect((code) => {
      if (entry.extensionId !== null) {
        this.deps.store.seen(entry.extensionId, new Date(this.deps.now()).toISOString());
      }
      // A revoke has told the windows already.
      if (code !== CLOSE.revoked) this.publish(entry, "disconnected");
    });
    this.entries.set(userId, entry);
    return entry;
  }

  private publish(entry: Entry, state: "connected" | "disconnected" | "replaced"): void {
    const row = entry.extensionId !== null ? this.deps.store.findById(entry.extensionId) : null;
    this.deps.publish(entry.userId, {
      type: "builtin_browser_extension",
      state,
      ...(row !== null ? { extension: this.record(row, this.connectedId(entry.userId)) } : {}),
    });
  }
}
