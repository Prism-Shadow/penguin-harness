/**
 * The agent browser's two pages of the Settings dialog (`SettingsModule.sections`): Personal ›
 * Browser, the user's own backend choice and paired Chromes (browser-section.tsx), and Server ›
 * Chrome extension, the admin's switch over every user's Chrome (chrome-extension-section.tsx).
 */
import type { SettingsSectionCode } from "@prismshadow/penguin-web-plugin";
import { BrowserSection } from "./browser-section";
import { ChromeExtensionSection } from "./chrome-extension-section";
import { S } from "./strings";

export const browserSettingsPage: SettingsSectionCode = {
  label: () => S.settings.browserTitle,
  Body: BrowserSection,
};

export const chromeExtensionSettingsPage: SettingsSectionCode = {
  label: () => S.settings.chromeExtensionTitle,
  info: () => S.settings.chromeExtensionInfo,
  Body: ChromeExtensionSection,
};
