/**
 * Where an Agent package can come from, besides a gist — and how each source becomes the
 * one shape the installer reads: a tree of files (path → bytes).
 *
 *   npm             `npm:<name>[@<version>]`              the registry's tarball
 *   github-release  `https://github.com/o/r/releases[/tag/<tag>|/latest]`, `github-release:o/r[#tag]`
 *                   a `.tgz`/`.tar.gz` asset when the release has one, else its source tarball
 *   github          `https://github.com/o/r[/tree/<ref>]`, `github:o/r[#ref]`
 *                   the repository tarball at <ref> (the default branch when none)
 *   git             `git+<url>`, `git@host:path`, `ssh://…`, anything ending in `.git`
 *                   a shallow clone (needs a `git` binary on the server)
 *   url             any other `http(s)://…`                 a tarball
 *   gist            handled by service.ts (a flat set of text files, not a tree)
 *
 * Every tarball route ends in the same place: extracted into a temporary directory, the
 * single top-level folder tarballs conventionally carry (`package/`, `owner-repo-sha/`)
 * stripped, and read back as paths. The tree itself is checked later by format.ts — this
 * file only fetches.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as tar from "tar";
import { HttpError } from "../http/errors.js";
import { gistIdOf, MAX_PACKAGE_BYTES, PackageFormatError } from "./format.js";

const execFileAsync = promisify(execFile);

export type SourceKind = "gist" | "npm" | "github-release" | "github" | "git" | "url";

export type Source =
  | { kind: "gist"; id: string }
  | { kind: "npm"; name: string; version: string | null }
  | { kind: "github-release"; owner: string; repo: string; tag: string | null }
  | { kind: "github"; owner: string; repo: string; ref: string | null }
  | { kind: "git"; url: string; ref: string | null }
  | { kind: "url"; url: string };

/** What a fetch yields: the files, and a name for the display line and the id suggestion. */
export interface FetchedTree {
  files: Map<string, Buffer>;
  /** Human-readable origin, e.g. `npm:foo@1.2.0`, `github:o/r@main`. */
  origin: string;
  /** An Agent id suggestion when the package carries no manifest (the repo or package name). */
  suggestedId: string;
}

/** Files per tree (a repository is not a package because it has an agent_state/ somewhere). */
const MAX_FILES = 2000;
const FETCH_TIMEOUT_MS = 60_000;
const GITHUB_HEADERS = {
  accept: "application/vnd.github+json",
  "user-agent": "penguin-server",
  "x-github-api-version": "2022-11-28",
};

/**
 * `kind` forces one reading; without it the spec's shape decides. A bare word that is not
 * a URL is tried as a gist id (hex) and then rejected — there is no guessing between npm
 * and GitHub for a plain name, the user says which with a prefix.
 */
