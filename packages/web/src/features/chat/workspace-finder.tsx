/**
 * The Workspace finder: the modal every Workspace picker opens (workspace-select.tsx keeps the
 * triggers). It browses one machine's folders the way a desktop file manager's open dialog
 * does — places on the left, the current folder as a list, navigation buttons and an address
 * bar above it, Choose below — and hands back a folder and the machine it is on. Where the
 * platforms' file managers differ it takes Explorer's habits: the address bar turns into a
 * path field when clicked, a secondary click opens a context menu, and Quick access is the
 * user's to edit, starting from the standard folders of the browsed machine's own platform.
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
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import type { DesktopPrivacyPane, DirListResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { writeClipboard } from "../../lib/clipboard";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { isContextMenuKey, isLongPressPointer } from "../../lib/context-menu";
import { isElectronRenderer } from "../../lib/desktop-renderer";
import { formatDateTime } from "../../lib/format";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { STAT_ICONS } from "../../lib/stat-icons";
import { NoticeStrip } from "../../components/ui/notice-strip";
import { machineLabel, nameOnMachine, workspaceMachines } from "../../lib/workspace-machines";
import type { WorkspaceMachine } from "../../lib/workspace-machines";
import { useSessions } from "../../state/sessions";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { useRowContextMenu } from "../../components/ui/context-menu";
import { Dropdown } from "../../components/ui/dropdown";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { CLOCK_ICON, FOLDER_ICON, FOLDER_OPEN_ICON } from "../../components/ui/group-list";
import {
  ARROW_BACK_ICON,
  ARROW_FORWARD_ICON,
  CloseIcon,
  DOWNLOAD_ICON,
  FILE_ICON,
  REFRESH_ICON,
} from "../../components/ui/icons";
import { noAutofill } from "../../components/ui/input";
import {
  PIN_ICON,
  overflowMenuGlyph,
  overflowMenuRowClass,
} from "../../components/ui/session-row-menu";
import { toastError, toastSuccess } from "../../components/ui/toast";
import {
  EMPTY_HISTORY,
  TYPE_SELECT_RESET_MS,
  addToQuickAccess,
  baseName,
  canGoBack,
  canGoForward,
  defaultPlaces,
  deniedBox,
  drivePlaces,
  finderKeyAction,
  finderMenuItems,
  historyStep,
  historyVisit,
  isAbsoluteDirPath,
  isFolder,
  isTypeSelectKey,
  loadQuickAccess,
  parentOf,
  quickAccessPlaces,
  recentWorkspaces,
  removeFromQuickAccess,
  resolveGoTo,
  saveQuickAccess,
  splitBreadcrumbs,
  stepSelection,
  typeSelectIndex,
  visibleEntries,
} from "./workspace-finder-model";
import type {
  AccessAsk,
  FinderAction,
  FinderMenuItem,
  FinderMenuTarget,
  NavHistory,
  Place,
} from "./workspace-finder-model";

const UP_ICON = "M12 19V5m-6 6 6-6 6 6";
const HOME_ICON = "M3 11l9-8 9 8M5 10v10h14V10";
const DESKTOP_ICON = "M3 4h18v12H3zM8 20h8M12 16v4";
const PICTURES_ICON = "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5h.01";
const DRIVE_ICON = "M3 13h18v6H3zM5 13l2-8h10l2 8M17 16h.01";
const MACHINE_ICON = "M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01";
const SIDEBAR_ICON = "M4 5h16v14H4zM10 5v14";
const FILTER_ICON = "M21 21l-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0z";
const PLUS_ICON = "M12 5v14M5 12h14";
const CHECK_ICON = "M5 12.5l4.5 4.5L19 7.5";
/** A folder row's way in besides a double click: the drill-down chevron list rows use for "go into". */
const ENTER_ICON = "M9 18l6-6-6-6";

const PLACE_ICON: Record<Place["key"], string> = {
  home: HOME_ICON,
  desktop: DESKTOP_ICON,
  documents: FILE_ICON,
  downloads: DOWNLOAD_ICON,
  pictures: PICTURES_ICON,
  drive: DRIVE_ICON,
  folder: FOLDER_ICON,
};

