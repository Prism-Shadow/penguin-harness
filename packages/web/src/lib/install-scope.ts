/**
 * Scoping browser-persisted UI state to the data root it was made against.
 *
 * The report this exists for: a user deleted their data files, restarted, and the app came
 * back with the old Workspace still selected. `localStorage` has no relationship to the
 * data root at all — in the desktop app it lives in Electron's userData directory, so no
 * amount of deleting `PENGUIN_HOME` touches it — and every key that names an entity names
 * it with a compile-time constant (`admin`, `default_project`). A wipe-and-restart
 * re-provisions the same user and the same Project, the keys line up again, and the old
 * draft, Workspace registry, pins and seen markers all come back.
 *
 * So the server names its root (`<root>/install-id`, served by `GET /api/install`) and this
 * module compares that name against the one this browser last saw. A DIFFERENT name means
 * the state here was made against a root that is gone, and the keys that reference server
 * entities are cleared. Same name — including every ordinary restart — clears nothing.
 *
 * Why one stored id and a sweep, rather than putting the id into every key name:
 *   - key names stay as they are, so no module that builds a key changes and there is no
 *     migration for keys already on disk;
 *   - a key carrying a dead install id would be an orphan nothing ever reads or deletes,
 *     and each wipe would leave another full set behind. The sweep is the one place
 *     orphans are collected, and it collects them by walking the store;
 *   - the classification below stays readable as a table instead of being spread across
 *     twenty call sites.
 *
 * FIRST SIGHT (a browser with keys but no stored id — every user upgrading into this
 * release) is indistinguishable from a wiped root, so it ADOPTS the current id and sweeps
 * nothing. Destroying legitimate state on upgrade would be a far worse bug than the one
 * being fixed. The practical consequence, which the changelog states plainly: state that is
 * ALREADY stale when this ships stays stale; only wipes from here on are handled.
 */
import * as api from "../api/endpoints";

/** Where this browser records the data root it last saw. Never swept — it IS the marker. */
export const INSTALL_ID_KEY = "penguin.installId";

/**
 * What a stored key is tied to.
 *
 * - `install` — it references server-side entities (Session ids, Agent ids, Workspace
 *   paths, Project ids, terminal ids, provider group names) that a new data root does not
 *   have. Against a new root it is at best inert and at worst a lie, which is the bug.
 * - `browser` — a display or input preference of this browser. It names nothing on the
 *   server, so a new root can honour it exactly as the old one did, and wiping a data root
 *   is not a request to reset someone's theme.
 */
export type KeyScope = "install" | "browser";

/**
 * One classification rule. `kind: "exact"` matches the key itself; `kind: "family"` matches
 * a key prefix that ends in `.` and covers every id-suffixed key under it.
 *
 * Plain prefix matching would be wrong twice over, which is why the distinction exists:
 * `penguin.sidebarCollapsed` (a preference) is a prefix of
 * `penguin.sidebarCollapsedGroups.<projectId>` (install-scoped), and `penguin.terminal.`
 * covers both `penguin.terminal.theme` (a preference) and `penguin.terminal.page.id`
 * (a terminal id).
 */
export interface KeyRule {
  kind: "exact" | "family";
  key: string;
  scope: KeyScope;
  /** Why this scope — one line, kept next to the rule so the two cannot drift apart. */
  why: string;
}

/**
 * Every `penguin.*` key the web app persists in `localStorage`, classified.
 *
 * ADDING A KEY: add it here too. An unclassified key is left alone by the sweep (never
 * deleting something we do not understand is the safe default), so a forgotten
 * install-scoped key silently reintroduces the bug this module fixes.
 *
 * Two `penguin.*` strings in the source are NOT here on purpose:
 *   - `penguin.chatRouteApplied.<field>` (features/chat/draft-view.tsx) is `sessionStorage`,
 *     not `localStorage`: it is scoped to one tab's history and dies with the tab, so it
 *     cannot outlive a data root.
 *   - `penguin.ooo` (lib/remark-autolink-boundary.ts) is the product's domain inside an
 *     example URL in a doc comment. It is not a storage key.
 */
