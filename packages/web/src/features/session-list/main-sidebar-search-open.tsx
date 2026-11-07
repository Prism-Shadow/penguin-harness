import { useEffect, useRef, useState } from "react";
import { S } from "../../lib/strings";
import { onCommand } from "../../lib/shortcuts/dispatcher";
import { useShortcutTitle } from "../../lib/shortcuts/use-keymap";
import type { useMainSidebarGroupMode } from "./main-sidebar-group-mode";

/** Consecutive live main statements 42..50, called once in original hook order. */
export function useMainSidebarSearchOpen(scope: ReturnType<typeof useMainSidebarGroupMode>) {
  const { inCompany, initialSearchOpen } = scope;

  /** Live title search: the input's visibility and its query (transient — never persisted). */
  const [searchOpen, setSearchOpen] = useState(initialSearchOpen);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchTitle = useShortcutTitle(S.chat.searchSessions, "sessions.search");
  const newChatTitle = useShortcutTitle(S.chat.newSessionMenu, "chat.new");
  const collapseTitle = useShortcutTitle(S.nav.collapseSidebar, "sidebar.toggle");
  // The sessions.search command: open the field, or put the caret back into an open one. It
  // declines (the browser's own key runs) when the field could not be seen: company mode has
  // no session list, and the pinned sidebar is `display: none` below the `md` breakpoint while
  // still mounted. Re-registered when the field opens or closes so the handler reads the state.
  useEffect(
    () =>
      onCommand("sessions.search", () => {
        if (inCompany) return false;
        if (rootRef.current !== null && rootRef.current.getClientRects().length === 0) return false;
        if (searchOpen) searchInputRef.current?.focus();
        else setSearchOpen(true);
      }),
    [searchOpen, inCompany],
  );
  const [searchQuery, setSearchQuery] = useState("");
  /** Header list-settings dropdown (grouping + sort radios). */
  const [listSettingsOpen, setListSettingsOpen] = useState(false);
  return {
    ...scope,
    searchOpen,
    setSearchOpen,
    searchInputRef,
    rootRef,
    searchTitle,
    newChatTitle,
    collapseTitle,
    searchQuery,
    setSearchQuery,
    listSettingsOpen,
    setListSettingsOpen,
  };
}
