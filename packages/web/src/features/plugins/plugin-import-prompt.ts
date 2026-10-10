/**
 * The Plugins page's import dialog, its pure half (unit tested): which pasted sources the server
 * installs as they are — an npm package name on the npm tab, an https link to a git repository
 * or a tarball on the link tab: the server's two kinds of source (its plugin/source.ts; the
 * server stays the authority) — and the prompt that hands anything else to an Agent, which finds
 * and reviews the package and then installs it with `penguin plugin install`.
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

/** Whether the server fetches `input` itself: an https link without credentials, or `github:<owner>/<repo>`. */
export function isPluginLink(input: string): boolean {
  const s = oneToken(input);
  if (s === null) return false;
  if (GITHUB_SHORTHAND.test(s)) return true;
  try {
    const url = new URL(s.startsWith("git+") ? s.slice("git+".length) : s);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
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
 * The prompt for one source: its kind's first sentence, then the fixed tail — review before
 * installing, the command to install with in this Project, and a local folder routed to the
 * zip upload. Reads S at call time, so it follows a language switch.
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