const MENU_ICON: Record<FinderMenuItem, string> = {
  open: FOLDER_OPEN_ICON,
  choose: CHECK_ICON,
  addToQuickAccess: PIN_ICON,
  removeFromQuickAccess: PIN_ICON,
  copyPath: STAT_ICONS.copy,
  refresh: REFRESH_ICON,
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

/**
 * The toolbar's navigation buttons: bare glyphs, no box and no hover fill. The address bar
 * beside them is the toolbar's one boxed control, so a button can never be read as a segment
 * of the path or the path as a row of buttons.
 */
const navButtonClass =
  "shrink-0 rounded-md p-1.5 text-gray-500 transition-colors duration-150 hover:text-gray-900 disabled:cursor-default disabled:opacity-35 disabled:hover:text-gray-500 dark:text-gray-400 dark:hover:text-gray-100 dark:disabled:hover:text-gray-400";

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
  const addressRef = useRef<HTMLInputElement>(null);
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
  /** The address bar is a path field (clicked, or ⌘⇧G) rather than breadcrumbs; the draft is what it holds. */
  const [addressEditing, setAddressEditing] = useState(false);
  const [addressDraft, setAddressDraft] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [listFocused, setListFocused] = useState(false);
  const typed = useRef({ text: "", at: 0 });
  /** Bumped by every Quick access edit, so the stored edits are read again. */
  const [quickAccessVersion, setQuickAccessVersion] = useState(0);
  /**
   * One context menu for the whole finder, like the Files panel's tree: a hook per row would
   * be a hold timer per row. The row, place or empty space a gesture landed on is resolved
   * from the event, and held here while its menu is up.
   */
  const menu = useRowContextMenu();
  const [menuTarget, setMenuTarget] = useState<FinderMenuTarget | null>(null);

  /** Drawn by the desktop shell, which can ask macOS for a refused folder in the app's own name. */
  const inShell = useMemo(
    () => typeof navigator !== "undefined" && isElectronRenderer(navigator.userAgent),
    [],
  );
  /**
   * The "Allow access" exchange and the folder it is about: the shell answers only once the user
   * has answered macOS, and the finder may stand somewhere else by then.
   */
  const [access, setAccess] = useState<{ path: string; ask: AccessAsk } | null>(null);
  /** This server has no shell to ask: a desktop window attached to a server started elsewhere. */
  const [shellUnreachable, setShellUnreachable] = useState(false);

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
    setAddressEditing(false);
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
  const homeListing = home?.machine === machine ? home.listing : null;
  const defaults = useMemo(() => defaultPlaces(homeListing), [homeListing]);
  const drives = useMemo(() => drivePlaces(homeListing), [homeListing]);
  // Re-read on every edit (the version) and on switching machines: each machine keeps its own.
  const quickAccess = useMemo(
    () => quickAccessPlaces(defaults, loadQuickAccess(machine)),
    [defaults, machine, quickAccessVersion],
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
  const platform = view.listing?.platform ?? homeListing?.platform;
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

  /** Re-reads the folder on screen, keeping the selection; not a visit, so history stays put. */
  const refresh = () => {
    const path = view.listing?.path ?? view.path;
    if (path !== "") load(path, { record: false, select: selected });
  };

  /**
   * "Allow access": the shell reads the refused folder in the app's own name, which is what
   * makes macOS ask. Granted, the folder is read again — unless the finder has moved on while
   * macOS waited for the user. A server with no shell to ask turns the box into the
   * explanation a browser tab gets.
   */
  const askAccess = () => {
    const target = view.path;
    const seq = loadSeq.current;
    /** Records the answer, unless the exchange on record is already another folder's. */
    const settle = (ask: AccessAsk | null) =>
      setAccess((cur) => {
        if (cur?.path !== target) return cur;
        return ask === null ? null : { path: target, ask };
      });
    setAccess({ path: target, ask: { phase: "asking" } });
    api
      .requestDirAccess(projectId, target)
      .then((res) => {
        settle({ phase: "asked", packaged: res.packaged });
        if (res.granted && loadSeq.current === seq) load(target, { record: false });
      })
      .catch((err: unknown) => {
        settle(null);
        if (
          err instanceof ApiError &&
          (err.code === "shell_unreachable" || err.code === "desktop_shell_only")
        )
          setShellUnreachable(true);
        else toastError(apiErrorText(err));
      });
  };

  const openSystemSettings = (pane: DesktopPrivacyPane) => {
    void api.openPrivacySettings(pane).catch((err: unknown) => toastError(apiErrorText(err)));
  };

  /** The address bar becomes a path field holding the folder on screen, ready to be typed over. */
  const editAddress = () => {
    setAddressDraft(view.listing?.path ?? view.path);
    setAddressEditing(true);
  };

  /** Leaves the field as it was: Escape, or focus moving elsewhere, as in Explorer. */
  const cancelAddress = () => {
    setAddressEditing(false);
  };

  const commitAddress = () => {
    const target = resolveGoTo(addressDraft, homeListing?.path ?? null);
    setAddressEditing(false);
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

  /**
   * Whether `path` on machine `m` is in that machine's Quick access. For the machine being
   * browsed that is the list the sidebar shows; another machine's defaults are unknown from
   * here (its home is not listed), so only the folders added there count.
   */
  const inQuickAccess = (path: string, m: string | null): boolean =>
    (m === machine ? quickAccess : quickAccessPlaces([], loadQuickAccess(m))).some(
      (p) => p.path === path,
    );

  const editQuickAccess = (path: string, m: string | null, add: boolean) => {
    const base = m === machine ? defaults : [];
    const current = loadQuickAccess(m);
    const next = add
      ? addToQuickAccess(current, base, path)
      : removeFromQuickAccess(current, base, path);
    if (next === current) return;
    saveQuickAccess(m, next);
    setQuickAccessVersion((v) => v + 1);
  };

  const closeMenu = () => {
    menu.close();
    setMenuTarget(null);
  };

  const runMenuItem = (item: FinderMenuItem, target: FinderMenuTarget) => {
    closeMenu();
    switch (item) {
      case "open":
        if (target.machine === machine) load(target.path);
        else switchMachine(target.machine, target.path);
        break;
      case "choose":
        onChoose(target.path, target.machine);
        return;
      case "addToQuickAccess":
      case "removeFromQuickAccess":
        editQuickAccess(target.path, target.machine, item === "addToQuickAccess");
        break;
      case "copyPath":
        // A menu row cannot show the copy button's own feedback — the panel closes out from
        // under it — so a toast confirms, as the Files panel's copy-path row does.
        void writeClipboard(target.path).then((ok) => ok && toastSuccess(S.common.copied));
        break;
      case "refresh":
        refresh();
        break;
    }
    // The panel is gone and took focus with it; the list is where the keyboard picks up.
    listRef.current?.focus();
  };

  const menuLabel = (item: FinderMenuItem, target: FinderMenuTarget): string => {
    switch (item) {
      case "open":
        return f.open;
      case "choose":
        return target.kind === "here" ? f.chooseCurrent : f.chooseThis;
      case "addToQuickAccess":
        return f.addToQuickAccess;
      case "removeFromQuickAccess":
        return f.removeFromQuickAccess;
      case "copyPath":
        return f.copyPath;
      case "refresh":
        return f.refresh;
    }
  };

  /**
   * What a gesture landed on, read from the data attributes the rows, places and the list
   * itself carry. The list's own empty space stands for the folder on screen; anything else
   * (the text fields, the toolbar) resolves to nothing, so its native menu — paste, for a
   * path — is left alone.
   */
  const menuTargetAt = (
    at: EventTarget | null,
  ): { target: FinderMenuTarget; el: HTMLElement } | null => {
    const el =
      at instanceof Element
        ? at.closest<HTMLElement>("[data-finder-path], [data-finder-here]")
        : null;
    if (el === null) return null;
    const path = el.dataset.finderPath;
    if (path === undefined) {
      const here = view.listing?.path;
      return here === undefined ? null : { target: { kind: "here", path: here, machine }, el };
    }
    const on = el.dataset.finderMachine;
    return {
      target: {
        kind: el.dataset.finderKind === "file" ? "file" : "folder",
        path,
        machine: on === undefined ? machine : on === "" ? null : on,
      },
      el,
    };
  };

  /** Secondary click, touch press-and-hold and the replayed click after it, for the whole finder. */
  const menuProps = {
    onContextMenu: (e: ReactMouseEvent) => {
      const hit = menuTargetAt(e.target);
      if (hit === null) return;
      // A list row the menu opens on becomes the selection, as in Explorer — so Choose in the
      // footer and the menu's own rows agree about which folder is meant.
      if (hit.target.kind === "folder" && hit.el.getAttribute("role") === "option") {
        setSelected(hit.target.path);
      }
      // Before the hook reads it: a keyboard-synthesized contextmenu is anchored at this box.
      menu.rowRef(hit.el);
      setMenuTarget(hit.target);
      menu.rowProps.onContextMenu(e);
    },
    onPointerDown: (e: ReactPointerEvent) => {
      // Only a press-and-hold opens from here; a mouse arrives through onContextMenu.
      if (!isLongPressPointer(e.pointerType)) return;
      const hit = menuTargetAt(e.target);
      if (hit === null) return;
      menu.rowRef(hit.el);
      setMenuTarget(hit.target);
      menu.rowProps.onPointerDown(e);
    },
    onPointerMove: menu.rowProps.onPointerMove,
    onPointerUp: menu.rowProps.onPointerUp,
    onPointerCancel: menu.rowProps.onPointerCancel,
    // A touch screen replays the held press as a click once the finger lifts, and a tap on a
    // row opens it: swallowed here so opening the menu does not also open the folder.
    onClickCapture: (e: ReactMouseEvent) => {
      if (!menu.consumeLongPressClick()) return;
      e.preventDefault();
      e.stopPropagation();
    },
  };

  /** Shift+F10 / the menu key from the list: the selected row's menu, or the open folder's. */
  const openMenuFromList = () => {
    const row = selIndex === -1 ? null : document.getElementById(`${listId}-${selIndex}`);
    const el = row ?? listRef.current;
    if (el === null) return;
    const target: FinderMenuTarget | null =
      selectedEntry !== null
        ? { kind: isFolder(selectedEntry) ? "folder" : "file", path: selectedEntry.path, machine }
        : view.listing !== null
          ? { kind: "here", path: view.listing.path, machine }
          : null;
    if (target === null) return;
    menu.rowRef(el);
    setMenuTarget(target);
    const r = el.getBoundingClientRect();
    // A row hangs the panel off its own box; the whole list, off its top-left corner.
    menu.openAt(
      row !== null
        ? { top: r.top, bottom: r.bottom, left: r.left + 24, right: r.left + 24 }
        : { top: r.top + 8, bottom: r.top + 8, left: r.left + 24, right: r.left + 24 },
    );
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
        if (addressEditing) {
          cancelAddress();
          listRef.current?.focus();
        } else editAddress();
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
    // The context menu is portaled to body but is still a React child of this tree, so its
    // keys bubble through here: its arrows and Enter are the menu's, not the list's.
    if (!e.currentTarget.contains(e.target as Node)) return;
    const target = e.target as HTMLElement;
    const inList = target === listRef.current;
    const inFilter = target === filterRef.current;
    if (inList && isContextMenuKey(e)) {
      e.preventDefault();
      openMenuFromList();
      return;
    }
    // The address field is a path being typed: only its own chord (which closes it) applies.
    const inAddress = target === addressRef.current;
    const action = finderKeyAction(e, isMac, inList);
    if (action === null) {
      if (inList && isTypeSelectKey(e)) {
        e.preventDefault();
        typeSelect(e.key);
      }
      return;
    }
    if (inAddress && action !== "goto") return;
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

  const sideRow = ({
    key,
    icon,
    label,
    title: fullTitle,
    active,
    onClick,
    extra,
    disabled = false,
    folder,
    onRemove,
  }: {
    key: string;
    icon: string;
    label: string;
    title: string;
    active: boolean;
    onClick: () => void;
    extra?: ReactNode;
    disabled?: boolean;
    /** The folder the row opens, and its machine: what the context menu acts on. Machine rows have none. */
    folder?: { path: string; machine: string | null };
    /** Quick access rows: the hover button that takes the row out. */
    onRemove?: () => void;
  }) => (
    <li
      key={key}
      className="group relative"
      {...(folder !== undefined
        ? {
            "data-finder-path": folder.path,
            "data-finder-kind": "folder",
            ...(folder.machine !== machine ? { "data-finder-machine": folder.machine ?? "" } : {}),
          }
        : {})}
    >
      <button
        type="button"
        data-tooltip={fullTitle}
        disabled={disabled}
        aria-current={active ? "location" : undefined}
        data-finder-focus
        onClick={() => {
          setSidebarOpen(false);
          onClick();
        }}
        className={`flex w-full items-center ${ICON_GAP.menu} rounded-md px-2 py-1 text-left text-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
          onRemove !== undefined ? "pr-7" : ""
        } ${
          active
            ? "bg-gray-200 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
            : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800/60"
        }`}
      >
        <GlyphIcon d={icon} size={ICON_SIZE.rowLead} className="shrink-0 text-gray-400" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {extra}
      </button>
      {/* Revealed on hover and on keyboard focus; a touch screen removes through the row's
          press-and-hold menu instead, which offers the same action. */}
      {onRemove !== undefined && (
        <button
          type="button"
          aria-label={f.removeNamed(label)}
          data-tooltip={f.removeFromQuickAccess}
          onClick={onRemove}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 opacity-0 transition-opacity duration-150 hover:text-gray-800 focus-visible:opacity-100 group-hover:opacity-100 dark:text-gray-500 dark:hover:text-gray-200"
        >
          <CloseIcon size={10} />
        </button>
      )}
    </li>
  );

  const sideHeading = (text: string, action?: ReactNode) => (
    <div className="flex items-center justify-between px-2 pb-1 pt-3 first:pt-0">
      <p className="text-xs font-medium text-gray-400 dark:text-gray-500">{text}</p>
      {action}
    </div>
  );

  const placeLabel = (place: Place): string => {
    if (place.key === "home" || place.key === "drive" || place.key === "folder") return place.label;
    // Finder says 文稿 where Explorer and Files say 文档: each machine's own word for it.
    if (place.key === "documents" && platform === "darwin") return f.documentsMac;
    return f.places[place.key];
  };

  const currentFolder = view.listing?.path ?? null;
  const canAddCurrent = currentFolder !== null && !inQuickAccess(currentFolder, machine);

  const sidebar = (
    <aside
      className={`${
        sidebarOpen ? "absolute inset-y-0 left-0 z-10 flex w-64 shadow-xl" : "hidden"
      } shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-gray-50 px-2 py-3 sm:static sm:flex sm:w-48 sm:shadow-none dark:border-gray-800 dark:bg-gray-950`}
    >
      {/* Quick access stays up, even emptied, while there is a folder on screen to add back. */}
      {(quickAccess.length > 0 || currentFolder !== null) && (
        <>
          {sideHeading(
            f.quickAccess,
            currentFolder !== null && canAddCurrent && (
              <button
                type="button"
                aria-label={f.addCurrentToQuickAccess}
                data-tooltip={f.addCurrentToQuickAccess}
                onClick={() => editQuickAccess(currentFolder, machine, true)}
                className="rounded p-0.5 text-gray-400 transition-colors duration-150 hover:text-gray-800 dark:text-gray-500 dark:hover:text-gray-200"
              >
                <GlyphIcon d={PLUS_ICON} size={ICON_SIZE.inlineGlyph} />
              </button>
            ),
          )}
          <ul className="space-y-0.5">
            {quickAccess.map((place) =>
              sideRow({
                key: `quick:${place.path}`,
                icon: PLACE_ICON[place.key],
                label: placeLabel(place),
                title: place.path,
                active: view.path === place.path,
                onClick: () => load(place.path),
                folder: { path: place.path, machine },
                onRemove: () => editQuickAccess(place.path, machine, false),
              }),
            )}
          </ul>
        </>
      )}
      {/* Windows' drives, where Explorer keeps them: under This PC, apart from Quick access. */}
      {drives.length > 0 && (
        <>
          {sideHeading(f.thisPc)}
          <ul className="space-y-0.5">
            {drives.map((place) =>
              sideRow({
                key: `drive:${place.path}`,
                icon: PLACE_ICON[place.key],
                label: place.label,
                title: place.path,
                active: view.path === place.path,
                onClick: () => load(place.path),
                folder: { path: place.path, machine },
              }),
            )}
          </ul>
        </>
      )}
      {recents.length > 0 && (
        <>
          {sideHeading(f.recent)}
          <ul className="space-y-0.5">
            {recents.map((r) =>
              sideRow({
                key: `recent:${r.machineId ?? ""}:${r.path}`,
                icon: CLOCK_ICON,
                label: nameOnMachine(
                  baseName(r.path),
                  r.machineId === null ? null : machineLabel(machines, r.machineId),
                ),
                title: r.path,
                active: r.machineId === machine && view.path === r.path,
                onClick: () =>
                  r.machineId === machine ? load(r.path) : switchMachine(r.machineId, r.path),
                folder: { path: r.path, machine: r.machineId },
              }),
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
              sideRow({
                key: entry.selectable
                  ? `machine:${entry.id ?? "local"}`
                  : `machine-unusable:${index}`,
                icon: MACHINE_ICON,
                label: entry.label,
                title: entry.label,
                active: entry.selectable && entry.id === machine,
                onClick: () => {
                  if (entry.id !== machine) switchMachine(entry.id);
                },
                extra: entry.local ? (
                  <span className="shrink-0 text-xs text-gray-400">{S.chat.workspaceHere}</span>
                ) : entry.reason !== undefined ? (
                  // A machine that cannot be browsed says why on its own row, where the
                  // question is asked.
                  <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">
                    {S.chat.workspaceMachineWhy[entry.reason]}
                  </span>
                ) : undefined,
                disabled: !entry.selectable,
              }),
            )}
          </ul>
        </>
      )}
    </aside>
  );

  const shortcut = (mac: string, other: string) => (isMac ? mac : other);
  const editChord = shortcut("⌘⇧G", "Ctrl+Shift+G");
  const parentPath = view.listing?.parent ?? parentOf(view.path);

  /**
   * The address bar: one boxed, input-like control, so it reads as the path and not as more
   * toolbar. At rest it holds the path as segments — a segment opens that folder — and a click
   * anywhere else in it (the folder mark, the current folder, the empty stretch after it) turns
   * it into a text field holding the whole path, as Explorer's does. Enter goes there, Escape or
   * leaving the field puts the segments back.
   */
  const addressBar = (
    <div
      className={`flex h-8 min-w-0 flex-1 items-center rounded-md border bg-white transition-colors duration-150 dark:bg-gray-900 ${
        addressEditing
          ? "border-gray-400 dark:border-gray-500"
          : "border-gray-300 hover:border-gray-400 dark:border-gray-700 dark:hover:border-gray-600"
      }`}
    >
      {addressEditing ? (
        <input
          ref={addressRef}
          autoFocus
          value={addressDraft}
          aria-label={f.address}
          placeholder={f.addressPlaceholder}
          {...noAutofill}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setAddressDraft(e.target.value)}
          onBlur={cancelAddress}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              commitAddress();
            } else if (e.key === "Escape") {
              // Puts the segments back; it does not close the finder.
              e.stopPropagation();
              cancelAddress();
              listRef.current?.focus();
            }
          }}
          className="h-full min-w-0 flex-1 rounded-md bg-transparent px-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
        />
      ) : (
        <>
          <button
            type="button"
            aria-label={f.editPath}
            data-tooltip={`${f.editPath} (${editChord})`}
            onClick={editAddress}
            className="flex h-full shrink-0 items-center pl-2.5 pr-1 text-gray-400 transition-colors duration-150 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
          >
            <GlyphIcon d={FOLDER_ICON} size={ICON_SIZE.inlineGlyph} />
          </button>
          <nav
            ref={crumbsRef}
            aria-label={f.path}
            className="min-w-0 overflow-x-auto [scrollbar-width:none]"
          >
            <ol className="flex items-center whitespace-nowrap text-sm">
              {crumbs.map((crumb, i) => {
                const last = i === crumbs.length - 1;
                return (
                  <li key={crumb.path} className="flex items-center">
                    {i > 0 && crumb.label !== "" && (
                      <span className="px-0.5 text-gray-300 dark:text-gray-600" aria-hidden>
                        ›
                      </span>
                    )}
                    <button
                      type="button"
                      // The folder already on screen has nowhere to go: clicking it edits the
                      // path instead, like the rest of the bar.
                      onClick={last ? editAddress : () => load(crumb.path)}
                      {...(last
                        ? {
                            "aria-current": "page" as const,
                            "data-tooltip": `${f.editPath} (${editChord})`,
                          }
                        : {})}
                      className={`rounded px-1 py-0.5 transition-colors duration-150 ${
                        last
                          ? "text-gray-900 dark:text-gray-100"
                          : "text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                      }`}
                    >
                      {crumb.label}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
          {/* The empty stretch after the path: the widest click target for typing one. A
              pointer affordance only — the folder mark above is the same action for the
              keyboard, and ⌘⇧G / Ctrl+Shift+G reaches it from anywhere. */}
          <div
            aria-hidden
            data-tooltip={`${f.editPath} (${editChord})`}
            onClick={editAddress}
            className="h-full min-w-6 flex-1 cursor-text"
          />
        </>
      )}
    </div>
  );

  const toolbar = (
    <div className="flex items-center gap-2 border-b border-gray-200 px-2 py-2 dark:border-gray-800">
      <div className="flex shrink-0 items-center">
        <button
          type="button"
          className={`${navButtonClass} sm:hidden`}
          aria-label={sidebarOpen ? f.hideSidebar : f.showSidebar}
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((v) => !v)}
        >
          <GlyphIcon d={SIDEBAR_ICON} size={ICON_SIZE.iconButton} />
        </button>
        <button
          type="button"
          className={navButtonClass}
          disabled={!canGoBack(history)}
          data-tooltip={`${f.back} (${shortcut("⌘[", "Ctrl+[")})`}
          aria-label={f.back}
          onClick={() => step(-1)}
        >
          <GlyphIcon d={ARROW_BACK_ICON} size={ICON_SIZE.iconButton} />
        </button>
        <button
          type="button"
          className={navButtonClass}
          disabled={!canGoForward(history)}
          data-tooltip={`${f.forward} (${shortcut("⌘]", "Ctrl+]")})`}
          aria-label={f.forward}
          onClick={() => step(1)}
        >
          <GlyphIcon d={ARROW_FORWARD_ICON} size={ICON_SIZE.iconButton} />
        </button>
        <button
          type="button"
          className={navButtonClass}
          disabled={parentPath === null}
          data-tooltip={`${f.up} (${shortcut("⌘↑", "Alt+↑")})`}
          aria-label={f.up}
          onClick={goParent}
        >
          <GlyphIcon d={UP_ICON} size={ICON_SIZE.iconButton} />
        </button>
        {/* Refresh is also on the list's context menu, which is where a phone reaches it. */}
        <button
          type="button"
          className={`${navButtonClass} hidden sm:block`}
          disabled={currentFolder === null && view.error === null}
          data-tooltip={f.refresh}
          aria-label={f.refresh}
          onClick={refresh}
        >
          <GlyphIcon d={REFRESH_ICON} size={ICON_SIZE.iconButton} />
        </button>
      </div>
      {addressBar}
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
          className="h-8 w-20 rounded-md border border-gray-300 bg-white pl-7 pr-2 text-sm text-gray-700 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none sm:w-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
        />
      </label>
    </div>
  );

  let body: ReactNode;
  if (view.error !== null) {
    // A refused folder says whose permission is missing and offers what can get it (see
    // deniedBox); any other failure names itself and offers Retry.
    const denied = permissionDenied
      ? deniedBox({
          platform,
          desktopShell: inShell && !shellUnreachable,
          machine,
          ask: access?.path === view.path ? access.ask : { phase: "idle" },
        })
      : null;
    const settingsPane = denied?.settings ?? null;
    body = (
      <div className="p-4">
        <NoticeStrip
          tone={denied !== null ? "attention" : "danger"}
          className="rounded-md border px-3 py-2.5 text-sm"
        >
          <p className="font-medium">{denied !== null ? f.deniedTitle : f.loadFailed}</p>
          <p className="mt-1 text-xs leading-5">
            {denied !== null ? f[denied.text] : apiErrorText(view.error)}
          </p>
          <p className="mt-1 break-all font-mono text-xs opacity-80">{view.path}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {denied !== null && denied.allow !== "none" && (
              <Button
                size="sm"
                variant="primary"
                disabled={denied.allow === "waiting" || loading}
                onClick={askAccess}
              >
                {denied.allow === "waiting" ? f.allowAccessWaiting : f.allowAccess}
              </Button>
            )}
            {settingsPane !== null && (
              <Button size="sm" variant="primary" onClick={() => openSystemSettings(settingsPane)}>
                {f.openSystemSettings}
              </Button>
            )}
            {(denied === null || denied.retry) && (
              <Button
                size="sm"
                disabled={loading}
                onClick={() => load(view.path, { record: false })}
              >
                {S.common.retry}
              </Button>
            )}
          </div>
        </NoticeStrip>
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
      const accent = isSel && listFocused;
      return (
        <div
          key={entry.path}
          id={`${listId}-${i}`}
          role="option"
          // Named by the folder alone: the date and the enter button are the row's furniture.
          aria-label={entry.name}
          aria-selected={isSel}
          aria-disabled={folder ? undefined : true}
          data-tooltip={folder ? entry.path : f.fileNotSelectable}
          data-finder-path={entry.path}
          data-finder-kind={folder ? "folder" : "file"}
          onClick={() => {
            if (!folder) return;
            if (isCoarsePointer()) openEntry(entry.path);
            else setSelected(entry.path);
          }}
          onDoubleClick={() => folder && openEntry(entry.path)}
          className={`flex select-none items-center ${ICON_GAP.menu} py-1 pl-3 pr-2 text-sm ${
            !folder
              ? "cursor-default text-gray-400 dark:text-gray-600"
              : isSel
                ? listFocused
                  ? "bg-accent text-accent-fg"
                  : "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100"
                : "cursor-default text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800/60"
          }`}
        >
          <GlyphIcon
            d={folder ? FOLDER_ICON : FILE_ICON}
            size={ICON_SIZE.rowLead}
            className={`shrink-0 ${accent ? "" : "text-gray-400"}`}
          />
          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
          <span
            className={`hidden w-36 shrink-0 text-xs tabular-nums sm:block ${accent ? "" : "text-gray-400 dark:text-gray-500"}`}
          >
            {entry.mtime !== undefined ? formatDateTime(new Date(entry.mtime).toISOString()) : "—"}
          </span>
          {/* A second way into a folder beside the double click — one a touch screen, a
              trackpad and a first-time user all find. Out of the tab order: the list's own
              Enter is the keyboard's way in. A file keeps the slot empty so dates line up. */}
          {folder ? (
            <button
              type="button"
              tabIndex={-1}
              aria-label={f.openFolder(entry.name)}
              data-tooltip={f.open}
              onClick={(e) => {
                e.stopPropagation();
                openEntry(entry.path);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className={`flex w-6 shrink-0 justify-center rounded py-0.5 transition-colors duration-150 ${
                accent
                  ? "text-current"
                  : "text-gray-400 hover:text-gray-900 dark:text-gray-500 dark:hover:text-gray-100"
              }`}
            >
              <GlyphIcon d={ENTER_ICON} size={ICON_SIZE.inlineGlyph} />
            </button>
          ) : (
            <span className="w-6 shrink-0" aria-hidden />
          )}
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
      {/* The buttons keep their width; on a phone the hint beside them wraps instead. */}
      <Button size="sm" className="shrink-0 self-center whitespace-nowrap" onClick={onClose}>
        {S.common.cancel}
      </Button>
      <Button
        size="sm"
        variant="primary"
        className="shrink-0 self-center whitespace-nowrap"
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
      <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown} {...menuProps}>
        {toolbar}
        <div className="relative flex min-h-0 flex-1">
          {sidebar}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-gray-100 py-1 pl-3 pr-2 text-xs text-gray-400 dark:border-gray-800 dark:text-gray-500">
              <span className="min-w-0 flex-1 pl-6">{f.columnName}</span>
              <span className="hidden w-36 shrink-0 sm:block">{f.columnModified}</span>
              <span className="w-6 shrink-0" aria-hidden />
            </div>
            <div
              ref={listRef}
              id={listId}
              // Its empty space is the folder on screen, for the context menu.
              data-finder-here=""
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
      {/* The context menu: `contents` keeps the wrapper out of the layout — the panel is
          portaled, and it hangs off the point the gesture landed on. */}
      {menuTarget !== null && (
        <Dropdown
          open={menu.open}
          // The target is cleared where the menu really closes (an item ran): a dismiss is not
          // always believed — a touch screen replays the held press as an outside click.
          setOpen={menu.setOpen}
          portal={{ direction: "down", align: "left" }}
          anchorRect={menu.anchor}
          anchorOwner={menu.anchorOwner}
          // A sidebar place hands Escape back to its own button; a list row, which is no
          // control of its own, to the list.
          returnFocus={() =>
            menu.anchorOwner()?.querySelector<HTMLElement>("[data-finder-focus]") ?? listRef.current
          }
          className="contents"
          menuClass="w-max min-w-40 max-w-[calc(100vw-2rem)]"
          button={null}
        >
          {finderMenuItems(menuTarget, inQuickAccess(menuTarget.path, menuTarget.machine)).map(
            (item) => (
              <button
                key={item}
                type="button"
                className={overflowMenuRowClass}
                onClick={() => runMenuItem(item, menuTarget)}
              >
                {overflowMenuGlyph(MENU_ICON[item])}
                {menuLabel(item, menuTarget)}
              </button>
            ),
          )}
        </Dropdown>
      )}
    </Modal>
  );
}
