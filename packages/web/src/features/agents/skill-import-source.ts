/**
 * Import-source classification for the Skills tab's import dialog (pure logic, unit
 * tested): the source field accepts more than a webpage URL — a GitHub repo or directory
 * URL, a local filesystem path, an install command from another ecosystem (whose plugins
 * are essentially skill files; PenguinHarness has no plugin mechanism of its own), or a
 * bare plugin/marketplace reference. The generated chat prompt tailors its lead sentence
 * per kind; the security tail (read fully, review for malicious instructions, then
 * install) is shared and always appended.
 */
import { S } from "../../lib/strings";

/** How the pasted source should be approached by the agent (one lead sentence per kind in S.skills.importPromptLead). */
export type ImportSourceKind = "webUrl" | "repoUrl" | "localPath" | "command" | "reference";

/** Hosts whose URLs point at a repository or a directory within one (clone / fetch and locate SKILL.md dirs). */
const REPO_HOSTS = /^(www\.)?(github|gitlab|gitee|bitbucket)\.(com|org)$/i;

/**
 * Lightly classifies a pasted source. Heuristic on purpose — the result only picks the
 * prompt's lead sentence, and a miss still yields a safe, workable instruction:
 *   - repoUrl: scp-style git remote (git@host:…), any *.git reference, or an http(s) URL
 *     on a known forge host (repo or directory link);
 *   - webUrl: any other http(s) URL;
 *   - localPath: absolute / home / dot-relative / Windows-drive / UNC paths;
 *   - command: a leading executable word followed by arguments (npx skills add …);
 *   - reference: anything else (marketplace reference, bare skill name).
 */
export function classifyImportSource(input: string): ImportSourceKind {
  const s = input.trim();
  if (/^git@[\w.-]+:/.test(s) || /\.git$/i.test(s)) return "repoUrl";
  if (/^https?:\/\//i.test(s)) {
    try {
      if (REPO_HOSTS.test(new URL(s).hostname)) return "repoUrl";
    } catch {
      // Malformed URL-ish input: keep the generic web page treatment.
    }
    return "webUrl";
  }
  if (/^(\/|~\/|\.{1,2}\/|[A-Za-z]:[\\/]|\\\\)/.test(s)) return "localPath";
  if (/^[A-Za-z@][\w@./-]*\s+\S/.test(s)) return "command";
  return "reference";
}

/**
 * Localized install prompt for one source: the per-kind lead sentence plus the shared
 * security/skill-porting tail on a second line. Reads S at call time (live binding), so
 * it follows language switches like every other string consumer.
 */
export function buildImportPrompt(input: string): string {
  return `${S.skills.importPromptLead[classifyImportSource(input)](input)}\n${S.skills.importPromptTail}`;
}
