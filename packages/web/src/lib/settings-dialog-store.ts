/**
 * Whether the settings dialog is open, and on which section: one store so a page can send
 * the user straight to the setting it needs (the deploy panel's missing settings) instead
 * of describing where to find it.
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand/react";
import type { SettingsSectionKey } from "./settings-sections";

export interface SettingsDialogState {
  isOpen: boolean;
  section: SettingsSectionKey | null;
  open: (section?: SettingsSectionKey) => void;
  close: () => void;
}

export function createSettingsDialogStore() {
  return createStore<SettingsDialogState>((set) => ({
    isOpen: false,
    section: null,
    open: (section) => set({ isOpen: true, section: section ?? null }),
    close: () => set({ isOpen: false, section: null }),
  }));
}

export const settingsDialog = createSettingsDialogStore();

export function useSettingsDialog<T>(select: (state: SettingsDialogState) => T): T {
  return useStore(settingsDialog, select);
}
