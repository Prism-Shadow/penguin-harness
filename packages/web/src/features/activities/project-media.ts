/**
 * Pure helpers behind the project media library: every file uploaded to any activity of the
 * project, narrowed by type, product and a search, ordered one of four ways, and the chosen
 * few turned into what the download asks the server for.
 */
import type { BundleItem, LibraryFile, UploadKind } from "@prismshadow/penguin-server/api";

export type LibraryView = "grid" | "table";
export type LibrarySort = "name" | "newest" | "size" | "activity";
export type LibraryKindFilter = "all" | UploadKind;

export const LIBRARY_VIEWS: readonly LibraryView[] = ["grid", "table"];
export const LIBRARY_SORTS: readonly LibrarySort[] = ["name", "newest", "size", "activity"];
export const LIBRARY_KINDS: readonly LibraryKindFilter[] = ["all", "image", "audio", "video"];

/** The most files one download bundles, as the server enforces. */
export const BUNDLE_LIMIT = 60;

export interface LibraryFilter {
  kind: LibraryKindFilter;
  /** A product code, or "" for every product. */
  productCode: string;
  query: string;
}

/** The files a filter keeps. The search matches the file name, the activity title and its ref. */
export function filterLibrary(files: readonly LibraryFile[], filter: LibraryFilter): LibraryFile[] {
  const needle = filter.query.trim().toLowerCase();
  return files.filter(
    (file) =>
      (filter.kind === "all" || file.kind === filter.kind) &&
      (!filter.productCode || file.productCode === filter.productCode) &&
      (!needle ||
        file.name.toLowerCase().includes(needle) ||
        file.activityTitle.toLowerCase().includes(needle) ||
        `${file.productCode} / ${file.refNum}`.toLowerCase().includes(needle)),
  );
}

const byName = (left: LibraryFile, right: LibraryFile) =>
  left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
const byNewest = (left: LibraryFile, right: LibraryFile) =>
  right.updatedAt.localeCompare(left.updatedAt);
const byActivity = (left: LibraryFile, right: LibraryFile) =>
  left.productCode.localeCompare(right.productCode) || left.refNum - right.refNum;

/**
 * The files in one order, never changing the input. Ties fall back to the name, then the
 * activity, so an order is the same on every render.
 */
export function sortLibrary(files: readonly LibraryFile[], sort: LibrarySort): LibraryFile[] {
  const primary =
    sort === "newest"
      ? byNewest
      : sort === "size"
        ? (left: LibraryFile, right: LibraryFile) => right.byteLength - left.byteLength
        : sort === "activity"
          ? byActivity
          : byName;
  return [...files].sort(
    (left, right) =>
      primary(left, right) ||
      byName(left, right) ||
      byActivity(left, right) ||
      left.activityId.localeCompare(right.activityId),
  );
}

/** Every product with at least one file, in order. */
export function productCodes(files: readonly LibraryFile[]): string[] {
  return [...new Set(files.map((file) => file.productCode))].sort((left, right) =>
    left.localeCompare(right),
  );
}

/** One file's identity: the same path may exist in two activities. */
export function selectionKey(file: Pick<LibraryFile, "activityId" | "path">): string {
  return `${file.activityId}\n${file.path}`;
}

/** What the bundle request names, one entry per chosen file. */
export function bundleItems(selected: readonly LibraryFile[]): BundleItem[] {
  return selected.map((file) => ({ activityId: file.activityId, path: file.path }));
}

/** The chosen files, in the order they are shown, out of everything listed. */
export function selectedFiles(
  files: readonly LibraryFile[],
  selection: ReadonlySet<string>,
): LibraryFile[] {
  return files.filter((file) => selection.has(selectionKey(file)));
}

/** A selection with every shown file added to it; files chosen earlier stay chosen. */
export function selectAll(
  selection: ReadonlySet<string>,
  shown: readonly LibraryFile[],
): Set<string> {
  return new Set([...selection, ...shown.map(selectionKey)]);
}

/** A selection with one file added or removed. */
export function toggleOne(selection: ReadonlySet<string>, file: LibraryFile): Set<string> {
  const next = new Set(selection);
  const key = selectionKey(file);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** The files another activity holds, for picking into this one: not this activity's own. */
export function otherActivitiesFiles(
  files: readonly LibraryFile[],
  activityId: string,
  kind: UploadKind,
): LibraryFile[] {
  return files.filter((file) => file.activityId !== activityId && file.kind === kind);
}
