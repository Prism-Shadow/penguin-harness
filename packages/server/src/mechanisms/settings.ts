/**
 * The settings mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";

/** Settings: the mechanism ServerSettingsRepo implements. */
@Interface()
export abstract class Settings {
  abstract get(key: string): string | null;
  abstract set(key: string, value: string): void;
  abstract getProxyForApp(): boolean;
  abstract setProxyForApp(value: boolean): void;
  abstract getProxyForAgent(): boolean;
  abstract setProxyForAgent(value: boolean): void;
  abstract getProxyUrl(): string | null;
  abstract setProxyUrl(value: string | null): void;
  abstract hasGithubToken(): boolean;
  /** The stored GitHub token, or null when none. */
  abstract getGithubToken(): string | null;
  abstract setGithubToken(value: string): void;
  /**
   * Compatibility member: uploads have no size limit any more, and nothing on this platform
   * reads it. It stays because a hot push replaces the platform but never the runtime, and an
   * older runtime (the packaged v0.2.13 release among them) calls it from its request
   * middleware on every request (`createApp`'s body cap, `bodyLimitBytes(settings()
   * .getAttachmentLimitsMb())`); without it every request on such a runtime answers 500. It
   * answers the limits an admin stored before they were retired, or the old defaults. Remove it
   * only when no supported runtime calls it.
   */
  abstract getAttachmentLimitsMb(): { attachmentMaxMb: number; attachmentTotalMb: number };
  abstract getImageCompression(): boolean;
  abstract setImageCompression(value: boolean): void;
  abstract getImageCompressionOverMb(): number;
  abstract setImageCompressionOverMb(value: number): void;
  abstract getImageCompressionSettings(): {
    imageCompression: boolean;
    imageCompressionOverMb: number;
  };
  abstract getCompanyMode(): boolean;
  abstract setCompanyMode(value: boolean): void;
  abstract getBrowserExtensionsEnabled(): boolean;
  abstract setBrowserExtensionsEnabled(value: boolean): void;
  abstract getAgentApiEnabled(): boolean;
  abstract setAgentApiEnabled(value: boolean): void;
  /** Hears every write, by key (a switch that must act at once, not on its next read). Returns the unsubscribe. */
  abstract watch(listener: (key: string) => void): () => void;
}

/** UiPrefsStore: the mechanism UiPrefsRepo implements. */
@Interface()
export abstract class UiPrefsStore {
  abstract get(userId: string): string | null;
  abstract set(userId: string, prefsJson: string): void;
}
