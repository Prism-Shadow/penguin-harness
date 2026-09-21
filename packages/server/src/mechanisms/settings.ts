/**
 * The settings mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";

/** Settings: the mechanism ServerSettingsRepo implements. */
export abstract class Settings extends Interface<{
  get(key: string): string | null;
  set(key: string, value: string): void;
  getProxyForApp(): boolean;
  setProxyForApp(value: boolean): void;
  getProxyForAgent(): boolean;
  setProxyForAgent(value: boolean): void;
  getProxyUrl(): string | null;
  setProxyUrl(value: string | null): void;
  getAttachmentMaxMb(): number;
  setAttachmentMaxMb(value: number): void;
  getAttachmentTotalMb(): number;
  setAttachmentTotalMb(value: number): void;
  getAttachmentLimitsMb(): { attachmentMaxMb: number; attachmentTotalMb: number };
  getImageCompression(): boolean;
  setImageCompression(value: boolean): void;
  getImageCompressionOverMb(): number;
  setImageCompressionOverMb(value: number): void;
  getImageCompressionSettings(): { imageCompression: boolean; imageCompressionOverMb: number };
  getCompanyMode(): boolean;
  setCompanyMode(value: boolean): void;
}>() {}

/** UiPrefsStore: the mechanism UiPrefsRepo implements. */
export abstract class UiPrefsStore extends Interface<{
  get(userId: string): string | null;
  set(userId: string, prefsJson: string): void;
}>() {}
