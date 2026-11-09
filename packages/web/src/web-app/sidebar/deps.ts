/**
 * What the sidebar module binds into the column and the rail (lib/module-deps.tsx): its slots'
 * contributions, read once at boot (modes.ts), and the chat drafts its New chat entries open.
 */
import { S } from "../../lib/strings";
import { createDeps } from "../../lib/module-deps";
import type { ChatDrafts } from "../../features/chat";
import type { ModeState } from "../../lib/sidebar-contributions";
import type { SidebarColumnState } from "./iface";
import { type BadgeEntry, type ModeEntry, type SectionEntry, currentModeIndex } from "./modes";

export interface SidebarDeps {
  sections: readonly SectionEntry[];
  modes: readonly ModeEntry[];
  badges: readonly BadgeEntry[];
  /** Every contributed mode's state, in `modes` order (a hook). */
  useModes: () => readonly ModeState[];
  /** The note on each badged anchor (a hook). */
  useNotes: () => ReadonlyMap<string, string>;
  drafts: ChatDrafts;
}

export const sidebarDeps = createDeps<SidebarDeps>();

/** The column's state for the layout around it (a hook over the deps' hooks). */
export function useColumnStateOf(deps: SidebarDeps): SidebarColumnState {
  const states = deps.useModes();
  const notes = deps.useNotes();
  const at = currentModeIndex(states);
  return {
    inDefaultMode: at < 0,
    listName: at < 0 ? S.chat.sessionList : deps.modes[at]!.mode.listName(),
    menuNote: notes.get("menu") ?? null,
  };
}
