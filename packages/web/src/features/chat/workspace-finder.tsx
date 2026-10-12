/**
 * The Workspace finder: the modal every Workspace picker opens (workspace-select.tsx keeps the
 * triggers). It browses one machine's folders the way a desktop file manager's open dialog
 * does — places on the left, the current folder as a list, navigation buttons and an address
 * bar above it, Choose below — and hands back a folder and the machine it is on. Where the
 * platforms' file managers differ it takes Explorer's habits: the address bar turns into a
 * path field when clicked, a secondary click opens a context menu, and Quick access is the
 * user's to edit, starting from the standard folders of the browsed machine's own platform.
 *
 * What the sidebar offers is the browsed machine's own answer, not this browser's: its
 * standard folders as it resolves them, and its locations — Windows' drives under This PC, a
 * Mac's volumes, a Linux root and its mounts under Locations — named the way that platform's
 * file manager names them. The same locations hang off a caret at the head of the address bar,
 * so another drive is one click away even where the sidebar is a drawer. They are asked for
 * again on every open, beside the folder rather than ahead of it (a drive plugged in since
 * shows up; a slow drive never holds the list), and the previous answer stays up until the new
 * one lands. Keys follow the platform the user sits at, not the one being browsed: Explorer's
 * Ctrl+L, Alt+D and F4 edit the address off the Mac, and F5 refreshes everywhere instead of
 * reloading the app.
 *
 * It is a Modal like any other dialog, so it stacks on the dialogs that host the form variant
 * without anything of its own: Modal portals to body (a later modal sits above an earlier one in
 * DOM order) and joins the shared Escape stack, so one Escape closes the finder and leaves the
 * host dialog open, and closing hands focus back to the trigger.
 *
 * The component stays mounted while closed, so it reopens where it was browsing when the host
 * has no Workspace set yet (the sidebar's new-workspace button picks one after another from the
 * same place); with one set, it reopens revealing that folder in its parent.
 *
 * Its look is the theme's: the places are navigation rows on the muted surface, the list's rows
 * are bands inset from the pane's edges on the same row radius, the address bar and the filter
 * wear the text-control look, and the toolbar is the dialog's head — laid straight into the
 * dialog, as Modal's own footer is, so a theme's dialog recipe finds both.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import type { DesktopPrivacyPane, DirListResponse } from "@prismshadow/penguin-server/api";
import {
  Button,
  ChevronDown,
  CloseIcon,
  Dropdown,
  GlyphIcon,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  IconButton,
  Menu,
  MenuItem,
  Modal,
  NavRow,
  NoticeStrip,
  Text,
  controlBase,
  isContextMenuKey,
  isLongPressPointer,
  noAutofill,
  toastError,
  toastSuccess,
  useRowContextMenu,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { writeClipboard } from "../../lib/clipboard";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { isElectronRenderer } from "../../lib/desktop-renderer";
import { formatDateTime } from "../../lib/format";
import { STAT_ICONS } from "../../lib/stat-icons";
import { machineLabel, nameOnMachine, workspaceMachines } from "../../lib/workspace-machines";
import type { WorkspaceMachine } from "../../lib/workspace-machines";
import { useSessions } from "../../state/sessions";
import {
  EMPTY_HISTORY,
  TYPE_SELECT_RESET_MS,
  addToQuickAccess,
  baseName,
  canGoBack,
  canGoForward,
  clearButton,
  defaultPlaces,
  deniedBox,
  finderKeyAction,
  finderMenuItems,
  historyStep,
  historyVisit,
  isAbsoluteDirPath,
  isFolder,
  isTypeSelectKey,
  loadQuickAccess,
  locationName,
  locationPlaces,
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

/**
 * The registry has one storage drawing, the drive, so a fixed disk, a volume and a Linux root
 * all take it; the other kinds borrow the nearest thing the registry draws — a plug for what
 * is plugged in, the network for a share, a disc for an optical drive.
 */
