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
  abstract setGithubToken(value: string): void;
  abstract getAttachmentMaxMb(): number;
  abstract setAttachmentMaxMb(value: number): void;
  abstract getAttachmentTotalMb(): number;
  abstract setAttachmentTotalMb(value: number): void;
  abstract getAttachmentLimitsMb(): { attachmentMaxMb: number; attachmentTotalMb: number };
  abstract getCompanyMode(): boolean;
  abstract setCompanyMode(value: boolean): void;
  abstract getBrowserExtensionsEnabled(): boolean;
  abstract setBrowserExtensionsEnabled(value: boolean): void;
  /** Hears every write, by key (a switch that must act at once, not on its next read). Returns the unsubscribe. */
  abstract watch(listener: (key: string) => void): () => void;
}

/** UiPrefsStore: the mechanism UiPrefsRepo implements. */
@Interface()
export abstract class UiPrefsStore {
  abstract get(userId: string): string | null;
  abstract set(userId: string, prefsJson: string): void;
}
