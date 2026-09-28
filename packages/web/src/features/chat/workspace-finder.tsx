/**
 * The Workspace finder: the modal every Workspace picker opens (workspace-select.tsx keeps the
 * triggers). It browses one machine's folders the way a Finder open panel does — places on the
 * left, the current folder as a list, back/forward and a breadcrumb path above it, Choose
 * below — and hands back a folder and the machine it is on.
 *
 * It is a Modal like any other dialog, so it stacks on the dialogs that host the form variant
 * without anything of its own: Modal portals to body (a later modal sits above an earlier one in
 * DOM order) and joins the shared Escape stack, so one Escape closes the finder and leaves the
 * host dialog open, and closing hands focus back to the trigger.
 *
 * The component stays mounted while closed, so it reopens where it was browsing when the host
 * has no Workspace set yet (the sidebar's new-workspace button picks one after another from the
 * same place); with one set, it reopens revealing that folder in its parent.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import type { DirListResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime } from "../../lib/format";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { toneStrip } from "../../lib/tone";
import { machineLabel, nameOnMachine, workspaceMachines } from "../../lib/workspace-machines";
import type { WorkspaceMachine } from "../../lib/workspace-machines";
import { useSessions } from "../../state/sessions";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { CLOCK_ICON, FOLDER_ICON } from "../../components/ui/group-list";
import { DOWNLOAD_ICON, FILE_ICON } from "../../components/ui/icons";
import { noAutofill } from "../../components/ui/input";
import { toastError } from "../../components/ui/toast";
import {
  EMPTY_HISTORY,
  TYPE_SELECT_RESET_MS,
  baseName,
  canGoBack,
  canGoForward,
  favouritePlaces,
  finderKeyAction,
  historyStep,
  historyVisit,
  isAbsoluteDirPath,
  isFolder,
  isTypeSelectKey,
  parentOf,
  recentWorkspaces,
  resolveGoTo,
  splitBreadcrumbs,
  stepSelection,
  typeSelectIndex,
  visibleEntries,
} from "./workspace-finder-model";
import type { FinderAction, NavHistory, Place } from "./workspace-finder-model";

const BACK_ICON = "M15 18l-6-6 6-6";
const FORWARD_ICON = "M9 18l6-6-6-6";
const HOME_ICON = "M3 11l9-8 9 8M5 10v10h14V10";
const DESKTOP_ICON = "M3 4h18v12H3zM8 20h8M12 16v4";
const DRIVE_ICON = "M3 13h18v6H3zM5 13l2-8h10l2 8M17 16h.01";
const MACHINE_ICON = "M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01";
const SIDEBAR_ICON = "M4 5h16v14H4zM10 5v14";
const GO_TO_ICON = "M5 12h14M13 6l6 6-6 6";
const FILTER_ICON = "M21 21l-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0z";

const PLACE_ICON: Record<Place["key"], string> = {
  home: HOME_ICON,
  desktop: DESKTOP_ICON,
  documents: FILE_ICON,
  downloads: DOWNLOAD_ICON,
  drive: DRIVE_ICON,
};

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}

/** A touch screen has no double-click to open with, so a tap opens a folder there. */
function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

/** What the pane shows: the folder asked for, its listing when it came back, or why it did not. */
interface View {
  path: string;
  listing: DirListResponse | null;
  error: unknown;
}

const iconButtonClass =
  "shrink-0 rounded-md p-1.5 text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-500 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100";