const PLACE_ICON: Record<Place["key"], string> = {
  home: ICONS.house,
  desktop: ICONS.monitor,
  documents: ICONS.file,
  downloads: ICONS.download,
  pictures: ICONS.image,
  drive: ICONS.hardDrive,
  volume: ICONS.hardDrive,
  root: ICONS.hardDrive,
  removable: ICONS.plug,
  network: ICONS.network,
  optical: ICONS.target,
  folder: ICONS.folder,
};

const MENU_ICON: Record<FinderMenuItem, string> = {
  open: ICONS.folderOpen,
  choose: ICONS.check,
  addToQuickAccess: ICONS.pin,
  removeFromQuickAccess: ICONS.pin,
  copyPath: STAT_ICONS.copy,
  refresh: ICONS.refresh,
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
 * The toolbar's navigation buttons: bare glyphs, no box and no hover fill — the ink alone
 * answers the pointer, which is why they are not the package's ghost IconButton. The address bar
 * beside them is the toolbar's one boxed control, so a button can never be read as a segment of
 * the path or the path as a row of buttons.
 */
const navButtonClass =
  "shrink-0 rounded-control p-1.5 text-fg-muted transition-colors duration-150 hover:text-fg disabled:cursor-default disabled:opacity-35 disabled:hover:text-fg-muted";

export function WorkspaceFinder({
  open,
  onClose,
  onChoose,
  onClear,
  projectId,
  workspace,
  machineId,
  chooseMachine,
  agentId,
  title,
  clearLabel,
  clearTitle,
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
  /** The Agent a temporary Workspace would belong to: the footer button then shows the folder it would get. */
  agentId?: string;
  title: string;
  /** The footer button that takes `onClear`. */
  clearLabel: string;
  /** That button's tooltip while the folder it stands for is not known here. */
  clearTitle?: string;
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
  /**
   * The browsed machine's home listing, asked for with its places: Quick access, the locations,
   * and the platform the pane's copy depends on.
   */
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
  /** The address bar's root menu: the machine's locations, from the caret before the path. */
  const [rootMenuOpen, setRootMenuOpen] = useState(false);
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

  /** Monotonic id of the newest home request: an older answer landing late never replaces it. */
  const homeSeq = useRef(0);

  /**
   * Asks machine `m` for its home listing with its places — every time, not once per machine:
   * a drive plugged in, or a folder moved, since the last ask has to show up, and the server
   * keeps a repeat cheap. It is a request of its own beside the folder's, so the list never
   * waits on the places being found. Whatever the sidebar shows stays up until the answer
   * lands (or for good, if it fails), rather than emptying for the length of a request.
   */
  const loadHome = (m: string | null) => {
    const seq = ++homeSeq.current;
    api
      .listDirs(projectId, "", m, { places: true })
      .then((listing) => {
        if (seq === homeSeq.current && machineRef.current === m) setHome({ machine: m, listing });
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
    if (!open) {
      // The root menu's state outlives its panel, which unmounts with the finder: left set, the
      // next open would pop the menu up again and pull focus into it.
      setRootMenuOpen(false);
      return;
    }
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

  /**
   * The `agent_state` directory of the Agent a temporary Workspace would belong to, from that
   * Agent's config on this server: the footer button's path is built from it. Kept per Agent,
   * the way the home listing is kept per machine.
   */
  const [agentState, setAgentState] = useState<{ agentId: string; dir: string } | null>(null);
  useEffect(() => {
    if (!open || agentId === undefined || agentState?.agentId === agentId) return;
    let cancelled = false;
    void api
      .getAgentConfig(projectId, agentId)
      .then((res) => {
        if (!cancelled) setAgentState({ agentId, dir: res.stateDir });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Not keyed on `agentState`, which is what this fills in.
  }, [open, agentId, projectId]);

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
  const locations = useMemo(() => locationPlaces(homeListing), [homeListing]);
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
    // The field replaces the segments and the caret before them, menu and all.
    setRootMenuOpen(false);
  };

  /** A location from the address bar's root menu: opened like a sidebar place, as a visit. */
  const openLocation = (path: string) => {
    setRootMenuOpen(false);
    setSidebarOpen(false);
    load(path);
    // The panel is gone and took focus with it; the list is where the keyboard picks up.
    listRef.current?.focus();
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
      case "refresh":
        refresh();
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
    const action = finderKeyAction(e, isMac, inList);
    // F5 is the finder's wherever focus is in it — a typed path and a menu portaled out of it
    // included: let through, it reloads the whole app and the dialog with it.
    if (action === "refresh") {
      e.preventDefault();
      e.stopPropagation();
      run(action);
      return;
    }
    // A menu portaled to body is still a React child of the band that opened it (the address
    // bar's root menu is the toolbar's), so its keys bubble through here: its arrows and Enter
    // are the menu's, not the list's.
    if (!e.currentTarget.contains(target)) return;
    const inFilter = target === filterRef.current;
    if (inList && isContextMenuKey(e)) {
      e.preventDefault();
      openMenuFromList();
      return;
    }
    // The address field is a path being typed: only its own chords (which close it) apply.
    const inAddress = target === addressRef.current;
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

  /**
   * What the toolbar and the panes below it both carry: the key map and the context menu's
   * gestures. They are two of the dialog's own children (its head, then its body) rather than
   * one wrapper's, so each takes the handlers itself.
   */
  const band = { onKeyDown, ...menuProps };

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
    /** The tooltip, when it shows more than the label (a folder's full path). */
    title?: string;
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
      // The context menu hands Escape back to this row's own button (see the Dropdown below).
      data-finder-place=""
      {...(folder !== undefined
        ? {
            "data-finder-path": folder.path,
            "data-finder-kind": "folder",
            ...(folder.machine !== machine ? { "data-finder-machine": folder.machine ?? "" } : {}),
          }
        : {})}
    >
      <NavRow
        label={label}
        glyph={icon}
        badge={extra}
        active={active}
        disabled={disabled}
        surface="muted"
        // The remove button lies over the row's end: the row keeps its fill under it, and its
        // label stops short of it.
        groupHover={onRemove !== undefined}
        className={onRemove !== undefined ? "pr-7" : ""}
        tooltip={fullTitle}
        onClick={() => {
          setSidebarOpen(false);
          onClick();
        }}
      />
      {/* Revealed on hover and on keyboard focus; a touch screen removes through the row's
          press-and-hold menu instead, which offers the same action. */}
      {onRemove !== undefined && (
        <button
          type="button"
          aria-label={f.removeNamed(label)}
          data-tooltip={f.removeFromQuickAccess}
          onClick={onRemove}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-1 text-fg-subtle opacity-0 transition-opacity duration-150 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
        >
          <CloseIcon size={10} />
        </button>
      )}
    </li>
  );

  const sideHeading = (text: string, action?: ReactNode) => (
    <div className="flex items-center justify-between px-2.5 pb-1 pt-3 first:pt-0">
      <Text variant="eyebrow">{text}</Text>
      {action}
    </div>
  );

  const placeLabel = (place: Place): string => {
    switch (place.key) {
      case "home":
      case "folder":
        return place.label;
      case "desktop":
      case "documents":
      case "downloads":
      case "pictures":
        // Finder's Chinese word for Documents is not Explorer's or Files': each machine's own.
        return place.key === "documents" && platform === "darwin"
          ? f.documentsMac
          : f.places[place.key];
      default:
        return locationName(place, f);
    }
  };

  const currentFolder = view.listing?.path ?? null;
  const canAddCurrent = currentFolder !== null && !inQuickAccess(currentFolder, machine);

  // The places column sits on the muted surface, as the app's own navigation column does, and its
  // rows take that surface's washes (NavRow's `muted`).
  const sidebar = (
    <aside
      className={`${
        sidebarOpen ? "absolute inset-y-0 left-0 z-10 flex w-64 shadow-xl" : "hidden"
      } shrink-0 flex-col overflow-y-auto border-r border-line bg-surface-muted px-2 py-3 sm:static sm:flex sm:w-48 sm:shadow-none`}
    >
      {/* Quick access stays up, even emptied, while there is a folder on screen to add back. */}
      {(quickAccess.length > 0 || currentFolder !== null) && (
        <>
          {sideHeading(
            f.quickAccess,
            currentFolder !== null && canAddCurrent && (
              // The negative margin keeps the heading on its own line height.
              <IconButton
                variant="ghost"
                size="sm"
                label={f.addCurrentToQuickAccess}
                onClick={() => editQuickAccess(currentFolder, machine, true)}
                className="-my-1"
              >
                <GlyphIcon d={ICONS.plus} size={ICON_SIZE.inlineGlyph} />
              </IconButton>
            ),
          )}
          <ul className="flex flex-col gap-1">
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
      {/* The machine's locations, apart from Quick access as every file manager keeps them:
          Windows' drives under This PC, a Mac's volumes or a Linux root and its mounts under
          Locations. */}
      {locations.length > 0 && (
        <>
          {sideHeading(homeListing?.platform === "win32" ? f.thisPc : f.locations)}
          <ul className="flex flex-col gap-1">
            {locations.map((place) =>
              sideRow({
                key: `location:${place.path}`,
                icon: PLACE_ICON[place.key],
                label: placeLabel(place),
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
          <ul className="flex flex-col gap-1">
            {recents.map((r) =>
              sideRow({
                key: `recent:${r.machineId ?? ""}:${r.path}`,
                icon: ICONS.clock,
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
          <ul className="flex flex-col gap-1">
            {machines.map((entry, index) =>
              sideRow({
                key: entry.selectable
                  ? `machine:${entry.id ?? "local"}`
                  : `machine-unusable:${index}`,
                icon: ICONS.server,
                label: entry.label,
                active: entry.selectable && entry.id === machine,
                onClick: () => {
                  if (entry.id !== machine) switchMachine(entry.id);
                },
                extra: entry.local ? (
                  <span className="text-xs text-fg-subtle">{S.chat.workspaceHere}</span>
                ) : entry.reason !== undefined ? (
                  // A machine that cannot be browsed says why on its own row, where the
                  // question is asked.
                  <span className="text-xs text-fg-subtle">
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
   * leaving the field puts the segments back. Where the machine reported its locations, a caret
   * between the folder mark and the path opens them as a menu; the field replaces it along with
   * the segments. It wears the text-control look (controlBase's box, spelled out because the box
   * is a div and its focus is the field's inside it): the focused look while it is a field, the
   * resting one with its hover while it holds segments.
   */
  const addressBar = (
    <div
      className={`flex h-8 min-w-0 flex-1 items-center rounded-md border bg-surface text-fg transition-[border-color,box-shadow] duration-200 ${
        addressEditing
          ? "border-fg-muted [box-shadow:var(--ui-focus-ring-input)]"
          : "border-line-emphasis hover:border-fg-subtle"
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
          className="h-full min-w-0 flex-1 rounded-md bg-transparent px-2.5 text-sm text-fg outline-none placeholder:text-fg-subtle"
        />
      ) : (
        <>
          <button
            type="button"
            aria-label={f.editPath}
            data-tooltip={`${f.editPath} (${editChord})`}
            onClick={editAddress}
            className="flex h-full shrink-0 items-center pl-2.5 pr-1 text-fg-subtle transition-colors duration-150 hover:text-fg"
          >
            <GlyphIcon d={ICONS.folder} size={ICON_SIZE.inlineGlyph} />
          </button>
          {/* The machine's locations, one click from any folder, the way Explorer's address bar
              drops its root list from the arrow at its head. It sits before the path rather
              than in it: the path scrolls to its end, so a root segment can be out of sight —
              on a phone above all, where the sidebar that also lists them is a drawer. */}
          {locations.length > 0 && (
            <Dropdown
              open={rootMenuOpen}
              setOpen={setRootMenuOpen}
              portal={{ direction: "down", align: "left" }}
              className="flex h-full shrink-0 items-center"
              menuClass="w-max min-w-40 max-w-[calc(100vw-2rem)]"
              button={
                <button
                  type="button"
                  aria-label={f.switchLocation}
                  aria-haspopup="menu"
                  aria-expanded={rootMenuOpen}
                  // Its hint would only cover the menu it names while that is open.
                  {...(rootMenuOpen ? {} : { "data-tooltip": f.switchLocation })}
                  onClick={() => setRootMenuOpen((v) => !v)}
                  className="flex h-full items-center px-1.5 text-fg-subtle transition-colors duration-150 hover:text-fg"
                >
                  <ChevronDown size={ICON_SIZE.caret} />
                </button>
              }
            >
              <Menu density="sm" label={f.switchLocation}>
                {locations.map((place) => (
                  <MenuItem
                    key={place.path}
                    glyph={PLACE_ICON[place.key]}
                    label={placeLabel(place)}
                    onSelect={() => openLocation(place.path)}
                  />
                ))}
              </Menu>
            </Dropdown>
          )}
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
                      <span className="px-0.5 text-line-emphasis" aria-hidden>
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
                      className={`rounded-sm px-1 py-0.5 transition-colors duration-150 ${
                        last ? "text-fg" : "text-fg-muted hover:bg-surface-muted hover:text-fg"
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
    <div
      data-slot="head"
      {...band}
      className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-2"
    >
      <div className="flex shrink-0 items-center">
        <button
          type="button"
          className={`${navButtonClass} sm:hidden`}
          aria-label={sidebarOpen ? f.hideSidebar : f.showSidebar}
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((v) => !v)}
        >
          <GlyphIcon d={ICONS.panelLeft} size={ICON_SIZE.iconButton} />
        </button>
        <button
          type="button"
          className={navButtonClass}
          disabled={!canGoBack(history)}
          data-tooltip={`${f.back} (${shortcut("⌘[", "Ctrl+[")})`}
          aria-label={f.back}
          onClick={() => step(-1)}
        >
          <GlyphIcon d={ICONS.arrowLeftCentered} size={ICON_SIZE.iconButton} />
        </button>
        <button
          type="button"
          className={navButtonClass}
          disabled={!canGoForward(history)}
          data-tooltip={`${f.forward} (${shortcut("⌘]", "Ctrl+]")})`}
          aria-label={f.forward}
          onClick={() => step(1)}
        >
          <GlyphIcon d={ICONS.arrowRightCentered} size={ICON_SIZE.iconButton} />
        </button>
        <button
          type="button"
          className={navButtonClass}
          disabled={parentPath === null}
          data-tooltip={`${f.up} (${shortcut("⌘↑", "Alt+↑")})`}
          aria-label={f.up}
          onClick={goParent}
        >
          <GlyphIcon d={ICONS.arrowUp} size={ICON_SIZE.iconButton} />
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
          <GlyphIcon d={ICONS.refresh} size={ICON_SIZE.iconButton} />
        </button>
      </div>
      {addressBar}
      <label className="relative flex shrink-0 items-center">
        <GlyphIcon
          d={ICONS.search}
          size={ICON_SIZE.inlineGlyph}
          className="pointer-events-none absolute left-2 text-fg-subtle"
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
          // The text-control look at the address bar's height and type, which no SearchInput
          // rung has: the two boxes share the toolbar's one line.
          className={`${controlBase} h-8 w-20 pl-7 pr-2 text-sm placeholder:text-fg-subtle sm:w-40`}
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
      <div className="px-2 py-3">
        <NoticeStrip
          tone={denied !== null ? "attention" : "danger"}
          className="rounded-md border px-3 py-2.5 text-sm"
        >
          <p data-slot="title" className="font-medium">
            {denied !== null ? f.deniedTitle : f.loadFailed}
          </p>
          <div data-slot="body">
            <p className="mt-1 text-xs leading-5">
              {denied !== null ? f[denied.text] : apiErrorText(view.error)}
            </p>
            <p className="mt-1 break-all font-mono text-xs opacity-80">{view.path}</p>
          </div>
          <div data-slot="actions" className="mt-2 flex flex-wrap items-center gap-2">
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
    body = <p className="px-2 py-3 text-xs text-fg-subtle">{S.common.loading}</p>;
  } else if (entries.length === 0) {
    body = (
      <p className="px-2 py-3 text-xs text-fg-subtle">
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
          // A band inset from the pane's edges on the row radius, as the places beside it are;
          // the selection takes the accent while the list has focus and the rail's selected
          // fill while it does not.
          className={`flex select-none items-center ${ICON_GAP.menu} rounded-md px-2 py-1 text-sm ${
            !folder
              ? "cursor-default text-fg-subtle"
              : isSel
                ? listFocused
                  ? "bg-accent text-accent-fg"
                  : "bg-line-muted text-fg"
                : "cursor-default text-fg hover:bg-surface-muted"
          }`}
        >
          <GlyphIcon
            d={folder ? ICONS.folder : ICONS.file}
            size={ICON_SIZE.rowLead}
            className={`shrink-0 ${accent ? "" : "text-fg-subtle"}`}
          />
          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
          <span
            className={`hidden w-36 shrink-0 text-xs tabular-nums sm:block ${accent ? "" : "text-fg-subtle"}`}
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
              className={`flex w-6 shrink-0 justify-center rounded-sm py-0.5 transition-colors duration-150 ${
                accent ? "text-current" : "text-fg-subtle hover:text-fg"
              }`}
            >
              <GlyphIcon d={ICONS.chevronRight} size={ICON_SIZE.inlineGlyph} />
            </button>
          ) : (
            <span className="w-6 shrink-0" aria-hidden />
          )}
        </div>
      );
    });
  }

  const clear = clearButton({
    offered: onClear !== undefined,
    stateDir: agentState !== null && agentState.agentId === agentId ? agentState.dir : null,
    machine,
  });

  // The key map reaches the footer's buttons too, so F5 from Choose refreshes rather than
  // reloading the app; `contents` keeps the wrapper out of the footer's own row layout.
  const footer = (
    <div className="contents" onKeyDown={onKeyDown}>
      {/* The host's "no folder" choice: a plain text button whatever is chosen now; the folder a
          temporary Workspace would get is its tooltip. */}
      {clear !== null && (
        <Button
          size="sm"
          title={clear.fullPath ?? clearTitle}
          className="mr-auto min-w-0 self-center"
          onClick={() => onClear?.(machine)}
        >
          <span className="min-w-0 truncate">{clearLabel}</span>
        </Button>
      )}
      {/* The buttons keep their width; on a phone the button beside them truncates instead. */}
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
    </div>
  );

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      // No title bar: Cancel in the footer (and Escape, and the backdrop) is the way out, and
      // the title still names the dialog for assistive tech.
      headerless
      bare
      fullScreenOnPhone
      widthClass="sm:h-[min(36rem,85vh)] sm:max-w-3xl"
      footer={footer}
    >
      {toolbar}
      <div {...band} className="relative flex min-h-0 flex-1">
        {sidebar}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Lined up with the rows below: the list's inset plus a row's own padding. */}
          <div className="flex items-center gap-2 border-b border-line-muted px-4 py-1 text-xs text-fg-subtle">
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
            className={`min-h-0 flex-1 overflow-y-auto px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg-subtle/40 ${
              loading && view.listing !== null ? "opacity-60" : ""
            }`}
          >
            {body}
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
          returnFocus={() => {
            const owner = menu.anchorOwner();
            const place = owner?.hasAttribute("data-finder-place") === true ? owner : null;
            return place?.querySelector<HTMLElement>("button") ?? listRef.current;
          }}
          className="contents"
          menuClass="w-max min-w-40 max-w-[calc(100vw-2rem)]"
          button={null}
        >
          <Menu density="sm">
            {finderMenuItems(menuTarget, inQuickAccess(menuTarget.path, menuTarget.machine)).map(
              (item) => (
                <MenuItem
                  key={item}
                  glyph={MENU_ICON[item]}
                  label={menuLabel(item, menuTarget)}
                  onSelect={() => runMenuItem(item, menuTarget)}
                />
              ),
            )}
          </Menu>
        </Dropdown>
      )}
    </Modal>
  );
}