export const KEY_RULES: readonly KeyRule[] = [
  // ---------------------------------------------------------------- browser preferences
  {
    kind: "exact",
    key: "penguin.theme",
    scope: "browser",
    why: "Colour-scheme choice for this browser; names nothing on the server.",
  },
  {
    kind: "exact",
    key: "penguin.fontScale",
    scope: "browser",
    why: "Root font size — a readability preference of this display.",
  },
  {
    kind: "exact",
    key: "penguin.accent",
    scope: "browser",
    why: "Accent colour; pure appearance.",
  },
  {
    kind: "exact",
    key: "penguin.currency",
    scope: "browser",
    why: "Display currency for prices; a formatting choice, prices are stored in USD either way.",
  },
  {
    kind: "exact",
    key: "penguin.terminal.theme",
    scope: "browser",
    why: "Terminal appearance pin (light/dark/follow-app); appearance only.",
  },
  {
    kind: "exact",
    key: "penguin.lang",
    scope: "browser",
    why: "UI language — the one preference a user would be most annoyed to lose.",
  },
  {
    kind: "exact",
    key: "penguin.sidebarCollapsed",
    scope: "browser",
    why: "Whether the sidebar is a narrow rail; chrome layout, holds no entity.",
  },
  {
    kind: "exact",
    key: "penguin.panelWidth",
    scope: "browser",
    why: "Side-panel width in px; its own module calls it a layout preference, not session data.",
  },
  {
    kind: "exact",
    key: "penguin.sidebarGroupMode",
    scope: "browser",
    why: "Group sessions by Workspace/Agent/time — the MODE, not the groups; valid against any root.",
  },
  {
    kind: "exact",
    key: "penguin.sidebarSortMode",
    scope: "browser",
    why: "Recent vs manual ordering — again the mode; the manual order itself is separate and install-scoped.",
  },
  {
    kind: "exact",
    key: "penguin.sidebarNavGroupCollapsed",
    scope: "browser",
    why: "Whether the static page-nav group is folded; the nav is built from a compile-time manifest.",
  },
  {
    kind: "exact",
    key: "penguin.steerMode",
    scope: "browser",
    why: "Steer vs queue-as-follow-up when sending mid-run; a per-user input habit.",
  },

  // --------------------------------------------------------------- install-scoped state
  {
    kind: "family",
    key: "penguin.chatDraft.",
    scope: "install",
    why: "The new-chat and per-Session drafts: Workspace path, Agent id, model ref, Session id in the key. The reported bug.",
  },
  {
    kind: "family",
    key: "penguin.chatDrafts.",
    scope: "install",
    why: "Parked draft conversations — the same contents as an active draft, kept as a list.",
  },
  {
    kind: "family",
    key: "penguin.sidebarWorkspaces.",
    scope: "install",
    why: "Manually registered Workspace paths per Project; a new root has no such Project.",
  },
  {
    kind: "family",
    key: "penguin.pinnedSessions.",
    scope: "install",
    why: "Pinned Session ids.",
  },
  {
    kind: "family",
    key: "penguin.sessionOrder.",
    scope: "install",
    why: "Manual Session order — an array of Session ids.",
  },
  {
    kind: "family",
    key: "penguin.sessionSeen.",
    scope: "install",
    why: "Read markers keyed by Session id; against a new root every Session is new by definition.",
  },
  {
    kind: "family",
    key: "penguin.groupOrder.",
    scope: "install",
    why: "Manual group order — group keys are Agent ids and Workspace paths.",
  },
  {
    kind: "family",
    key: "penguin.sidebarCollapsedGroups.",
    scope: "install",
    why: "Collapsed sidebar groups, keyed by those same Agent ids and Workspace paths.",
  },
  {
    kind: "family",
    key: "penguin.sidebarPinnedGroups.",
    scope: "install",
    why: "Pinned sidebar groups, same key space.",
  },
  {
    kind: "exact",
    key: "penguin.lastProjectId",
    scope: "install",
    why: "The Project id last selected.",
  },
  {
    kind: "family",
    key: "penguin.lastAgentId.",
    scope: "install",
    why: "The Agent id last selected, per Project.",
  },
  {
    kind: "family",
    key: "penguin.memoryCollapsed.",
    scope: "install",
    why: "Collapsed Memory scopes, keyed by user x Project x Agent and holding scope keys.",
  },
  {
    kind: "family",
    key: "penguin.modelsExpandedGroups.",
    scope: "install",
    why: "Expanded provider groups of a Project's model table; includes user-defined group names that live in that Project's config.",
  },
  {
    kind: "family",
    key: "penguin.modelsGroupOrder.",
    scope: "install",
    why: "Manual order of those same per-Project provider groups.",
  },
  {
    kind: "exact",
    key: "penguin.dock.layout",
    scope: "install",
    why: "Dock tab arrangements keyed by conversation, holding Session ids and terminal ids.",
  },
  {
    kind: "exact",
    key: "penguin.terminal.page.id",
    scope: "install",
    why: "The terminal (shell) id the standalone terminal page reattaches to.",
  },
];

