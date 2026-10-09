/**
 * What an admin may ask the server to `npm install` as a plugin: a package from the registry by
 * name, or a link npm fetches itself — a git repository or a tarball, over https.
 *
 * Narrower than what npm accepts, on purpose: no local paths or `file:` (the server's own disk
 * is not a plugin source), no plain `http:`, `git:` or ssh (a fetch nobody can verify, or
 * credentials the server would need), no credentials inside a link (npm would write them into
 * the prefix's package.json), and no `npm:` / `file:` aliases behind a name. The string reaches
 * npm as one argument after `--`, never through a shell.
 */

/** A registry package by name, optionally `@<version, range or tag>`. */
const NAME =
  /^((?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*)(?:@([A-Za-z0-9._^~<>=|*+-]+))?$/;

/** `github:<owner>/<repo>[#<ref>]`, npm's shorthand for a GitHub repository. */
const GITHUB_SHORTHAND = /^github:[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:#[A-Za-z0-9._/-]+)?$/;

/** Longer than any real link; a cap so a pasted page cannot become an npm argument. */
const MAX_LINK_LENGTH = 2048;

export type PluginSource =
  { kind: "name"; spec: string; name: string; version?: string } | { kind: "link"; spec: string };

/** Why `value` cannot be installed, as one sentence; null when it can. */
function linkFault(value: string): string | null {
  if (value.length > MAX_LINK_LENGTH) return `a link longer than ${MAX_LINK_LENGTH} characters`;
  if (GITHUB_SHORTHAND.test(value)) return null;
  const bare = value.startsWith("git+") ? value.slice("git+".length) : value;
  let url: URL;
  try {
    url = new URL(bare);
  } catch {
    return "neither an npm package name nor a link";
  }
  if (url.protocol !== "https:") {
    return `a ${url.protocol.replace(/:$/, "")} link — only https links are installed`;
  }
  if (url.username !== "" || url.password !== "") {
    return "a link with credentials in it — npm would record them in the server's files";
  }
  return null;
}

/**
 * Reads what was asked: a package name (`@scope/name`, `name@1.2.3`, `name@^1`, `name@latest`)
 * or a link (`https://github.com/o/r`, `git+https://…/r.git`, `github:o/r#tag`, an https
 * tarball). Throws an Error saying what is wrong otherwise.
 */
export function parsePluginSource(value: unknown): PluginSource {
  const spec = typeof value === "string" ? value.trim() : "";
  if (spec === "" || /[\s\u0000-\u001f\u007f]/.test(spec)) {
    throw new Error("Give an npm package name or an https link to the package.");
  }
  const named = NAME.exec(spec);
  if (named !== null) {
    return {
      kind: "name",
      spec,
      name: named[1]!,
      ...(named[2] !== undefined ? { version: named[2] } : {}),
    };
  }
  const fault = linkFault(spec);
  if (fault !== null) throw new Error(`Cannot install ${JSON.stringify(spec)}: ${fault}.`);
  return { kind: "link", spec };
}
