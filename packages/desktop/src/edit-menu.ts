/**
 * The edit group of a right-click menu as data — pure, no Electron imports (unit-tested).
 *
 * Electron draws no context menu of its own, so the shell builds one wherever it handles a
 * `context-menu`: the app's windows offer this group alone (main.ts), the built-in browser's
 * guests offer it among their other entries (builtin-browser-rules.ts). In a field it is the
 * edit commands the field allows; over a selection elsewhere, Copy; otherwise nothing.
 *
 * Each entry runs Chromium's own edit command on the contents the menu opened over, so Paste
 * raises a real `paste` event in the focused field and the page's own paste handling runs as it
 * does for the keyboard shortcut.
 *
 * The labels are written here for the tray's reason (see tray-menu.ts): the shell cannot import
 * from packages/web. The wording is Chrome's own in both languages.
 */
import type { TrayLocale } from "./tray-menu.js";

/** What an edit entry does when it is clicked. */
export type EditMenuAction = "cut" | "copy" | "paste" | "select-all";

export interface EditMenuItem {
  action: EditMenuAction;
  label: string;
}

/** What the group is built from: Electron's ContextMenuParams, reduced to what it reads. */
export interface EditMenuInput {
  locale: TrayLocale;
  isEditable: boolean;
  selectionText: string;
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean };
}

interface EditMenuLabels {
  cut: string;
  copy: string;
  paste: string;
  selectAll: string;
}

const EDIT_MENU_LABELS: Record<TrayLocale, EditMenuLabels> = {
  en: { cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select all" },
  zh: { cut: "剪切", copy: "复制", paste: "粘贴", selectAll: "全选" },
};

/** The edit entries that apply where the click landed; empty when none does. */
export function editMenuItems(input: EditMenuInput): EditMenuItem[] {
  const t = EDIT_MENU_LABELS[input.locale];
  const flags = input.editFlags;
  const items: EditMenuItem[] = [];
  if (input.isEditable) {
    if (flags.canCut) items.push({ action: "cut", label: t.cut });
    if (flags.canCopy) items.push({ action: "copy", label: t.copy });
    if (flags.canPaste) items.push({ action: "paste", label: t.paste });
    if (flags.canSelectAll) items.push({ action: "select-all", label: t.selectAll });
  } else if (input.selectionText.trim() !== "" && flags.canCopy) {
    items.push({ action: "copy", label: t.copy });
  }
  return items;
}

/** The contents an edit command runs on: a WebContents, reduced to its edit commands. */
export interface EditTarget {
  cut(): void;
  copy(): void;
  paste(): void;
  selectAll(): void;
}

export function runEditAction(target: EditTarget, action: EditMenuAction): void {
  switch (action) {
    case "cut":
      target.cut();
      return;
    case "copy":
      target.copy();
      return;
    case "paste":
      target.paste();
      return;
    case "select-all":
      target.selectAll();
      return;
  }
}
