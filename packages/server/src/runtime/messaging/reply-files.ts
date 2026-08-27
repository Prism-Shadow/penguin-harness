/**
 * Which files a reply MENTIONS: the path-like tokens in a run's assistant text, normalized
 * to Workspace-relative paths.
 *
 * The Agent's own words are what decide. A chart it hands over is named in the answer,
 * while the twelve intermediates it wrote on the way there are not, and mirroring the
 * filesystem instead would bury the one file the user asked for. Existence is checked
 * separately (WorkspaceFilesService), and that check is what makes a loose extraction safe:
 * a token that is not a real file in this Workspace costs nothing to have considered.
 *
 * ## Why this is looser than the Web App's file card
 *
 * The card (`packages/web/src/features/chat/message-files-card.tsx`) reads inline-code
 * spans only, and that was this module's first rule too. It does not survive contact with
 * a chat: a model that writes "已经把图表保存为 chart.png" or "Saved it at
 * /ws/out/chart.png" names the file perfectly clearly and matched nothing, so the feature
 * produced nothing at all for most real replies. The card can afford the strict rule
 * because it decorates Markdown that is already rendered — a path it misses is simply not
 * clickable, and the file is still one click away in the Files panel. Here the extraction
 * IS the feature: what it misses never reaches the user.
 *
 * So a token is a candidate wherever it appears — prose, a list, a code block — and
 * prose punctuation is stripped off its edges. The cost is precision: a reply that merely
 * mentions a file it read can now send it. That is bounded by three things — the file must
 * exist in the Workspace, at most a handful ride along per run, and the reply said the name
 * out loud.
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
 * What separates one token from the next: whitespace, Markdown's own decorations
 * (backticks, asterisks, brackets, parentheses, quotes, table pipes, autolink angles), and
 * CJK punctuation — a Chinese sentence puts no spaces around a filename, so without the
 * last group a whole clause arrives as one token and matches nothing.
 *
 * Deliberately NOT boundaries: the ASCII colon and the backslash (together they spell a
 * Windows path, `C:\ws\out.png`), and `_ - + ~ .`, all common inside real file names.
 */
const TOKEN_BOUNDARY = /[\s`*"'()[\]{}<>|,;、，。：；！？“”‘’（）【】〔〕「」『』《》〈〉…—–]+/;

/** Sentence punctuation left clinging to a token's edges ("report.md." → "report.md"). */
const EDGE_PUNCTUATION = /^[.,;:!?]+|[.,;:!?]+$/g;

/**
 * How many candidates are considered per reply. A bound, not a feature: a run that pastes a
 * directory listing into its answer would otherwise put hundreds of names through a stat
 * each. Well past any reply that is actually handing a file over — the batch itself caps at
 * a handful.
 */
const MAX_CANDIDATES = 50;

/**
 * Whether one token looks like a file path: no whitespace, no URL scheme, ends in a known
 * extension. Heuristic, not exhaustive — the card's test, unchanged; what changed around it
 * is which tokens are offered to it.
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
  let considered = 0;
  for (const token of text.split(TOKEN_BOUNDARY)) {
    if (considered >= MAX_CANDIDATES) break;
    const candidate = token.replace(EDGE_PUNCTUATION, "");
    if (!isFilePathLike(candidate)) continue;
    considered += 1;
    const rel = toWorkspaceRelative(candidate, workspace);
    if (rel === null || seen.has(rel)) continue;
    seen.add(rel);
    out.push(rel);
  }
  return out;
}
