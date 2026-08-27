/**
 * server_settings table repo (admin-level server-global settings): key-value storage
 * with JSON-encoded values. An absent row means the setting's built-in default, so
 * settings added after a web.db was formed need no migration.
 */
import type { DatabaseSync } from "node:sqlite";
import {
  clampImageCompressionOverMb,
  DEFAULT_IMAGE_COMPRESSION,
  DEFAULT_IMAGE_COMPRESSION_OVER_MB,
} from "../../services/image-compression.js";
import type { ImageCompressionSettings } from "../../services/image-compression.js";

/** Key of the "application uses the proxy" switch (the server's own outbound dispatcher); default on. */
const PROXY_FOR_APP_KEY = "proxy_for_app";

/** Key of the "agent environment uses the proxy" switch (command subprocess env policy); default on. */
const PROXY_FOR_AGENT_KEY = "proxy_for_agent";

/**
 * Legacy single-switch key from the unreleased #225 iteration (never in a release): read
 * as the fallback default for BOTH new switches while their own keys are absent, so a
 * main-branch deployment that had toggled it keeps its choice. Read-only adoption — the
 * legacy key is never written back, and either new key, once set, wins for its switch.
 */
const LEGACY_USE_SYSTEM_PROXY_KEY = "use_system_proxy";

/** Key of the explicit proxy address; absent/null = follow the proxy environment variables. */
const PROXY_URL_KEY = "proxy_url";

/** Key of the "compress large images in the composer" switch; default DEFAULT_IMAGE_COMPRESSION. */
const IMAGE_COMPRESSION_KEY = "image_compression";

/** Key of the size above which an image is re-encoded, in whole MB; default DEFAULT_IMAGE_COMPRESSION_OVER_MB. */
const IMAGE_COMPRESSION_OVER_MB_KEY = "image_compression_over_mb";

export class ServerSettingsRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Returns the raw JSON-encoded value; null if never set. */
  get(key: string): string | null {
    const r = this.db.prepare("SELECT value FROM server_settings WHERE key = ?").get(key);
    return r ? (r.value as string) : null;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO server_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  /** Shared switch read: this key if present, else the legacy single switch, else the default: on. */
  private getProxySwitch(key: string): boolean {
    const raw = this.get(key);
    if (raw !== null) return raw !== "false";
    return this.get(LEGACY_USE_SYSTEM_PROXY_KEY) !== "false";
  }

  /** The "application uses the proxy" switch (the server's own outbound dispatcher). */
  getProxyForApp(): boolean {
    return this.getProxySwitch(PROXY_FOR_APP_KEY);
  }

  setProxyForApp(value: boolean): void {
    this.set(PROXY_FOR_APP_KEY, JSON.stringify(value));
  }

  /** The "agent environment uses the proxy" switch (command subprocess env policy). */
  getProxyForAgent(): boolean {
    return this.getProxySwitch(PROXY_FOR_AGENT_KEY);
  }

  setProxyForAgent(value: boolean): void {
    this.set(PROXY_FOR_AGENT_KEY, JSON.stringify(value));
  }

  /**
   * The explicit proxy address (normalized at write time by the settings route); null =
   * follow the proxy environment variables. An absent or unreadable row reads as null
   * (the safe default: behave as before the setting existed).
   */
  getProxyUrl(): string | null {
    const raw = this.get(PROXY_URL_KEY);
    if (raw === null) return null;
    try {
      const value: unknown = JSON.parse(raw);
      return typeof value === "string" && value !== "" ? value : null;
    } catch {
      return null;
    }
  }

  setProxyUrl(value: string | null): void {
    this.set(PROXY_URL_KEY, JSON.stringify(value));
  }

  /** Whether the composer re-encodes images above the threshold before uploading them. */
  getImageCompression(): boolean {
    const raw = this.get(IMAGE_COMPRESSION_KEY);
    if (raw === null) return DEFAULT_IMAGE_COMPRESSION;
    return raw !== "false";
  }

  setImageCompression(value: boolean): void {
    this.set(IMAGE_COMPRESSION_KEY, JSON.stringify(value));
  }

  /**
   * The size above which an image is re-encoded, in whole MB. Clamped on read: values only ever
   * enter through the validated PUT, so this covers a database that predates a change to the
   * bounds (or was hand-edited), where the nearest legal number beats refusing to serve.
   */
  getImageCompressionOverMb(): number {
    const raw = this.get(IMAGE_COMPRESSION_OVER_MB_KEY);
    if (raw === null) return DEFAULT_IMAGE_COMPRESSION_OVER_MB;
    try {
      const value: unknown = JSON.parse(raw);
      return typeof value === "number"
        ? clampImageCompressionOverMb(value, DEFAULT_IMAGE_COMPRESSION_OVER_MB)
        : DEFAULT_IMAGE_COMPRESSION_OVER_MB;
    } catch {
      return DEFAULT_IMAGE_COMPRESSION_OVER_MB;
    }
  }

  setImageCompressionOverMb(value: number): void {
    this.set(IMAGE_COMPRESSION_OVER_MB_KEY, JSON.stringify(value));
  }

  /**
   * The pair as one value — what `/api/me` and the settings form both read. The switch and the
   * threshold are only meaningful together: a threshold is a statement about an inactive feature
   * while the switch is off, and the form edits both in one PUT for that reason.
   */
  getImageCompressionSettings(): ImageCompressionSettings {
    return {
      imageCompression: this.getImageCompression(),
      imageCompressionOverMb: this.getImageCompressionOverMb(),
    };
  }
}
