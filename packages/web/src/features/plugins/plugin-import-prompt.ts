/**
 * The Plugins page's import dialog, its pure half (unit tested): which pasted sources the server
 * installs as they are — an npm package name on the npm tab, an https link to a git repository
 * or a tarball on the link tab: the server's two kinds of source (its plugin/source.ts; the
 * server stays the authority) — and the prompt that hands anything else to an Agent. A link to a
 * folder or a file inside a GitHub repository is not a source the server installs (npm installs
 * a whole repository or nothing), so it goes to the Agent too. The Agent reviews the source and
 * installs it with `penguin plugin install`; what is not a PenguinHarness package yet (a
 * repository folder, a Codex or Claude Code plugin) it first ports into one with the
 * `plugin-porting` skill.
 */
import { S } from "../../lib/strings";

/** A registry package by name, optionally `@<version, range or tag>` — no `npm:` or `file:` alias. */
const NPM_NAME =
  /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:@[A-Za-z0-9._^~<>=|*+-]+)?$/;
/** `github:<owner>/<repo>[#<ref>]`, npm's shorthand for a GitHub repository. */
const GITHUB_SHORTHAND = /^github:[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:#[A-Za-z0-9._/-]+)?$/;

/** Longer than any real link; the server's cap, so a pasted page is refused here too. */
const MAX_SOURCE_LENGTH = 2048;

/** The trimmed source when it is one token the server would read, else null. */
function oneToken(input: string): string | null {
  const s = input.trim();
  return s === "" || s.length > MAX_SOURCE_LENGTH || /\s/.test(s) ? null : s;
}

/** Whether the server installs `input` from the npm registry: a package name, optionally `@<version>`. */
export function isNpmPluginName(input: string): boolean {
  const s = oneToken(input);
  return s !== null && NPM_NAME.test(s);
}

/** `input` as an https link without credentials (a `git+` prefix dropped), else null. */
function httpsLink(input: string): URL | null {
  const s = oneToken(input);
  if (s === null) return null;
  try {
    const url = new URL(s.startsWith("git+") ? s.slice("git+".length) : s);
    return url.protocol === "https:" && url.username === "" && url.password === "" ? url : null;
  } catch {
    return null;
  }
}

/** Whether `url` points into a GitHub repository at a folder or a file: `/<owner>/<repo>/(tree|blob)/…`. */
function isRepoSubpath(url: URL): boolean {
  return (
    (url.hostname === "github.com" || url.hostname === "www.github.com") &&
    /^\/[^/]+\/[^/]+\/(?:tree|blob)\//.test(url.pathname)
  );
}

/**
 * Whether `input` is an https link to a folder or a file inside a GitHub repository
 * (`https://github.com/<owner>/<repo>/tree/…` or `/blob/…`), which npm cannot install.
 */
export function isRepoSubpathLink(input: string): boolean {
  const url = httpsLink(input);
  return url !== null && isRepoSubpath(url);
}

/**
 * Whether the server fetches `input` itself: an https link without credentials that is not a
 * folder or a file inside a GitHub repository, or `github:<owner>/<repo>`.
 */
export function isPluginLink(input: string): boolean {
  const s = oneToken(input);
  if (s === null) return false;
  if (GITHUB_SHORTHAND.test(s)) return true;
  const url = httpsLink(s);
  return url !== null && !isRepoSubpath(url);
}

/** How the Agent is asked to approach a pasted source: a link, a folder on the server's disk, or a description. */
export type PluginSourceKind = "link" | "localPath" | "reference";

/** Lightly classifies a source; a miss only changes the prompt's first sentence. */
export function classifyPluginSource(input: string): PluginSourceKind {
  const s = input.trim();
  if (/^(https?:\/\/|git\+|git@|github:)/i.test(s)) return "link";
  if (/^(\/|~\/|\.{1,2}\/|[A-Za-z]:[\\/]|\\\\)/.test(s)) return "localPath";
  return "reference";
}

/**
 * The prompt for one source: its kind's first sentence, then the fixed tail — what a plugin
 * package is, a review before installing anything, the command that installs a package (from
 * npm, a link or a local folder) in this Project, and the `plugin-porting` skill for anything
 * that is not a package yet. Reads S at call time, so it follows a language switch.
 */
export function buildPluginImportPrompt(input: string, projectId: string): string {
  const lead = S.plugins.importPromptLead[classifyPluginSource(input)](input);
  return `${lead}\n${S.plugins.importPromptTail(projectId)}`;
}

/** What the server's 409 `plugin_exists` asks about: the package, the installed version and the zip's. */
export interface ReplaceQuestion {
  name: string;
  installed: string;
  incoming: string;
}

/** Reads the question out of the 409's message (its fixed form is pinned by the server's route test); null when it is not that message. */
export function readReplaceQuestion(message: string): ReplaceQuestion | null {
  const m = /^Plugin (\S+) is installed at (\S+); the zip holds (\S+)\.$/.exec(message);
  return m === null ? null : { name: m[1]!, installed: m[2]!, incoming: m[3]! };
}
