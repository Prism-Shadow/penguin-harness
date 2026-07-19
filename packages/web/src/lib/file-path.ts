/**
 * Whether inline code in a message body looks like a file path (used to
 * render clickable file-reference chips).
 * Heuristic, not exhaustive: no whitespace, no URL scheme, ends with a known
 * extension. Inline code text never contains newlines (mdast-util-to-hast
 * strips them), while block code text always ends with a newline — so
 * "reject if it contains whitespace" is itself the correct test for
 * distinguishing inline code from a code block, not an extra patch.
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

export function isFilePathLike(text: string): boolean {
  const s = text.trim();
  if (s.length === 0 || s.length > 200) return false;
  if (/\s/.test(s)) return false;
  if (URL_SCHEME_RE.test(s) || s.startsWith("www.")) return false;
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(s);
  if (!m) return false;
  const ext = m[1]!.toLowerCase();
  if (/^\d+$/.test(ext)) return false; // version numbers like "v1.2", "3.14" don't count as file paths
  return KNOWN_EXTENSIONS.has(ext);
}

/** Max length for a single files/stat path (matches server-side validation). */
const MAX_PATH_LEN = 512;

/**
 * Normalize a path mentioned in an assistant message to a path relative to
 * the Workspace root (used for file-card display and stat lookups). Returns
 * null (no card rendered) for anything that can't be resolved into the
 * current Workspace:
 *   - An absolute path is stripped only when prefixed with
 *     `${workspace}${sep}` (assistants commonly report absolute paths); if it
 *     equals the workspace itself or the prefix doesn't match → null. A
 *     Windows deployment's Workspace (core supports win32) uses backslash
 *     paths: the prefix is joined with its own separator, and the stripped
 *     relative segment is normalized to "/" (the browser-side directory
 *     navigation splits on "/"). Conversion only happens on a matched Windows
 *     prefix — backslash is a legal character in POSIX filenames, so no
 *     global replacement is done;
 *   - A path starting with `~` (home directory) can't be resolved → null;
 *   - A relative path is lexically normalized by splitting on "/": drop "."
 *     and empty segments, pop the stack on "..", and return null if popping
 *     an empty stack would escape the Workspace root.
 */
export function toWorkspaceRelative(path: string, workspace: string | null): string | null {
  const s = path.trim();
  if (s.length === 0 || s.length > MAX_PATH_LEN) return null;
  if (s.startsWith("~")) return null;
  const ws = workspace !== null && workspace.length > 0 ? workspace : null;
  const winWs = ws?.includes("\\") ?? false;
  const sep = winWs ? "\\" : "/";
  const absolute = s.startsWith("/") || (winWs && (/^[A-Za-z]:/.test(s) || s.startsWith("\\")));
  let rel = s;
  if (absolute) {
    if (ws === null || !s.startsWith(`${ws}${sep}`)) return null;
    rel = s.slice(ws.length + sep.length);
    if (sep === "\\") rel = rel.replaceAll("\\", "/");
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