export function WorkspaceFinder({
  open,
  onClose,
  onChoose,
  onClear,
  projectId,
  workspace,
  machineId,
  chooseMachine,
  title,
  hint,
  clearLabel,
}: {
  open: boolean;
  onClose: () => void;
  /** The chosen folder and the machine it is on (null: this server). */
  onChoose: (path: string, machineId: string | null) => void;
  /** Present when the host offers going back to "no folder" (a temporary Workspace, or the host's own default). */
  onClear?: (machineId: string | null) => void;
  projectId: string;
  /** The host's current value; revealed in its parent on open. */
  workspace: string;
  /** The machine to browse first; null or omitted is this server. */
  machineId?: string | null;
  /** Offer the Machines section. */
  chooseMachine?: boolean;
  title: string;
  hint: string;
  clearLabel: string;
}) {
  const f = S.chat.finder;
  const isMac = useMemo(isMacPlatform, []);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const crumbsRef = useRef<HTMLElement>(null);

  /**
   * The machine being browsed. Its own state rather than the prop: choosing a machine re-roots
   * the browser without touching the window's active server — a workspace on another machine
   * is chosen from here, not by going there.
   */
  const [machine, setMachine] = useState<string | null>(machineId ?? null);
  const machineRef = useRef(machine);
  machineRef.current = machine;
  const [machines, setMachines] = useState<WorkspaceMachine[]>([]);
  /** The browsed machine's home listing: the Favourites, and the platform the pane's copy depends on. */
  const [home, setHome] = useState<{ machine: string | null; listing: DirListResponse } | null>(
    null,
  );
  const [view, setView] = useState<View>({ path: "", listing: null, error: null });
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<NavHistory>(EMPTY_HISTORY);
  /** The selected row, by path — survives a reload and a filter that keeps it. */
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [gotoOpen, setGotoOpen] = useState(false);
  const [gotoDraft, setGotoDraft] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [listFocused, setListFocused] = useState(false);
  const typed = useRef({ text: "", at: 0 });

  /**
   * Monotonic id of the newest listing request. Only the newest may publish: navigations race
   * (a double-click, then Back before it lands), and a slow older answer would otherwise
   * relocate the finder after a newer one.
   */
  const loadSeq = useRef(0);

  const load = (
    target: string,
    opts: {
      machine?: string | null;
      record?: boolean;
      select?: string | null;
      /** Handles a failure instead of the pane; true when it did. */
      onError?: (err: unknown) => boolean;
    } = {},
  ) => {
    const m = opts.machine === undefined ? machine : opts.machine;
    const seq = ++loadSeq.current;
    setLoading(true);
    api
      .listDirs(projectId, target, m)
      .then((res) => {
        if (seq !== loadSeq.current) return;
        setView({ path: res.path, listing: res, error: null });
        setSelected(opts.select ?? null);
        setFilter("");
        if (opts.record !== false) setHistory((h) => historyVisit(h, res.path));
      })
      .catch((err: unknown) => {
        if (seq !== loadSeq.current) return;
        if (opts.onError?.(err) === true) return;
        // The folder that failed is where the finder now stands: its breadcrumbs lead back
        // up, and Back returns to where it came from.
        setView({ path: target, listing: null, error: err });
        setSelected(null);
        setFilter("");
        if (opts.record !== false && target !== "") setHistory((h) => historyVisit(h, target));
      })
      .finally(() => {
        if (seq === loadSeq.current) setLoading(false);
      });
  };

  const loadHome = (m: string | null) => {
    if (home?.machine === m) return;
    api
      .listDirs(projectId, "", m)
      .then((listing) => {
        if (machineRef.current === m) setHome({ machine: m, listing });
      })
      .catch(() => undefined);
  };

  /** Re-roots the finder on another machine: its home (or `target` there), a fresh history. */
  const switchMachine = (next: string | null, target = "") => {
    setMachine(next);
    machineRef.current = next;
    setHome(null);
    setHistory(EMPTY_HISTORY);
    load(target, { machine: next });
    loadHome(next);
  };

  // Each open: reveal the host's folder in its parent (on the host's machine), otherwise pick
  // up where the finder was — refreshed, since the disk may have moved on while it was closed.
  useEffect(() => {
    if (!open) return;
    setGotoOpen(false);
    setSidebarOpen(false);
    const ws = workspace.trim();
    if (ws !== "" && isAbsoluteDirPath(ws)) {
      const m = machineId ?? null;
      if (m !== machine) {
        setMachine(m);
        machineRef.current = m;
        setHome(null);
      }
      setHistory(EMPTY_HISTORY);
      const parent = parentOf(ws);
      load(parent ?? ws, { machine: m, select: parent === null ? null : ws });
      loadHome(m);
    } else if (view.listing === null && view.error === null) {
      load("");
      loadHome(machine);
    } else {
      load(view.path, { record: false, select: selected });
      loadHome(machine);
    }
    // Keyed on `open` alone: this is what opening does, not a reaction to the props moving
    // while the finder is up.
  }, [open]);

  // Focus lands in the list on open. Modal has already focused its first control by now
  // (children's effects run first), so this moves it on.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  // The machines a workspace can live on: this Project's, from the local server — the list
  // is its own, whichever server the rest of the window is using.
  useEffect(() => {
    if (!open || chooseMachine !== true) return;
    let cancelled = false;
    void api
      .getMachines(projectId)
      .then((res) => {
        if (!cancelled) setMachines(workspaceMachines(res));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, chooseMachine, projectId]);

  const { workspaceLatestByAgent } = useSessions();
  const recents = useMemo(
    () =>
      recentWorkspaces(workspaceLatestByAgent, (id) =>
        chooseMachine === true
          ? id === null || machines.some((m) => m.selectable && m.id === id)
          : id === machine,
      ),
    [workspaceLatestByAgent, chooseMachine, machines, machine],
  );
  const favourites = useMemo(
    () => favouritePlaces(home?.machine === machine ? home.listing : null),
    [home, machine],
  );
  /**
   * The Machines section shows whenever this surface offers machines at all, not only when
   * more than one is reachable: a control that disappears when the answer is "just this one"
   * reads as a missing feature.
   */
  const machineSection = chooseMachine === true && machines.length > 0;

  const entries = useMemo(
    () => visibleEntries(view.listing?.entries ?? [], filter),
    [view.listing, filter],
  );
  const selIndex = selected === null ? -1 : entries.findIndex((e) => e.path === selected);
  const selectedEntry = selIndex === -1 ? null : (entries[selIndex] ?? null);
  const chooseTarget = selectedEntry?.path ?? view.listing?.path ?? null;
  const platform =
    view.listing?.platform ?? (home?.machine === machine ? home.listing.platform : undefined);
  const crumbs = splitBreadcrumbs(view.path);

  // Keep the selected row in sight as the keyboard moves it.
  useEffect(() => {
    if (selIndex === -1) return;
    document.getElementById(`${listId}-${selIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [selIndex, listId, open]);

  // A long path scrolls its breadcrumbs to the end, where the current folder is.
  useLayoutEffect(() => {
    const el = crumbsRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [view.path, open]);

  // Closed, render nothing: the finder stays mounted to keep its place, and every picker's
  // copy re-renders with the Sessions list, which changes far more often than it is opened.
  // Unmounting Modal is itself a close path (Escape layer popped, focus handed back).
  if (!open) return null;

  /*
   * Relative moves (back, forward, parent, open) wait for the folder on screen to be the one
   * loaded: they are computed from it, so a second press while the first is in flight would
   * resend the same target — two presses of "parent" climbing one level. Absolute ones (a
   * place, a breadcrumb, a typed path) name their target outright and may supersede a load.
   */
  const step = (delta: -1 | 1) => {
    if (loading) return;
    const next = historyStep(history, delta);
    const target = next.entries[next.index];
    if (next === history || target === undefined) return;
    setHistory(next);
    // Back from a subfolder selects it, the way Finder does.
    load(target, { record: false, select: view.path });
  };

  const goParent = () => {
    if (loading) return;
    const parent = view.listing?.parent ?? parentOf(view.path);
    if (parent !== null) load(parent, { select: view.path });
  };

  const openEntry = (path: string) => {
    if (!loading) load(path);
  };

  const choose = () => {
    if (chooseTarget === null || loading) return;
    onChoose(chooseTarget, machine);
  };

  const openGoto = () => {
    setGotoDraft(view.listing?.path ?? view.path);
    setGotoOpen(true);
  };

  const commitGoto = () => {
    const target = resolveGoTo(gotoDraft, home?.machine === machine ? home.listing.path : null);
    setGotoOpen(false);
    listRef.current?.focus();
    if (target === "" || target === view.listing?.path) return;
    load(target, {
      // A path that is not there (or not a path) keeps the finder where it was; a folder that
      // is there and refuses to be read is somewhere, and the pane says why it shows nothing.
      onError: (err) => {
        if (err instanceof ApiError && err.code === "dir_permission_denied") return false;
        toastError(S.chat.workspaceDirInvalid);
        return true;
      },
    });
  };

  const run = (action: FinderAction) => {
    switch (action) {
      case "down":
      case "up": {
        const i = stepSelection(entries, selIndex, action === "down" ? 1 : -1);
        const entry = entries[i];
        if (entry !== undefined) setSelected(entry.path);
        return;
      }
      case "first":
      case "last": {
        const entry = entries[stepSelection(entries, -1, action === "first" ? 1 : -1)];
        if (entry !== undefined) setSelected(entry.path);
        return;
      }
      case "open":
        if (selectedEntry !== null && isFolder(selectedEntry)) openEntry(selectedEntry.path);
        return;
      case "parent":
        goParent();
        return;
      case "back":
        step(-1);
        return;
      case "forward":
        step(1);
        return;
      case "goto":
        if (gotoOpen) setGotoOpen(false);
        else openGoto();
        return;
      case "choose":
        choose();
        return;
    }
  };

  const typeSelect = (ch: string) => {
    const now = Date.now();
    const prev = typed.current;
    const text = now - prev.at > TYPE_SELECT_RESET_MS ? ch : prev.text + ch;
    typed.current = { text, at: now };
    const entry = entries[typeSelectIndex(entries, text.trimStart())];
    if (entry !== undefined) setSelected(entry.path);
  };

  /**
   * One key map for the whole finder. The list owns its arrows, Enter and type-to-select; the
   * filter box steers the list with Up/Down like a combobox; the Finder chords work from
   * anywhere except that a text field keeps its own ⌘/Ctrl+arrows (they move the caret there).
   */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing) return;
    const target = e.target as HTMLElement;
    const inList = target === listRef.current;
    const inFilter = target === filterRef.current;
    // The go-to field is a path being typed: only its own chord (which closes it) applies.
    const inGoto = target.tagName === "INPUT" && !inFilter;
    const action = finderKeyAction(e, isMac, inList);
    if (action === null) {
      if (inList && isTypeSelectKey(e)) {
        e.preventDefault();
        typeSelect(e.key);
      }
      return;
    }
    if (inGoto && action !== "goto") return;
    const listKey = action === "up" || action === "down" || action === "first" || action === "last";
    if (listKey && !inList && !inFilter) return;
    if ((action === "open" || action === "parent") && inFilter) return;
    e.preventDefault();
    e.stopPropagation();
    run(action);
  };

  const permissionDenied =
    view.error instanceof ApiError && view.error.code === "dir_permission_denied";
  const hasRows = view.error === null && entries.length > 0;

  const sideRow = (
    key: string,
    icon: string,
    label: string,
    fullTitle: string,
    active: boolean,
    onClick: () => void,
    extra?: ReactNode,
    disabled = false,
  ) => (
    <li key={key}>
      <button
        type="button"
        title={fullTitle}
        disabled={disabled}
        aria-current={active ? "location" : undefined}
        onClick={() => {
          setSidebarOpen(false);
          onClick();
        }}
        className={`flex w-full items-center ${ICON_GAP.menu} rounded-md px-2 py-1 text-left text-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
          active
            ? "bg-gray-200 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
            : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800/60"
        }`}
      >
        <GlyphIcon d={icon} size={ICON_SIZE.rowLead} className="shrink-0 text-gray-400" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {extra}
      </button>
    </li>
  );

  const sideHeading = (text: string) => (
    <p className="px-2 pb-1 pt-3 text-xs font-medium text-gray-400 first:pt-0 dark:text-gray-500">
      {text}
    </p>
  );

  const sidebar = (
    <aside
      className={`${
        sidebarOpen ? "absolute inset-y-0 left-0 z-10 flex w-64 shadow-xl" : "hidden"
      } shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-gray-50 px-2 py-3 sm:static sm:flex sm:w-48 sm:shadow-none dark:border-gray-800 dark:bg-gray-950`}
    >
      {favourites.length > 0 && (
        <>
          {sideHeading(f.favourites)}
          <ul className="space-y-0.5">
            {favourites.map((place) =>
              sideRow(
                `fav:${place.path}`,
                PLACE_ICON[place.key],
                place.key === "home" || place.key === "drive" ? place.label : f.places[place.key],
                place.path,
                view.path === place.path,
                () => load(place.path),
              ),
            )}
          </ul>
        </>
      )}
      {recents.length > 0 && (
        <>
          {sideHeading(f.recent)}
          <ul className="space-y-0.5">
            {recents.map((r) =>
              sideRow(
                `recent:${r.machineId ?? ""}:${r.path}`,
                CLOCK_ICON,
                nameOnMachine(
                  baseName(r.path),
                  r.machineId === null ? null : machineLabel(machines, r.machineId),
                ),
                r.path,
                r.machineId === machine && view.path === r.path,
                () => (r.machineId === machine ? load(r.path) : switchMachine(r.machineId, r.path)),
              ),
            )}
          </ul>
        </>
      )}
      {/* Choosing a machine re-roots the finder at that machine's home: a path is only
          meaningful on the machine it is on, so carrying the current one across would be a
          path that likely does not exist there. */}
      {machineSection && (
        <>
          {sideHeading(f.machines)}
          <ul className="space-y-0.5">
            {machines.map((entry, index) =>
              sideRow(
                entry.selectable ? `machine:${entry.id ?? "local"}` : `machine-unusable:${index}`,
                MACHINE_ICON,
                entry.label,
                entry.label,
                entry.selectable && entry.id === machine,
                () => {
                  if (entry.id !== machine) switchMachine(entry.id);
                },
                entry.local ? (
                  <span className="shrink-0 text-xs text-gray-400">{S.chat.workspaceHere}</span>
                ) : entry.reason !== undefined ? (
                  // A machine that cannot be browsed says why on its own row, where the
                  // question is asked.
                  <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                    {S.chat.workspaceMachineWhy[entry.reason]}
                  </span>
                ) : undefined,
                !entry.selectable,
              ),
            )}
          </ul>
        </>
      )}
    </aside>
  );

  const shortcut = (mac: string, other: string) => (isMac ? mac : other);

  const toolbar = (
    <div
      className={`flex items-center ${ICON_GAP.tight} border-b border-gray-200 px-2 py-1.5 dark:border-gray-800`}
    >
      <button
        type="button"
        className={`${iconButtonClass} sm:hidden`}
        aria-label={sidebarOpen ? f.hideSidebar : f.showSidebar}
        aria-expanded={sidebarOpen}
        onClick={() => setSidebarOpen((v) => !v)}
      >
        <GlyphIcon d={SIDEBAR_ICON} size={ICON_SIZE.iconButton} />
      </button>
      <button
        type="button"
        className={iconButtonClass}
        disabled={!canGoBack(history)}
        title={`${f.back} (${shortcut("⌘[", "Ctrl+[")})`}
        aria-label={f.back}
        onClick={() => step(-1)}
      >
        <GlyphIcon d={BACK_ICON} size={ICON_SIZE.iconButton} />
      </button>
      <button
        type="button"
        className={iconButtonClass}
        disabled={!canGoForward(history)}
        title={`${f.forward} (${shortcut("⌘]", "Ctrl+]")})`}
        aria-label={f.forward}
        onClick={() => step(1)}
      >
        <GlyphIcon d={FORWARD_ICON} size={ICON_SIZE.iconButton} />
      </button>
      <nav
        ref={crumbsRef}
        aria-label={f.path}
        className="min-w-0 flex-1 overflow-x-auto px-1 [scrollbar-width:none]"
      >
        <ol className="flex items-center whitespace-nowrap font-mono text-xs">
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={crumb.path} className="flex items-center">
                {i > 0 && crumb.label !== "" && (
                  <span className="px-0.5 text-gray-300 dark:text-gray-600" aria-hidden>
                    ›
                  </span>
                )}
                {last ? (
                  <span
                    aria-current="page"
                    className="px-1 py-0.5 text-gray-900 dark:text-gray-100"
                  >
                    {crumb.label}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => load(crumb.path)}
                    className="rounded px-1 py-0.5 text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                  >
                    {crumb.label}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <button
        type="button"
        className={iconButtonClass}
        title={`${f.goTo} (${shortcut("⌘⇧G", "Ctrl+Shift+G")})`}
        aria-label={f.goTo}
        aria-expanded={gotoOpen}
        onClick={() => (gotoOpen ? setGotoOpen(false) : openGoto())}
      >
        <GlyphIcon d={GO_TO_ICON} size={ICON_SIZE.iconButton} />
      </button>
      <label className="relative flex shrink-0 items-center">
        <GlyphIcon
          d={FILTER_ICON}
          size={ICON_SIZE.inlineGlyph}
          className="pointer-events-none absolute left-2 text-gray-400"
        />
        <input
          ref={filterRef}
          type="search"
          value={filter}
          placeholder={f.filter}
          aria-label={f.filter}
          aria-controls={listId}
          {...noAutofill}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              run("open");
            } else if (e.key === "Escape" && filter !== "") {
              // Clear first; only an empty filter lets Escape through to close the finder.
              e.stopPropagation();
              setFilter("");
            }
          }}
          className="w-24 rounded-md border border-gray-200 bg-white py-1 pl-7 pr-2 text-xs text-gray-700 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none sm:w-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
        />
      </label>
    </div>
  );

  const gotoRow = gotoOpen && (
    <form
      className={`flex items-center ${ICON_GAP.menu} border-b border-gray-200 px-3 py-1.5 dark:border-gray-800`}
      onSubmit={(e) => {
        e.preventDefault();
        commitGoto();
      }}
    >
      <label
        className="shrink-0 text-xs text-gray-500 dark:text-gray-400"
        htmlFor={`${listId}-goto`}
      >
        {f.goTo}
      </label>
      <input
        id={`${listId}-goto`}
        autoFocus
        value={gotoDraft}
        placeholder={f.goToPlaceholder}
        {...noAutofill}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setGotoDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            // Closes the field, not the finder.
            e.stopPropagation();
            setGotoOpen(false);
            listRef.current?.focus();
          }
        }}
        className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs text-gray-700 focus:border-gray-400 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
      />
      <Button type="submit" size="sm">
        {f.goToSubmit}
      </Button>
    </form>
  );

  let body: ReactNode;
  if (view.error !== null) {
    body = (
      <div className="p-4">
        <div
          className={`rounded-md border px-3 py-2.5 text-sm ${toneStrip[permissionDenied ? "attention" : "danger"]}`}
        >
          <p className="font-medium">{permissionDenied ? f.deniedTitle : f.loadFailed}</p>
          <p className="mt-1 text-xs leading-5">
            {permissionDenied
              ? platform === "darwin"
                ? f.deniedMac
                : f.denied
              : apiErrorText(view.error)}
          </p>
          <p className="mt-1 break-all font-mono text-xs opacity-80">{view.path}</p>
          <Button
            size="sm"
            className="mt-2"
            disabled={loading}
            onClick={() => load(view.path, { record: false })}
          >
            {S.common.retry}
          </Button>
        </div>
      </div>
    );
  } else if (view.listing === null) {
    body = <p className="px-4 py-3 text-xs text-gray-400">{S.common.loading}</p>;
  } else if (entries.length === 0) {
    body = (
      <p className="px-4 py-3 text-xs text-gray-400">
        {filter.trim() !== "" ? f.noMatch(filter.trim()) : f.empty}
      </p>
    );
  } else {
    body = entries.map((entry, i) => {
      const folder = isFolder(entry);
      const isSel = i === selIndex;
      return (
        <div
          key={entry.path}
          id={`${listId}-${i}`}
          role="option"
          aria-selected={isSel}
          aria-disabled={folder ? undefined : true}
          title={folder ? entry.path : f.fileNotSelectable}
          onClick={() => {
            if (!folder) return;
            if (isCoarsePointer()) openEntry(entry.path);
            else setSelected(entry.path);
          }}
          onDoubleClick={() => folder && openEntry(entry.path)}
          className={`flex select-none items-center ${ICON_GAP.menu} px-3 py-1 text-sm ${
            !folder
              ? "cursor-default text-gray-400 dark:text-gray-600"
              : isSel
                ? listFocused
                  ? "bg-[var(--accent-bg)] text-[var(--accent-fg)]"
                  : "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100"
                : "cursor-default text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800/60"
          }`}
        >
          <GlyphIcon
            d={folder ? FOLDER_ICON : FILE_ICON}
            size={ICON_SIZE.rowLead}
            className={`shrink-0 ${isSel && listFocused ? "" : "text-gray-400"}`}
          />
          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
          <span
            className={`hidden w-36 shrink-0 text-xs tabular-nums sm:block ${isSel && listFocused ? "" : "text-gray-400 dark:text-gray-500"}`}
          >
            {entry.mtime !== undefined ? formatDateTime(new Date(entry.mtime).toISOString()) : "—"}
          </span>
        </div>
      );
    });
  }

  const footer = (
    <>
      <div className="mr-auto flex min-w-0 flex-col justify-center gap-0.5 self-center">
        {onClear !== undefined && workspace.trim() !== "" && (
          <button
            type="button"
            onClick={() => onClear(machine)}
            className="self-start text-xs text-gray-500 underline decoration-gray-300 underline-offset-2 transition-colors duration-150 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {clearLabel}
          </button>
        )}
        <p className="line-clamp-2 text-xs leading-5 text-gray-400 dark:text-gray-500">{hint}</p>
      </div>
      <Button size="sm" className="self-center" onClick={onClose}>
        {S.common.cancel}
      </Button>
      <Button
        size="sm"
        variant="primary"
        className="self-center"
        disabled={chooseTarget === null || loading}
        title={chooseTarget ?? undefined}
        onClick={choose}
      >
        {f.choose}
      </Button>
    </>
  );

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      bare
      fullScreenOnPhone
      widthClass="sm:h-[min(36rem,85vh)] sm:max-w-3xl"
      footer={footer}
    >
      <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
        {toolbar}
        {gotoRow}
        <div className="relative flex min-h-0 flex-1">
          {sidebar}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-1 text-xs text-gray-400 dark:border-gray-800 dark:text-gray-500">
              <span className="min-w-0 flex-1 pl-6">{f.columnName}</span>
              <span className="hidden w-36 shrink-0 sm:block">{f.columnModified}</span>
            </div>
            <div
              ref={listRef}
              id={listId}
              // A listbox only while it holds rows: a message (empty, loading, an error with
              // its Retry) is not an option, and the pane stays focusable either way so the
              // keyboard chords keep working from it.
              role={hasRows ? "listbox" : "region"}
              tabIndex={0}
              aria-label={crumbs[crumbs.length - 1]?.label ?? title}
              aria-busy={loading}
              {...(selIndex !== -1 ? { "aria-activedescendant": `${listId}-${selIndex}` } : {})}
              onFocus={() => setListFocused(true)}
              onBlur={() => setListFocused(false)}
              className={`min-h-0 flex-1 overflow-y-auto py-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-400/40 ${
                loading && view.listing !== null ? "opacity-60" : ""
              }`}
            >
              {body}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
