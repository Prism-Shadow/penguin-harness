/**
 * The live update badges, read by every anchor on the two update trails: the mobile menu
 * button, the sidebar avatar and its collapsed-rail twin, and both Agents nav entries.
 *
 * One owner activates the fetches. `AppLayout` calls this with `eager` on, which is what makes
 * a badge appear on a fresh load at all — the anchors below it stay passive and read the shared
 * caches (`use-version-info.ts`, `use-desktop-update.ts`), which push every consumer when a
 * result lands. Both caches are module level, so "eager" still costs one request per browser
 * session, and both are fail-soft: an unreachable check leaves every gate closed and says
 * nothing.
 *
 * The gates themselves are pure and unit tested in `update-badges.ts`; this file only wires
 * them to the stores and turns the note into localized copy.
 */
import { useEffect } from "react";
import { S } from "./strings";
import { offersClientUpdate } from "./desktop-update";
import { refreshDesktopUpdate, useDesktopUpdate } from "./use-desktop-update";
import { useVersionInfo } from "./use-version-info";
import { anyKernelOutdated, softwareUpdate, updateBadgeNote } from "./update-badges";
import type { SoftwareUpdate, UpdateBadgeNote } from "./update-badges";
import { useAuth } from "../state/auth";
import { useProject } from "../state/project";

export interface UpdateBadges {
  /** A software update this mode can act on, or null. */
  software: SoftwareUpdate | null;
  /** What the software anchors (the avatars) say — the update row's own wording; null with no update. */
  softwareNote: string | null;
  /** Whether any Agent in the current Project has an outdated kernel. */
  kernel: boolean;
  /** What the Agents anchors say; null when no kernel is outdated. */
  kernelNote: string | null;
  /** Whether the outermost chrome shows a dot at all. */
  any: boolean;
  /** What an anchor covering both trails says — the combined case names neither. Null when there is nothing. */
  note: string | null;
}

export function useUpdateBadges(eager = false): UpdateBadges {
  const { desktopMode, sessionVia } = useAuth();
  const { agents } = useProject();
  const clientRowOffered = offersClientUpdate({ desktopMode, sessionVia });
  const { update } = useVersionInfo(eager);
  // Passive: the shell's snapshot is polled by the sidebar's own hook instance while the user
  // menu is open. The one-shot refresh below is what lets a build downloaded before this load
  // show up without opening anything.
  const { status } = useDesktopUpdate(false, false);
  useEffect(() => {
    if (eager && clientRowOffered) refreshDesktopUpdate();
  }, [eager, clientRowOffered]);

  const software = softwareUpdate({
    releaseRowOffered: !desktopMode,
    clientRowOffered,
    update,
    clientStatus: status,
  });
  const kernel = anyKernelOutdated(agents);
  const kernelNote = kernel ? S.agent.kernelOutdatedHint : null;
  const softwareNote = software === null ? null : noteText(software);

  return {
    software,
    softwareNote,
    kernel,
    kernelNote,
    any: software !== null || kernel,
    note: noteText(updateBadgeNote(software, kernel)),
  };
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
    default:
      return S.update.updatesAvailable;
  }
}
