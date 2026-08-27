/**
 * The live badges, read by every anchor on the five trails: the mobile menu button, the
 * sidebar avatar and its collapsed-rail twin, and the Agents / Skills / Models / Cost Center
 * nav entries in both the pinned sidebar and the rail.
 *
 * One owner activates the fetches. `AppLayout` calls this with `eager` on, which is what makes
 * a badge appear on a fresh load at all — the anchors below it stay passive and read the shared
 * caches (`use-version-info.ts`, `use-desktop-update.ts`, `use-project-todos.ts`, and the
 * dismissal markers in `todo-dismissals.ts`), which push every consumer when a result lands.
 * All of them are module level, so "eager" still costs one request per browser session per
 * Project, and all of them are fail-soft: an unreachable check leaves every gate closed and
 * says nothing.
 *
 * The gates themselves are pure and unit tested in `update-badges.ts` and `todo-badges.ts`;
 * this file only wires them to the stores and turns each into localized copy. Two rules it
 * enforces on the way, both of them the same rule: a badge only appears where the user can
 * reach a control. The desktop shell hides the server-release row, so a newer release raises
 * nothing there; syncing presets is owner-only, so a member never sees the Models dot (and
 * `use-project-todos.ts` does not even make that request).
 */
import { useEffect, useMemo } from "react";
import { S } from "./strings";
import { offersClientUpdate } from "./desktop-update";
import { refreshDesktopUpdate, useDesktopUpdate } from "./use-desktop-update";
import { useVersionInfo } from "./use-version-info";
import { anyKernelOutdated, badgeNote, softwareUpdate } from "./update-badges";
import type { BadgeSource, SoftwareUpdate, UpdateBadgeNote } from "./update-badges";
import { presetUpdateTodo, raisedTodo, skillUpdateTodo, unexpectedErrorTodo } from "./todo-badges";
import type { Todo, TodoKey } from "./todo-badges";
import { useTodoDismissals } from "./todo-dismissals";
import { useProjectTodos } from "./use-project-todos";
import { catalogDelta } from "../features/models/catalog-sync";
import { useAuth } from "../state/auth";
import { useProject } from "../state/project";

/** The nav routes that can carry a dot, and what each one's dot leads to. */
export type BadgedRoute = "/agents" | "/skills" | "/models" | "/usage";

export interface UpdateBadges {
  /** A software update this mode can act on, or null. */
  software: SoftwareUpdate | null;
  /** What the software anchors (the avatars) say — the update row's own wording; null with no update. */
  softwareNote: string | null;
  /** What each badged nav entry says; a route absent from the map carries no dot. */
  navNotes: Partial<Record<BadgedRoute, string>>;
  /** The raised to-do of each dismissible trail, for the page that clears it; absent when down. */
  todos: Partial<Record<TodoKey, Todo>>;
  /** Whether the outermost chrome shows a dot at all. */
  any: boolean;
  /** What an anchor covering everything says — a combined case names none of them. Null when there is nothing. */
  note: string | null;
}

export function useUpdateBadges(eager = false): UpdateBadges {
  const { desktopMode, sessionVia } = useAuth();
  const { agents, currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  // Syncing presets is owner-only, so that trail has no control at its end for a member.
  const ownsProject = currentProject?.role === "owner";
  const clientRowOffered = offersClientUpdate({ desktopMode, sessionVia });
  const { update } = useVersionInfo(eager);
  // Passive: the shell's snapshot is polled by the sidebar's own hook instance while the user
  // menu is open. The one-shot refresh below is what lets a build downloaded before this load
  // show up without opening anything.
  const { status } = useDesktopUpdate(false, false);
  useEffect(() => {
    if (eager && clientRowOffered) refreshDesktopUpdate();
  }, [eager, clientRowOffered]);
  const probes = useProjectTodos(projectId, eager, ownsProject);
  const dismissed = useTodoDismissals(projectId, eager);

  const software = softwareUpdate({
    releaseRowOffered: !desktopMode,
    clientRowOffered,
    update,
    clientStatus: status,
  });
  const kernel = anyKernelOutdated(agents);
  // Memoized on the cached response's identity: this walks the whole built-in catalog, and the
  // hook re-runs on every render of the pages that read it (a keystroke in the model search box).
  const presetTodo = useMemo(
    () => (probes.models === null ? null : presetUpdateTodo(catalogDelta(probes.models.models))),
    [probes.models],
  );
  // Markers still in flight (`null`) close every gate: raising a dot and putting it down a
  // moment later, on a trail the user had already dealt with, is worse than a late dot.
  const raise = (todo: Todo | null, key: TodoKey): Todo | null =>
    dismissed === null ? null : raisedTodo(todo, dismissed[key] ?? null);
  const skills = raise(skillUpdateTodo(agents), "skills");
  const models = raise(presetTodo, "models");
  const errors = raise(
    probes.errors === null ? null : unexpectedErrorTodo(probes.errors),
    "errors",
  );

  // Every raised source, in the order the trails appear in the nav. `badgeNote` reads the list;
  // the per-route map below is what each individual anchor says.
  const sources: BadgeSource[] = [];
  if (software !== null) sources.push(software);
  if (kernel) sources.push({ kind: "kernel" });
  if (skills !== null) sources.push({ kind: "skills", count: skills.count });
  if (models !== null) sources.push({ kind: "models", count: models.count });
  if (errors !== null) sources.push({ kind: "errors", count: errors.count });

  const navNotes: Partial<Record<BadgedRoute, string>> = {};
  if (kernel) navNotes["/agents"] = S.agent.kernelOutdatedHint;
  if (skills !== null) navNotes["/skills"] = S.todo.skillUpdates(skills.count);
  if (models !== null) navNotes["/models"] = S.todo.presetUpdates(models.count);
  if (errors !== null) navNotes["/usage"] = S.todo.unexpectedErrors(errors.count);

  return {
    software,
    softwareNote: software === null ? null : noteText(software),
    navNotes,
    todos: {
      ...(skills !== null ? { skills } : {}),
      ...(models !== null ? { models } : {}),
      ...(errors !== null ? { errors } : {}),
    },
    any: sources.length > 0,
    note: noteText(badgeNote(sources)),
  };
}

/**
 * The note one nav route's dot carries, or null. Routes off every trail are simply absent from
 * the map, so the lookup widens the key type rather than each caller asserting its own route
 * into {@link BadgedRoute} — the nav rows are built from a route manifest and only ever hold
 * strings.
 */
export function navNoteFor(badges: UpdateBadges, route: string): string | null {
  return (badges.navNotes as Partial<Record<string, string>>)[route] ?? null;
}

/**
 * The localized sentence for one note. Read at call time, never hoisted: `S` is a live binding
 * swapped on locale change.
 */
function noteText(note: UpdateBadgeNote): string | null {
  switch (note.kind) {
    case "none":
      return null;
    case "release":
      return S.update.newVersion(note.version);
    case "client":
      return S.update.clientRestartToInstall(note.version);
    case "kernel":
      return S.agent.kernelOutdatedHint;
    case "skills":
      return S.todo.skillUpdates(note.count);
    case "models":
      return S.todo.presetUpdates(note.count);
    case "errors":
      return S.todo.unexpectedErrors(note.count);
    default:
      return note.updatesOnly ? S.update.updatesAvailable : S.todo.pending;
  }
}