/**
 * The scope of a stored key, or null when no rule covers it. Exact rules are consulted
 * first so a preference is never captured by a family it merely shares a stem with.
 */
export function scopeOfKey(key: string): KeyScope | null {
  for (const rule of KEY_RULES) {
    if (rule.kind === "exact" && rule.key === key) return rule.scope;
  }
  for (const rule of KEY_RULES) {
    if (rule.kind === "family" && key.startsWith(rule.key)) return rule.scope;
  }
  return null;
}

/**
 * The subset of `localStorage` this module uses. Enumeration (`length` + `key`) is what
 * lets one rule cover every id-suffixed key under it and clean up orphans left by earlier
 * roots. Tests inject an in-memory implementation — vitest runs in Node, with no DOM
 * (the model-group-expansion.ts convention).
 */
export interface InstallScopeStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * What one boot's comparison did.
 *
 * - `unknown` — no id to compare (the server could not establish one, or the request
 *   failed). Nothing read, nothing written, nothing removed.
 * - `adopted` — this browser had no id recorded. First sight; the id is stored and nothing
 *   is swept.
 * - `unchanged` — same root as last time. The ordinary case, including every restart.
 * - `swept` — a different root. Install-scoped keys removed, preferences kept.
 */
export type InstallScopeResult = "unknown" | "adopted" | "unchanged" | "swept";

/** Reads one key, treating a throwing store as empty (blocked site data, partitioned iframe). */
function read(storage: InstallScopeStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Removes every install-scoped key. Keys are collected before anything is removed:
 * `removeItem` renumbers the store, so deleting during the walk would skip entries.
 * Returns the keys removed (the caller logs the count; tests assert on it).
 */
function sweep(storage: InstallScopeStorage): string[] {
  const doomed: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key !== null && scopeOfKey(key) === "install") doomed.push(key);
    }
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const key of doomed) {
    try {
      storage.removeItem(key);
      removed.push(key);
    } catch {
      /* best-effort: a key that refuses to go is swept again on the next load */
    }
  }
  return removed;
}

/**
 * Compares the server's install id against the one this browser recorded, and acts on the
 * difference. Pure with respect to everything but the store, so the whole decision table is
 * testable without a DOM.
 *
 * `installId` of null means the server could not establish one; that is "unknown", never
 * "new", so nothing is touched. The sweep runs BEFORE the id is stored: if the write fails
 * (quota, private browsing) the next load repeats the comparison and sweeps again, which is
 * idempotent — whereas recording an id we had not finished acting on would not be.
 */
export function reconcileInstallScope(
  installId: string | null,
  storage: InstallScopeStorage,
): InstallScopeResult {
  if (installId === null) return "unknown";
  const stored = read(storage, INSTALL_ID_KEY);
  if (stored === installId) return "unchanged";

  const result: InstallScopeResult = stored === null ? "adopted" : "swept";
  if (result === "swept") sweep(storage);
  try {
    storage.setItem(INSTALL_ID_KEY, installId);
  } catch {
    /* best-effort: unrecorded means the next load compares again, which is harmless */
  }
  return result;
}

/** How long to wait for the identity before rendering anyway — see syncInstallScope. */
const INSTALL_ID_TIMEOUT_MS = 3000;

/**
 * Asks the server for this data root's identity and reconciles the browser's state against
 * it. Never rejects and never throws: a boot step that can break the whole app is worse
 * than the surprise it prevents.
 *
 * Bounded by a timeout because the caller renders nothing until this settles. The page's
 * own HTML came from this same server milliseconds earlier, so an answer that takes longer
 * than three seconds means something is badly wrong — and in that state showing the app
 * with unswept state beats showing a blank page. Giving up resolves to `unknown`, which
 * changes nothing; the next load tries again.
 */
export async function syncInstallScope(storage?: InstallScopeStorage): Promise<InstallScopeResult> {
  let installId: string | null = null;
  try {
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), INSTALL_ID_TIMEOUT_MS);
    });
    const answered = await Promise.race([api.getInstall().then((res) => res.installId), timeout]);
    installId = answered;
  } catch {
    // A server that cannot answer is one we cannot identify: sweep nothing.
    return "unknown";
  }
  try {
    // `localStorage` is resolved INSIDE the try, never as a default parameter: merely
    // touching it throws a SecurityError when site data is blocked (the convention every
    // storage module here follows).
    return reconcileInstallScope(installId, storage ?? localStorage);
  } catch {
    return "unknown";
  }
}
