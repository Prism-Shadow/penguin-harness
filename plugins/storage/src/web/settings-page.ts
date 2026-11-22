/**
 * The Storage page of the Settings dialog (`SettingsModule.sections`): Personal › Storage, what
 * the data root holds and the cleanup of what can be regenerated (storage-section.tsx).
 */
import type { SettingsSectionCode } from "@prismshadow/penguin-web-plugin";
import { StorageSection } from "./storage-section";
import { S } from "./strings";

export const storageSettingsPage: SettingsSectionCode = {
  label: () => S.storage.title,
  info: () => S.storage.info,
  Body: StorageSection,
};
