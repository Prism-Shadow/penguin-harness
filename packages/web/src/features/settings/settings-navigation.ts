/**
 * Moving between the pages of the Settings dialog from inside one: the dialog provides it, and a
 * page that links to another (a sandbox backend's line linking to its plugin's page) reads it.
 * `open` goes the way the rail does — through the unsaved-changes guard — and `has` says whether
 * this viewer has that page at all, so a link to a page they do not have is never drawn. Outside a
 * Settings dialog there is none, and such links are not drawn either.
 */
import { createContext, useContext } from "react";

export interface SettingsNavigation {
  open(key: string): void;
  has(key: string): boolean;
}

const SettingsNavigationContext = createContext<SettingsNavigation | null>(null);

export const SettingsNavigationProvider = SettingsNavigationContext.Provider;

export function useSettingsNavigation(): SettingsNavigation | null {
  return useContext(SettingsNavigationContext);
}
