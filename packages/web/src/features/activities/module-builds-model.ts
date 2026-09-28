/**
 * Pure helpers behind Module builds: the rows the table shows, which two builds are
 * selected and in which order they compare, whether the preview plays an older build, and
 * what a compare lists. Strings are read when called, so a language switch takes effect.
 */
import type {
  ModuleBuild,
  ModuleBuildDiff,
  ModuleBuildList,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { fileSizeText } from "./media-library";

/** A build's short name: "Build" and the first characters of its run id. */
export function buildLabel(runId: string): string {
  return S.activities.moduleBuilds.label(runId.replace(/^run_/, "").slice(0, 6));
}

export interface BuildRow {
  runId: string;
  label: string;
  createdAt: string;
  files: string;
  newest: boolean;
  /** Whether the preview plays this build now. */
  playing: boolean;
  /** Whether an author pinned this build. */
  pinned: boolean;
}

/** Newest first, whatever order the list arrived in. */
export function buildRows(list: ModuleBuildList): BuildRow[] {
  const words = S.activities.moduleBuilds;
  return [...list.builds]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .map((build) => ({
      runId: build.runId,
      label: buildLabel(build.runId),
      createdAt: build.createdAt,
      files: build.files === null ? words.noFolder : words.files(build.files),
      newest: build.newest,
      playing: build.runId === list.playingRunId,
      pinned: build.runId === list.pinnedRunId,
    }));
}

/**
 * The selection after ticking or unticking `runId`: at most two builds, so ticking a third
 * lets go of the one ticked first.
 */
export function toggleBuild(selected: readonly string[], runId: string): string[] {
  if (selected.includes(runId)) return selected.filter((id) => id !== runId);
  return [...selected, runId].slice(-2);
}

/** The two selected builds as a compare reads them, older first; null unless two are. */
export function compareOrder(
  builds: readonly ModuleBuild[],
  selected: readonly string[],
): { from: string; to: string } | null {
  if (selected.length !== 2) return null;
  const chosen = selected
    .map((runId) => builds.find((build) => build.runId === runId))
    .filter((build): build is ModuleBuild => Boolean(build));
  if (chosen.length !== 2) return null;
  const [a, b] = chosen as [ModuleBuild, ModuleBuild];
  return a.createdAt <= b.createdAt
    ? { from: a.runId, to: b.runId }
    : { from: b.runId, to: a.runId };
}

/**
 * The pinned build the preview plays instead of the newest, or null when the preview plays
 * the newest (nothing pinned, the pinned build is the newest, or it is gone).
 */
export function olderBuildPlaying(list: ModuleBuildList): string | null {
  const pinned = list.pinnedRunId;
  if (!pinned || list.playingRunId !== pinned) return null;
  const build = list.builds.find((item) => item.runId === pinned);
  return build && !build.newest ? pinned : null;
}

/**
 * The pinned build when it no longer plays because it is gone (the newest plays instead), so
 * the author can still unpin it; null otherwise.
 */
export function pinGone(list: ModuleBuildList): string | null {
  const pinned = list.pinnedRunId;
  return pinned && list.playingRunId !== pinned ? pinned : null;
}

export interface BuildFileRow {
  path: string;
  change: string;
  before: string;
  after: string;
  /** Why the text is not shown, or null when it is. */
  note: string | null;
}

/** The compare's table: every file that differs, with sizes and why its text is not shown. */
export function buildFileRows(diff: ModuleBuildDiff): BuildFileRow[] {
  const words = S.activities.moduleBuilds;
  const size = (bytes: number | null) => (bytes === null ? words.noFile : fileSizeText(bytes));
  return diff.files.map((file) => ({
    path: file.path,
    change: words.changes[file.change] ?? file.change,
    before: size(file.beforeBytes),
    after: size(file.afterBytes),
    note: file.text === "shown" ? null : (words.text[file.text] ?? null),
  }));
}

/** The files whose text a compare shows, with the two texts its line diff reads. */
export function textFiles(
  diff: ModuleBuildDiff,
): { path: string; before: string; after: string }[] {
  return diff.files
    .filter((file) => file.text === "shown")
    .map((file) => ({ path: file.path, before: file.before ?? "", after: file.after ?? "" }));
}
