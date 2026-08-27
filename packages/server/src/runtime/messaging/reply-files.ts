/**
 * Which files a reply MENTIONS: the inline-code paths in a run's assistant text, normalized
 * to Workspace-relative paths.
 *
 * This is deliberately the Web App's "N files" card rule, not a list of everything the run
 * wrote. The Agent's own words are what decide: a chart it hands over is named in the
 * answer, while the twelve intermediates it wrote on the way there are not, and mirroring
 * the filesystem instead would bury the one file the user asked for. Existence is checked
 * separately (WorkspaceFilesService), so a path the model invented or has since deleted
 * simply drops out.
 *
 * The rule is duplicated rather than shared because the card's copy
 * (`packages/web/src/lib/file-path.ts`, `features/chat/message-files-card.tsx`) is a
 * browser module in a package the server cannot import. The two must stay in step: a file
 * the chat sends but the card does not show — or the reverse — is the same feature
 * disagreeing with itself, so a change to either extension set or path rule belongs in
 * both.
 */

/**
 * Extensions that make a token look like a file path. The card's list verbatim: it is
 * broad on purpose (an Agent writes reports, data and code), and the existence check
 * behind it is what keeps a false positive harmless.
 */
const KNOWN_EXTENSIONS = new Set([
  // Text / code
  "txt",
  "md",
  "json",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "py",
  "sh",
  "bash",
  "yaml",
  "yml",
  "toml",
  "css",
  "html",
  "htm",
  "csv",
  "log",
  "xml",
  "ini",
  "conf",
  "rs",
  "go",
  "java",
  "c",
  "h",
  "cpp",
  "hpp",
  "sql",
  "rb",
  "php",
  // Images / documents
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  // Media / archives
  "zip",
  "tar",
  "gz",
  "mp4",
  "mp3",
  "wav",
]);

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Max length of a single path (matches the files/stat route's validation). */
const MAX_PATH_LEN = 512;

/**
 * Whether one inline-code span looks like a file path: no whitespace, no URL scheme, ends
 * in a known extension. Heuristic, not exhaustive — the same one the card applies.
 */
function isFilePathLike(text: string): boolean {
  const s = text.trim();
  if (s.length === 0 || s.length > 200) return false;
  if (/\s/.test(s)) return false;
  if (URL_SCHEME_RE.test(s) || s.startsWith("www.")) return false;
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(s);
  if (!m) return false;
  const ext = m[1]!.toLowerCase();
  if (/^\d+$/.test(ext)) return false; // version numbers like "v1.2" are not file paths
  return KNOWN_EXTENSIONS.has(ext);
}

/**
 * A mentioned path as a Workspace-relative one, or null when it cannot be resolved into
 * this Workspace: an absolute path outside it, a `~` path (this process cannot know whose
 * home that is), or a relative path whose `..` segments climb out. A Windows Workspace is
 * compared on "/" with a case-insensitive drive letter, since core spells model-visible
 * paths with forward slashes while `path.join` produces backslashes; a POSIX Workspace
 * converts nothing, because a backslash is a legal character in a POSIX file name.
 *
 * Refusing an escape here is a readability rule, not the security boundary — the
 * containment check in WorkspaceFilesService is, and every path still goes through it.
 */
function toWorkspaceRelative(mentioned: string, workspace: string): string | null {
  const s = mentioned.trim();
  if (s.length === 0 || s.length > MAX_PATH_LEN) return null;
  if (s.startsWith("~")) return null;
  const winWs = workspace.includes("\\") || /^[A-Za-z]:/.test(workspace);
  const normalize = (p: string): string => {
    if (!winWs) return p;
    const slashed = p.replaceAll("\\", "/");
    return /^[A-Za-z]:/.test(slashed) ? slashed[0]!.toLowerCase() + slashed.slice(1) : slashed;
  };
  const input = normalize(s);
  const ws = normalize(workspace);
  const absolute = input.startsWith("/") || (winWs && /^[a-z]:/.test(input));
  let rel = input;
  if (absolute) {
    if (!input.startsWith(`${ws}/`)) return null;
    rel = input.slice(ws.length + 1);
  }
  const stack: string[] = [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(seg);
  }
  return stack.length > 0 ? stack.join("/") : null;
}

/**
 * The Workspace-relative paths one run's assistant text mentions, deduplicated and in order
 * of appearance. Deduplication is keyed on the NORMALIZED path, so a file named once
 * absolutely and once relatively is one file — otherwise a run that reports its output both
 * ways would send the same picture twice.
 */
export function replyFilePaths(text: string, workspace: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const raw = match[1]!.trim();
    if (!isFilePathLike(raw)) continue;
    const rel = toWorkspaceRelative(raw, workspace);
    if (rel === null || seen.has(rel)) continue;
    seen.add(rel);
    out.push(rel);
  }
  return out;
}