export function parseSource(spec: string, kind?: SourceKind): Source {
  const s = spec.trim();
  if (s === "") throw new PackageFormatError("Source is empty.");

  const asNpm = (): Source => {
    const body = s.replace(/^npm:/, "");
    const at = body.lastIndexOf("@");
    const name = at > 0 ? body.slice(0, at) : body;
    const version = at > 0 ? body.slice(at + 1) : null;
    if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name)) {
      throw new PackageFormatError(`"${body}" is not an npm package name.`);
    }
    return { kind: "npm", name, version: version === "" ? null : version };
  };
  const asGithubUrl = (): Source | null => {
    const m =
      /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/(.*))?$/.exec(s);
    if (!m) return null;
    const [, owner, repo, rest = ""] = m;
    const release = /^releases(?:\/latest)?\/?$/.exec(rest);
    if (release) return { kind: "github-release", owner: owner!, repo: repo!, tag: null };
    const tagged = /^releases\/tag\/([^/]+)\/?$/.exec(rest);
    if (tagged) return { kind: "github-release", owner: owner!, repo: repo!, tag: tagged[1]! };
    const tree = /^(?:tree|commits?)\/([^/]+)/.exec(rest);
    if (tree) return { kind: "github", owner: owner!, repo: repo!, ref: tree[1]! };
    if (rest !== "" && !/^\/?$/.test(rest)) {
      throw new PackageFormatError(
        `"${s}" points inside a repository; give the repository, a /tree/<ref>, or a release.`,
      );
    }
    return { kind: "github", owner: owner!, repo: repo!, ref: null };
  };
  const ownerRepo = (body: string): { owner: string; repo: string; ref: string | null } => {
    const m = /^([^/#\s]+)\/([^/#\s]+)(?:#(.+))?$/.exec(body);
    if (!m) throw new PackageFormatError(`"${body}" is not <owner>/<repo>[#ref].`);
    return { owner: m[1]!, repo: m[2]!.replace(/\.git$/, ""), ref: m[3] ?? null };
  };
  const asGit = (): Source => {
    const body = s.replace(/^git\+/, "");
    const hash = body.lastIndexOf("#");
    const url = hash > 0 ? body.slice(0, hash) : body;
    const ref = hash > 0 ? body.slice(hash + 1) : null;
    if (!/^(https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/|[\w.-]+@[\w.-]+:)/.test(url)) {
      throw new PackageFormatError(`"${url}" is not a git URL.`);
    }
    return { kind: "git", url, ref: ref === "" ? null : ref };
  };

  switch (kind) {
    case "gist":
      return { kind: "gist", id: gistIdOf(s) };
    case "npm":
      return asNpm();
    case "github-release": {
      const fromUrl = asGithubUrl();
      if (fromUrl?.kind === "github-release") return fromUrl;
      const { owner, repo, ref } = ownerRepo(
        s.replace(/^github-release:/, "").replace(/^github:/, ""),
      );
      return { kind: "github-release", owner, repo, tag: ref };
    }
    case "github": {
      const fromUrl = asGithubUrl();
      if (fromUrl?.kind === "github") return fromUrl;
      const { owner, repo, ref } = ownerRepo(s.replace(/^github:/, ""));
      return { kind: "github", owner, repo, ref };
    }
    case "git":
      return asGit();
    case "url":
      if (!/^https?:\/\//.test(s)) throw new PackageFormatError(`"${s}" is not an http(s) URL.`);
      return { kind: "url", url: s };
    case undefined:
      break;
  }

  // Detection by shape.
  if (s.startsWith("npm:")) return asNpm();
  if (s.startsWith("github-release:")) {
    const { owner, repo, ref } = ownerRepo(s.slice("github-release:".length));
    return { kind: "github-release", owner, repo, tag: ref };
  }
  if (s.startsWith("github:")) {
    const { owner, repo, ref } = ownerRepo(s.slice("github:".length));
    return { kind: "github", owner, repo, ref };
  }
  if (
    s.startsWith("git+") ||
    s.startsWith("git@") ||
    s.startsWith("ssh://") ||
    s.startsWith("git://") ||
    /\.git(#.*)?$/.test(s)
  ) {
    return asGit();
  }
  if (/gist\.github\.com\//.test(s)) return { kind: "gist", id: gistIdOf(s) };
  const gh = asGithubUrl();
  if (gh) return gh;
  if (/^https?:\/\//.test(s)) return { kind: "url", url: s };
  if (/^[0-9a-f]{5,64}$/i.test(s)) return { kind: "gist", id: s };
  throw new PackageFormatError(
    `"${s}" is not a source I know: a gist link or id, npm:<name>, github:<owner>/<repo>[#ref], a GitHub repository or release URL, a git URL, or an http(s) URL of a tarball.`,
  );
}

export function describeSource(src: Source): string {
  switch (src.kind) {
    case "gist":
      return `gist:${src.id}`;
    case "npm":
      return `npm:${src.name}${src.version === null ? "" : `@${src.version}`}`;
    case "github-release":
      return `github-release:${src.owner}/${src.repo}${src.tag === null ? "" : `#${src.tag}`}`;
    case "github":
      return `github:${src.owner}/${src.repo}${src.ref === null ? "" : `#${src.ref}`}`;
    case "git":
      return `git:${src.url}${src.ref === null ? "" : `#${src.ref}`}`;
    case "url":
      return src.url;
  }
}

export interface FetchDeps {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  /** GitHub token when configured: raises the API rate limit and reaches private repos. */
  githubToken: string | null;
}

/** Fetches a non-gist source into a tree. */
export async function fetchSource(src: Source, deps: FetchDeps): Promise<FetchedTree> {
  switch (src.kind) {
    case "gist":
      throw new Error("gist sources are read by the service, not fetched as a tree");
    case "npm":
      return fetchNpm(src, deps);
    case "github-release":
      return fetchGithubRelease(src, deps);
    case "github":
      return fetchGithub(src, deps);
    case "git":
      return cloneGit(src);
    case "url": {
      const bytes = await download(src.url, deps, {});
      return { files: await untar(bytes), origin: src.url, suggestedId: idFromUrl(src.url) };
    }
  }
}

async function fetchNpm(
  src: Extract<Source, { kind: "npm" }>,
  deps: FetchDeps,
): Promise<FetchedTree> {
  const meta = await json<{
    "dist-tags"?: Record<string, string>;
    versions?: Record<string, { dist?: { tarball?: string } }>;
  }>(
    `https://registry.npmjs.org/${encodeURIComponent(src.name).replace("%40", "@")}`,
    deps,
    {},
    "npm",
  );
  const version = src.version ?? meta["dist-tags"]?.["latest"] ?? null;
  const tarball = version === null ? undefined : meta.versions?.[version]?.dist?.tarball;
  if (version === null || tarball === undefined) {
    throw new HttpError(
      404,
      "not_found",
      `npm has no ${src.name}${src.version === null ? "" : `@${src.version}`}.`,
    );
  }
  const bytes = await download(tarball, deps, {});
  return {
    files: await untar(bytes),
    origin: `npm:${src.name}@${version}`,
    suggestedId: src.name.replace(/^@[^/]+\//, ""),
  };
}

async function fetchGithubRelease(
  src: Extract<Source, { kind: "github-release" }>,
  deps: FetchDeps,
): Promise<FetchedTree> {
  const base = `https://api.github.com/repos/${src.owner}/${src.repo}/releases`;
  const release = await json<{
    tag_name?: string;
    tarball_url?: string;
    assets?: Array<{ name?: string; browser_download_url?: string }>;
  }>(
    src.tag === null ? `${base}/latest` : `${base}/tags/${encodeURIComponent(src.tag)}`,
    deps,
    githubHeaders(deps),
    "GitHub",
  );
  const asset = release.assets?.find((a) => /\.(tgz|tar\.gz)$/i.test(a.name ?? ""));
  const url = asset?.browser_download_url ?? release.tarball_url;
  if (url === undefined) throw new HttpError(404, "not_found", "The release has no tarball.");
  const bytes = await download(url, deps, githubHeaders(deps));
  return {
    files: await untar(bytes),
    origin: `github-release:${src.owner}/${src.repo}#${release.tag_name ?? src.tag ?? "latest"}`,
    suggestedId: src.repo,
  };
}

async function fetchGithub(
  src: Extract<Source, { kind: "github" }>,
  deps: FetchDeps,
): Promise<FetchedTree> {
  const ref = src.ref === null ? "" : `/${encodeURIComponent(src.ref)}`;
  const bytes = await download(
    `https://api.github.com/repos/${src.owner}/${src.repo}/tarball${ref}`,
    deps,
    githubHeaders(deps),
  );
  return {
    files: await untar(bytes),
    origin: `github:${src.owner}/${src.repo}${src.ref === null ? "" : `#${src.ref}`}`,
    suggestedId: src.repo,
  };
}

/** A shallow clone into a temporary directory, read as a tree, then removed. */
async function cloneGit(src: Extract<Source, { kind: "git" }>): Promise<FetchedTree> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-git-"));
  try {
    const args = ["clone", "--depth", "1", "--quiet"];
    if (src.ref !== null) args.push("--branch", src.ref);
    args.push("--", src.url, tmp);
    try {
      await execFileAsync("git", args, {
        timeout: FETCH_TIMEOUT_MS,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        maxBuffer: 1024 * 1024,
      });
    } catch (err) {
      const detail = (err as { stderr?: string }).stderr?.trim().split("\n").at(-1) ?? String(err);
      throw new HttpError(400, "git_clone_failed", `git clone failed: ${detail}`);
    }
    await fs.rm(path.join(tmp, ".git"), { recursive: true, force: true });
    return {
      files: await readTree(tmp),
      origin: `git:${src.url}${src.ref === null ? "" : `#${src.ref}`}`,
      suggestedId: idFromUrl(src.url),
    };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

// ---- helpers ----------------------------------------------------------------------

function githubHeaders(deps: FetchDeps): Record<string, string> {
  return {
    ...GITHUB_HEADERS,
    ...(deps.githubToken === null ? {} : { authorization: `Bearer ${deps.githubToken}` }),
  };
}

async function json<T>(
  url: string,
  deps: FetchDeps,
  headers: Record<string, string>,
  who: string,
): Promise<T> {
  let res: Response;
  try {
    res = await deps.fetch(url, {
      headers: { accept: "application/json", "user-agent": "penguin-server", ...headers },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(502, "source_unreachable", `${who} could not be reached.`);
  }
  if (res.status === 404) throw new HttpError(404, "not_found", `${who}: not found.`);
  if (!res.ok) throw new HttpError(502, "source_bad_response", `${who} answered ${res.status}.`);
  return (await res.json()) as T;
}

async function download(
  url: string,
  deps: FetchDeps,
  headers: Record<string, string>,
): Promise<Buffer> {
  let res: Response;
  try {
    res = await deps.fetch(url, {
      headers: { "user-agent": "penguin-server", ...headers },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(502, "source_unreachable", `${url} could not be reached.`);
  }
  if (res.status === 404) throw new HttpError(404, "not_found", `${url}: not found.`);
  if (!res.ok) throw new HttpError(502, "source_bad_response", `${url} answered ${res.status}.`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength > MAX_PACKAGE_BYTES * 4) {
    throw new HttpError(400, "package_too_large", "The download is larger than a package may be.");
  }
  return bytes;
}

/** gzip magic; a tarball that is not gzipped is accepted too (tar sniffs). */
function looksLikeTarball(bytes: Buffer): boolean {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return true;
  return bytes.length > 262 && bytes.subarray(257, 262).toString("ascii") === "ustar";
}

/** Extracts a tarball into a temporary directory and reads it as a tree; the temp dir is removed. */
async function untar(bytes: Buffer): Promise<Map<string, Buffer>> {
  if (!looksLikeTarball(bytes)) {
    throw new HttpError(400, "invalid_package", "The source is not a tarball (.tgz / .tar.gz).");
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-pkg-"));
  try {
    const file = path.join(tmp, "package.tgz");
    await fs.writeFile(file, bytes);
    const out = path.join(tmp, "tree");
    await fs.mkdir(out);
    try {
      await tar.x({ file, cwd: out, preservePaths: false, filter: (p) => !p.includes("..") });
    } catch {
      throw new HttpError(400, "invalid_package", "The tarball could not be extracted.");
    }
    return await readTree(out);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/**
 * A directory as a tree of paths. A single top-level folder is stripped (npm's `package/`,
 * GitHub's `owner-repo-sha/`), and `.git` / `node_modules` are never read.
 */
async function readTree(dir: string): Promise<Map<string, Buffer>> {
  let root = dir;
  const top = (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.name !== ".git");
  if (top.length === 1 && top[0]!.isDirectory()) root = path.join(root, top[0]!.name);
  const files = new Map<string, Buffer>();
  let bytes = 0;
  const walk = async (d: string, prefix: string) => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
      if (e.isDirectory()) await walk(path.join(d, e.name), rel);
      else if (e.isFile()) {
        if (files.size >= MAX_FILES) {
          throw new HttpError(
            400,
            "package_too_large",
            `The source has more than ${MAX_FILES} files.`,
          );
        }
        const content = await fs.readFile(path.join(d, e.name));
        bytes += content.byteLength;
        if (bytes > MAX_PACKAGE_BYTES * 4) {
          throw new HttpError(
            400,
            "package_too_large",
            "The source is larger than a package may be.",
          );
        }
        files.set(rel, content);
      }
    }
  };
  await walk(root, "");
  return files;
}

function idFromUrl(url: string): string {
  const last =
    url
      .replace(/[/#?]+$/, "")
      .split(/[/:]/)
      .at(-1) ?? "agent";
  return last.replace(/\.(git|tgz|tar\.gz|zip)$/i, "").replace(/[^A-Za-z0-9_-]+/g, "_") || "agent";
}
