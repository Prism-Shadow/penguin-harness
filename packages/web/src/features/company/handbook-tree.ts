/**
 * The handbook page's pure model (unit tested): the file listing shaped into the pinned
 * index, the documents beside it and the top-level folders; the path rule the server
 * enforces, mirrored so the new-document dialog refuses a bad path before the request; the
 * body a new document starts with; and how a relative link inside one document resolves to
 * another document of the handbook.
 */
import type { OrgHandbookFile } from "@prismshadow/penguin-server/api";

/** The index, `handbook/README.md`: pinned first in the list, and the one file that cannot be deleted. */
export const HANDBOOK_INDEX = "README.md";

/**
 * The server's rule for a path inside `handbook/`: plain `/`-separated segments, each starting
 * with a letter or digit and made of letters, digits, `.`, `_` and `-` (so no hidden files and
 * no `.` / `..`), at most eight levels deep.
 */
export const HANDBOOK_PATH_PATTERN =
  /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/){0,7}[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isHandbookPath(rel: string): boolean {
  return HANDBOOK_PATH_PATTERN.test(rel);
}

/**
 * What the dialog sends for what was typed: surrounding whitespace, a leading `/` or `./` and
 * a trailing `/` dropped, `.md` appended when the file name carries no extension. Whether the
 * result is a handbook path is the caller's check (isHandbookPath).
 */
export function completeHandbookPath(input: string): string {
  let rel = input
    .trim()
    .replace(/^(?:\.\/|\/)+/, "")
    .replace(/\/+$/, "");
  if (rel !== "" && !fileName(rel).includes(".")) rel += ".md";
  return rel;
}

/** The last segment of a path. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Whether the page renders the file as Markdown; anything else shows as preformatted text. */
export function isMarkdownPath(path: string): boolean {
  return /\.(?:md|markdown)$/i.test(path);
}

/** The one-line body a new document starts with: a title made of its file name without the extension. */
export function newDocumentBody(path: string): string {
  return `# ${fileName(path).replace(/\.[^.]+$/, "")}\n`;
}

export interface HandbookDoc extends OrgHandbookFile {
  /** What the row shows: the file name for a document beside the index, the remainder under its top-level folder otherwise. */
  label: string;
}

export interface HandbookFolder {
  name: string;
  /** Every document beneath the folder, by path; a deeper path keeps its remainder as the label. */
  docs: HandbookDoc[];
}

export interface HandbookTree {
  /** The index, or null when the listing lacks it (a handbook directory someone emptied by hand). */
  index: OrgHandbookFile | null;
  /** The documents beside the index, by path. */
  root: HandbookDoc[];
  /** The top-level folders by name. */
  folders: HandbookFolder[];
}

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The listing as the page lists it: the index apart, root documents first, then one group per top-level folder. */
export function buildHandbookTree(files: readonly OrgHandbookFile[]): HandbookTree {
  const index = files.find((f) => f.path === HANDBOOK_INDEX) ?? null;
  const root: HandbookDoc[] = [];
  const byFolder = new Map<string, HandbookDoc[]>();
  const rest = files
    .filter((f) => f.path !== HANDBOOK_INDEX)
    .sort((a, b) => byPath(a.path, b.path));
  for (const file of rest) {
    const at = file.path.indexOf("/");
    if (at === -1) {
      root.push({ ...file, label: file.path });
      continue;
    }
    const folder = file.path.slice(0, at);
    const doc = { ...file, label: file.path.slice(at + 1) };
    const docs = byFolder.get(folder);
    if (docs === undefined) byFolder.set(folder, [doc]);
    else docs.push(doc);
  }
  const folders = [...byFolder.entries()]
    .sort(([a], [b]) => byPath(a, b))
    .map(([name, docs]) => ({ name, docs }));
  return { index, root, folders };
}

/**
 * Where a relative link inside a document points: another document of the handbook, as its
 * handbook path — or null for anything that is not one (an absolute URL, a bare `#anchor`, a
 * path that climbs out of `handbook/`). Resolved against the linking document's folder the way
 * a browser would, a leading `/` meaning the handbook's root; a `#fragment` or `?query` on the
 * target is dropped.
 */
export function resolveHandbookLink(from: string, href: string): string | null {
  if (href === "" || href.startsWith("#") || href.startsWith("//")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  let target = href.replace(/[?#].*$/, "");
  try {
    target = decodeURIComponent(target);
  } catch {
    return null;
  }
  if (target === "") return null;
  const base = from.includes("/") ? from.slice(0, from.lastIndexOf("/")).split("/") : [];
  const out = target.startsWith("/") ? [] : [...base];
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  const rel = out.join("/");
  return isHandbookPath(rel) ? rel : null;
}
