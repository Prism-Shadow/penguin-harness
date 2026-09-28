/**
 * Quick Switcher (Ctrl/Cmd+K): a keyboard-first palette for jumping to a page or a coding
 * agent. Mounted only while open by the app shell, so the agents fetch fires on open rather
 * than on app boot, and every other surface pays nothing for it.
 *
 * Overlay follows the portal-panel pattern (components/ui/use-portal-panel.ts): portaled
 * to body at z-[60] so it clears an open dialog's z-50 overlay; outside mousedown closes,
 * Esc closes during capture with stopPropagation (so a dialog underneath keeps its own
 * Esc handling — one press, one layer), and the panel's own list scroll is exempt from
 * the scroll dismissal. There is no trigger element, so the hook's measured position is
 * unused — the palette is centered against the viewport (Modal's look: white card, gray
 * border, shadow) instead of anchored.
 *
 * Keyboard: arrows move the selection (wrapping, nextSwitcherCursor), Enter opens,
 * Esc closes; the selection auto-scrolls into view; mouse hover selects and click opens.
 * The palette input owns the keyboard while open, so typing into it needs no exemption in
 * the shell's keybind. An IME composition (selecting/committing CJK candidates) is left
 * alone — ArrowUp/Down/Enter belong to the picker until the composition ends.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../../state/auth";
import { useProject } from "../../state/project";
import type { ActivityRecord, CodingAgentServerInfo } from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { listCodingAgents } from "../../api/endpoints";
import { navKeysFor } from "../../lib/nav-group-collapse";
import {
  buildActivityEntries,
  buildAgentEntries,
  buildPageEntries,
  filterSwitcherEntries,
  nextSwitcherCursor,
} from "../../lib/quick-switcher";
import type { SwitcherEntry } from "../../lib/quick-switcher";
import {
  pushQuickSwitcherRecent,
  readQuickSwitcherRecents,
} from "../../lib/quick-switcher-recents";
import { S } from "../../lib/strings";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { toneDot } from "../../lib/tone";
import { GlyphIcon } from "../ui/glyph-icon";
import { NAV_ICONS } from "../ui/icons";
import { menuSearchClass, noAutofill } from "../ui/input";
import { usePortalPanel } from "../ui/use-portal-panel";

/** Section heading of the palette list, at the overflow menus' label density (menuSectionClass convention). */
const sectionHeaderClass =
  "px-3.5 pb-0.5 pt-1.5 text-[11px] font-medium text-gray-400 dark:text-gray-500";

/** A palette row: full-width, hover/selection fill, at the menu rows' density (menuItemClass convention). */
const rowClass = (active: boolean) =>
  `flex min-w-0 cursor-pointer items-center ${ICON_GAP.menu} px-3.5 py-1.5 text-left transition-colors duration-150 ${
    active ? "bg-gray-100 dark:bg-gray-800" : ""
  }`;

/** Footer key-cap chip (↑ ↓ ↵ esc hints). */
const kbdClass =
  "rounded border border-gray-200 bg-gray-50 px-1 font-mono text-[11px] leading-4 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400";

/** Section titles: pages/recents name themselves; agents reuse the coding agents' own heading. */
function sectionTitle(section: SwitcherEntry["section"] | "recents"): string {
  if (section === "recents") return S.quickSwitcher.recentsSection;
  if (section === "pages") return S.quickSwitcher.pagesSection;
  if (section === "activities") return S.quickSwitcher.activitiesSection;
  return S.codingAgents.agentsTitle;
}

/** Row glyph: pages wear their nav icon; agents and activities share the coding-agents/activities marks. */
function rowGlyph(entry: SwitcherEntry): string | null {
  if (entry.section === "pages") {
    // The id was built from a nav key (lib/nav-group-collapse.ts), whose set NAV_ICONS covers.
    const key = entry.id.slice("page:".length) as keyof typeof NAV_ICONS;
    return NAV_ICONS[key] ?? null;
  }
  if (entry.section === "agents") return NAV_ICONS["coding-agents"];
  if (entry.section === "activities") return NAV_ICONS["activities"] ?? null;
  return null;
}

export function QuickSwitcherPalette({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { currentProject } = useProject();
  const navigate = useNavigate();
  // Fetches on mount — and this component mounts only while the palette is open.
  const [agents, setAgents] = useState<CodingAgentServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    listCodingAgents()
      .then((res) => {
        if (!cancelled) setAgents(res.agents);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // This project's activities, one entry each; a project without activities access (or no
  // current project) simply shows none — the error is swallowed, not surfaced.
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  useEffect(() => {
    if (!currentProject) return;
    let cancelled = false;
    apiFetch<{ activities: ActivityRecord[] }>(
      `/api/projects/${encodeURIComponent(currentProject.projectId)}/activities`,
    )
      .then((res) => {
        if (!cancelled) setActivities(res.activities);
      })
      .catch(() => {
        /* No activities access on this project; the section stays empty. */
      });
    return () => {
      cancelled = true;
    };
  }, [currentProject]);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // The hook's scroll rule is answered with the element this panel hangs from. The
  // palette has no trigger button; its anchor is the input, so that ref is the input's —
  // and focus follows the same ref. The measured position is unused: the palette is
  // centered against the viewport, so its position cannot go stale. The cast only bridges
  // the hook's trigger typing (HTMLButtonElement); the rule reads the node for `contains`.
  const inputRef = useRef<HTMLInputElement>(null);
  const { triggerRef, panelRef } = usePortalPanel({ open: true, onClose, estimatedHeight: 420 });
  const setAnchorRef = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    triggerRef.current = node as unknown as HTMLButtonElement | null;
  };

  // The dialog gave focus to the input on mount (effect below); hand it back on close,
  // the way Modal does for its own close paths.
  const restoreFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  useEffect(() => {
    inputRef.current?.focus();
    return () => restoreFocusRef.current?.focus();
  }, []);

  const entries = useMemo(
    () => [
      ...buildPageEntries(
        navKeysFor(user?.isAdmin === true).map((key) => ({ key, title: S.nav[key] })),
      ),
      ...buildAgentEntries(
        agents.map((agent) => ({
          id: agent.id,
          title: agent.title ?? agent.id,
          command: [agent.command, ...agent.args].join(" "),
        })),
      ),
      ...buildActivityEntries(activities),
    ],
    [user?.isAdmin, agents, activities],
  );

  // Recents are read once per open; a selection made this session is pushed straight through.
  const recents = useMemo(() => readQuickSwitcherRecents(), []);
  const groups = useMemo(
    () => filterSwitcherEntries(query, entries, recents),
    [query, entries, recents],
  );
  const flat = useMemo(() => groups.flatMap((group) => group.entries), [groups]);

  // A new query restarts at the top; a shrunk result set lands back on it rather than
  // pointing past the end.
  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    if (cursor >= flat.length && cursor !== 0) setCursor(0);
  }, [flat.length, cursor]);

  // Keep the highlighted row in view as the cursor moves (list scroll is inside the
  // panel, so the portal hook's scroll dismissal does not fire for it).
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor, groups]);

  const select = (entry: SwitcherEntry) => {
    pushQuickSwitcherRecent(entry.id);
    onClose();
    navigate(entry.to, entry.routeState === null ? undefined : { state: entry.routeState });
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // An IME composition owns these keys until it commits (Unicode/IME contract).
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => nextSwitcherCursor(c, flat.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => nextSwitcherCursor(c, flat.length, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = cursor < flat.length ? flat[cursor] : undefined;
      if (hit !== undefined) select(hit);
    }
  };

  let rowIdx = -1;
  return createPortal(
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/45 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={S.quickSwitcher.title}
        className="mx-auto mt-[10vh] w-full max-w-lg overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="border-b border-gray-200 px-3 py-2.5 dark:border-gray-800">
          <input
            ref={setAnchorRef}
            className={`${menuSearchClass} px-1 py-0.5`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={S.quickSwitcher.placeholder}
            aria-label={S.quickSwitcher.placeholder}
            spellCheck={false}
            {...noAutofill}
          />
        </div>
        <div
          ref={listRef}
          role="listbox"
          aria-label={S.quickSwitcher.title}
          className="max-h-72 overflow-y-auto py-1"
        >
          {flat.length === 0 && !loading ? (
            <div className="px-3.5 py-3 text-sm text-gray-500 dark:text-gray-400">
              {loadError ? S.codingAgents.loadFailed : S.quickSwitcher.noMatches}
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.section} role="presentation">
                <div className={sectionHeaderClass}>{sectionTitle(group.section)}</div>
                {group.entries.map((entry) => {
                  rowIdx += 1;
                  const idx = rowIdx;
                  const active = idx === cursor;
                  const glyph = rowGlyph(entry);
                  const status =
                    entry.busy !== null
                      ? entry.busy
                        ? S.codingAgents.busy
                        : S.codingAgents.idle
                      : null;
                  return (
                    <div
                      key={entry.id}
                      data-idx={idx}
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setCursor(idx)}
                      // Click selects; there is no focus ring to duplicate — the palette's
                      // own selection is the cursor, driven by hover, arrows and Enter.
                      onClick={() => select(entry)}
                      className={rowClass(active)}
                    >
                      {glyph !== null ? (
                        <GlyphIcon
                          d={glyph}
                          size={ICON_SIZE.inlineGlyph}
                          className="shrink-0 text-gray-400 dark:text-gray-500"
                        />
                      ) : entry.busy !== null ? (
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            entry.busy ? toneDot.busy : toneDot.muted
                          }`}
                          aria-hidden
                        />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-gray-100">
                        {entry.title}
                        {status !== null && <span className="sr-only">{`. ${status}`}</span>}
                      </span>
                      {entry.detail !== null ? (
                        <span className="max-w-[45%] shrink truncate text-xs text-gray-500 dark:text-gray-400">
                          {entry.detail}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
          {loading && flat.length === 0 ? (
            <div className="px-3.5 py-3 text-sm text-gray-500 dark:text-gray-400">
              {S.quickSwitcher.loading}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-4 border-t border-gray-200 px-3.5 py-2 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
          <span className="flex items-center gap-1">
            <kbd className={kbdClass}>↑</kbd>
            <kbd className={kbdClass}>↓</kbd>
            {S.quickSwitcher.navigateHint}
          </span>
          <span className="flex items-center gap-1">
            <kbd className={kbdClass}>↵</kbd>
            {S.quickSwitcher.openHint}
          </span>
          <span className="flex items-center gap-1">
            <kbd className={kbdClass}>esc</kbd>
            {S.quickSwitcher.closeHint}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
