/**
 * AgentPackageService: an Agent's definition in and out of a GitHub gist.
 *
 * Packing walks the Agent directory and keeps what format.ts calls definition — never the
 * vault, the memory, the workspaces, a workflow's state.json or the history. Publishing
 * PUTs those files into a gist (created once, updated in place afterwards, so a published
 * Agent keeps its URL). Installing reads a gist, validates every path against the same
 * rules, creates the Agent through the normal lifecycle, and only then writes the files —
 * so a package can never reach outside the Agent it is installing.
 *
 * The token is a server-global setting (`github_token`): this harness publishes as one
 * GitHub identity, the same trade-off the messaging connectors' credentials already make.
 * Reading a public gist needs no token at all, so installing works with none configured.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { agentDir, VERSION } from "@prismshadow/penguin-core";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import { HttpError } from "../http/errors.js";
import type { Clock, Log, Paths } from "../hmr/capabilities.js";
import type { AgentConfig, AgentLifecycle } from "../mechanisms/agents.js";
import type {
  AgentPackage,
  AgentPackages,
  PackageFile,
  PackagePreview,
  PublishedGist,
  PublishMethod,
} from "../mechanisms/packages.js";
import type { Settings } from "../mechanisms/settings.js";
import type { HttpFetch } from "../services/update-check-service.js";
import {
  encodingFor,
  flattenPath,
  gistDescription,
  gistFilesOf,
  gistIdOf,
  isPackagedPath,
  isRoundTrippable,
  isSafePackagePath,
  manifestOf,
  MAX_PACKAGE_BYTES,
  packageDigest,
  PackageFormatError,
  packageFromTree,
  parsePackage,
} from "./format.js";
import { fetchSource, parseSource, type SourceKind } from "./sources.js";
import { GhCli, GhError } from "./gh.js";

/** Server setting holding the GitHub token used to publish (never returned to a client). */
export const GITHUB_TOKEN_KEY = "github_token";

const GIST_HOST = "https://api.github.com";
const GIST_API = `${GIST_HOST}/gists`;
const GITHUB_HEADERS = {
  accept: "application/vnd.github+json",
  "user-agent": "penguin-server",
  "x-github-api-version": "2022-11-28",
};

interface GistResponse {
  id?: unknown;
  html_url?: unknown;
  files?: Record<string, { content?: unknown; truncated?: unknown }>;
}

@Component()
export class AgentPackageService implements AgentPackages {
  @Use() private readonly paths!: Paths;
  @Use() private readonly clock!: Clock;
  @Use() private readonly log!: Log;
  @Use() private readonly http!: HttpFetch;
  @Use() private readonly settings!: Settings;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly agents!: AgentLifecycle;
  @Use() private readonly gh!: GhCli;

  /**
   * The machine's own `gh` login wins over a stored token: it is the credential the user
   * already manages, the harness never copies it, and `gh auth logout` revokes it.
   */
  async publishMethod(): Promise<PublishMethod> {
    if (await this.gh.available()) return "gh";
    return this.token() === null ? null : "token";
  }

  async publishedGist(projectId: string, agentId: string): Promise<PublishedGist | null> {
    try {
      const raw = await fs.readFile(this.publishRecordPath(projectId, agentId), "utf8");
      const parsed = JSON.parse(raw) as Partial<PublishedGist>;
      if (typeof parsed.gistId !== "string" || parsed.gistId === "") return null;
      return {
        gistId: parsed.gistId,
        url:
          typeof parsed.url === "string" ? parsed.url : `https://gist.github.com/${parsed.gistId}`,
        publishedAt: typeof parsed.publishedAt === "string" ? parsed.publishedAt : "",
        ...(typeof parsed.digest === "string" ? { digest: parsed.digest } : {}),
      };
    } catch {
      return null;
    }
  }

  async pack(projectId: string, agentId: string): Promise<AgentPackage> {
    const dir = agentDir(this.paths.root, projectId, agentId);
    const files: PackageFile[] = [];
    let bytes = 0;
    for (const rel of await walk(dir)) {
      if (!isPackagedPath(rel)) continue;
      if (!isRoundTrippable(rel)) {
        // A path that cannot round-trip through a flat gist name would come back as a
        // different file; refusing beats publishing something that installs wrong.
        throw new HttpError(
          400,
          "unpackageable_path",
          `'${rel}' cannot be packaged: a file name may not contain a backslash.`,
        );
      }
      const content = await fs.readFile(path.join(dir, rel));
      const encoding = encodingFor(content);
      const text = encoding === "utf8" ? content.toString("utf8") : content.toString("base64");
      bytes += Buffer.byteLength(text, "utf8");
      if (bytes > MAX_PACKAGE_BYTES) {
        throw new HttpError(
          400,
          "package_too_large",
          `This Agent's definition exceeds the ${MAX_PACKAGE_BYTES / 1024 / 1024}MB package limit.`,
        );
      }
      files.push({ path: rel, file: flattenPath(rel), encoding, content: text });
    }
    if (files.length === 0) {
      throw new HttpError(404, "not_found", "Resource does not exist or you do not have access.");
    }
    const meta = await this.agentConfig.readCardMeta(projectId, agentId);
    const manifest = manifestOf(
      agentId,
      meta.name ?? agentId,
      meta.description ?? "",
      VERSION,
      this.clock.now().toISOString(),
      files,
    );
    return { manifest, files, bytes };
  }

  async publish(
    projectId: string,
    agentId: string,
    options: { gistId?: string; public: boolean },
  ): Promise<{ gistId: string; url: string; files: number; bytes: number; unchanged: boolean }> {
    const method = await this.publishMethod();
    if (method === null) {
      throw new HttpError(
        400,
        "github_auth_missing",
        "Publishing needs a GitHub identity: log in with the `gh` CLI on the server (`gh auth login`, scope `gist`), or store a token in server settings.",
      );
    }
    const pkg = await this.pack(projectId, agentId);
    // The same Agent updates the same gist: the caller may name one, otherwise the record
    // kept beside the Agent decides, and only a first publish creates.
    const remembered = (await this.publishedGist(projectId, agentId))?.gistId ?? null;
    let existing: string | null = null;
    if (options.gistId !== undefined && options.gistId !== "") {
      try {
        existing = gistIdOf(options.gistId);
      } catch (err) {
        throw new HttpError(400, "invalid_gist", (err as Error).message);
      }
    } else {
      existing = remembered;
    }
    const description = gistDescription(pkg.manifest);
    const digest = packageDigest(description, pkg.files);
    const record = await this.publishedGist(projectId, agentId);
    const unchangedResult = {
      gistId: existing ?? "",
      url: record?.url ?? "",
      files: pkg.files.length,
      bytes: pkg.bytes,
      unchanged: true,
    };
    // Nothing to say: the gist this Agent published to already holds exactly this content,
    // by the digest recorded with it. No request is made at all. Naming a target explicitly
    // skips this — that is how a gist edited or deleted on GitHub is published over.
    const named = options.gistId !== undefined && options.gistId !== "";
    if (!named && existing !== null && existing === record?.gistId && record.digest === digest) {
      return { ...unchangedResult, url: record.url };
    }

    const files: Record<string, { content: string } | null> = gistFilesOf(pkg.manifest, pkg.files);
    let live: GistResponse | null = null;
    if (existing !== null) {
      // A gist update only adds and overwrites: a file the package no longer has (renamed,
      // deleted, or named by an older separator) stays until it is explicitly nulled out.
      // Without this a published Agent accumulates every file it ever had.
      live = await this.fetchGist(existing).catch(() => null);
      for (const name of Object.keys(live?.files ?? {})) if (!(name in files)) files[name] = null;
      // The record may be missing or stale (a first publish after an upgrade, another
      // machine's publish): compare the gist's own content before spending a write.
      if (live !== null && sameContent(live, files) && liveDescription(live) === description) {
        const url = typeof live.html_url === "string" ? live.html_url : (record?.url ?? "");
        await this.rememberGist(projectId, agentId, {
          gistId: existing,
          url,
          publishedAt: record?.publishedAt ?? this.clock.now().toISOString(),
          digest,
        });
        return { ...unchangedResult, gistId: existing, url };
      }
    }
    const body: Record<string, unknown> = { description, files };
    const send = async (target: string | null): Promise<GistResponse> => {
      // `public` is honoured only on creation — GitHub ignores it on an update, and a
      // gist's visibility cannot be changed after the fact.
      const payload = target === null ? { ...body, public: options.public } : body;
      const apiPath = target === null ? "/gists" : `/gists/${target}`;
      if (method === "gh") {
        try {
          return (await this.gh.api(apiPath, "POST", payload)) as GistResponse;
        } catch (err) {
          if (err instanceof GhError) {
            const gone = /not found|404/i.test(err.message);
            throw new HttpError(
              gone ? 404 : 400,
              gone ? "not_found" : "github_rejected",
              `gh: ${err.message}`,
            );
          }
          throw err;
        }
      }
      const res = await this.github(
        `${GIST_HOST}${apiPath}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
        this.token(),
      );
      return (await res.json()) as GistResponse;
    };

    let gist: GistResponse;
    try {
      gist = await send(existing);
    } catch (err) {
      // The remembered gist may have been deleted on GitHub since. Only what the server
      // remembered is retried as a new gist — a target the caller named is theirs to fix.
      const gone = err instanceof HttpError && err.status === 404;
      if (!gone || existing === null || remembered !== existing) throw err;
      this.log.line(
        `[packages] ${projectId}/${agentId}: gist ${existing} is gone, creating a new one`,
      );
      gist = await send(null);
    }
    const id = typeof gist.id === "string" ? gist.id : null;
    const url = typeof gist.html_url === "string" ? gist.html_url : null;
    if (id === null || url === null) {
      throw new HttpError(502, "github_bad_response", "GitHub returned an unexpected gist.");
    }
    await this.rememberGist(projectId, agentId, {
      gistId: id,
      url,
      publishedAt: this.clock.now().toISOString(),
      digest,
    });
    this.log.line(`[packages] published ${projectId}/${agentId} to ${url} (via ${method})`);
    return { gistId: id, url, files: pkg.files.length, bytes: pkg.bytes, unchanged: false };
  }

  async preview(source: string, kind?: string): Promise<PackagePreview> {
    const read = await this.read(source, kind);
    return {
      manifest: read.parsed.manifest,
      bytes: read.parsed.bytes,
      source: read.origin,
      kind: read.kind,
      suggestedId: read.suggestedId,
    };
  }

  async install(
    projectId: string,
    source: string,
    agentId: string,
    kind?: string,
  ): Promise<{ agentId: string }> {
    const { parsed } = await this.read(source, kind);
    await this.agents.createAgent(
      projectId,
      agentId,
      parsed.manifest.name,
      parsed.manifest.description,
    );
    const dir = agentDir(this.paths.root, projectId, agentId);
    try {
      for (const file of parsed.files) {
        // Checked once more at the write, not only at the parse: this is the step that
        // touches the disk, and it is the only place that must be right.
        if (!isSafePackagePath(file.path)) {
          throw new PackageFormatError(
            `Package refused: '${file.path}' is not a packageable path.`,
          );
        }
        const target = path.join(dir, file.path);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, Buffer.from(file.content, file.encoding));
      }
    } catch (err) {
      // A half-written Agent is worse than none: undo the creation and report the failure.
      await this.agents.deleteAgent(projectId, agentId).catch(() => undefined);
      throw err instanceof PackageFormatError
        ? new HttpError(400, "invalid_package", err.message)
        : err;
    }
    return { agentId };
  }

  // ---- internals ------------------------------------------------------------------

  /**
   * Where an Agent's published gist is remembered: a dotfile inside the Agent directory, so
   * it travels with the Agent on disk, is never packaged (dotfiles are excluded), and makes
   * a republish from any browser or machine update the same gist instead of making another.
   */
  private publishRecordPath(projectId: string, agentId: string): string {
    return path.join(agentDir(this.paths.root, projectId, agentId), ".penguin-publish.json");
  }

  private async rememberGist(
    projectId: string,
    agentId: string,
    record: PublishedGist,
  ): Promise<void> {
    try {
      await fs.writeFile(
        this.publishRecordPath(projectId, agentId),
        `${JSON.stringify(record, null, 2)}\n`,
      );
    } catch {
      // A convenience: the publish already happened, and the response carries the gist.
    }
  }

  /**
   * One gist, read with whatever identity there is: a stored token reads directly, else gh
   * reads (which reaches a private gist too), and with neither the anonymous read still
   * serves any public gist.
   */
  private async fetchGist(id: string): Promise<GistResponse> {
    if (this.token() === null && (await this.gh.available())) {
      try {
        return (await this.gh.api(`/gists/${id}`, "GET")) as GistResponse;
      } catch (err) {
        throw err instanceof GhError ? new HttpError(404, "not_found", `gh: ${err.message}`) : err;
      }
    }
    const res = await this.github(`${GIST_API}/${id}`, { method: "GET" }, this.token());
    return (await res.json()) as GistResponse;
  }

  private token(): string | null {
    const raw = this.settings.get(GITHUB_TOKEN_KEY);
    if (raw === null) return null;
    // Stored JSON-encoded, like every other server setting.
    try {
      const value = JSON.parse(raw) as unknown;
      return typeof value === "string" && value !== "" ? value : null;
    } catch {
      return null;
    }
  }

  /**
   * Reads any source into a validated package. A gist is a flat set of text files and is
   * read here; every other kind is fetched as a tree (sources.ts) and read by format.ts —
   * with its manifest when it has one, as a bare Agent directory when it does not.
   */
  private async read(
    spec: string,
    kind?: string,
  ): Promise<{
    parsed: ReturnType<typeof parsePackage>;
    origin: string;
    kind: SourceKind;
    suggestedId: string;
  }> {
    let source;
    try {
      source = parseSource(spec, kind === undefined ? undefined : (kind as SourceKind));
    } catch (err) {
      throw new HttpError(400, "invalid_source", (err as Error).message);
    }
    if (source.kind !== "gist") {
      const tree = await fetchSource(source, {
        fetch: (input, init) => this.http.fetch(input, init),
        githubToken: this.token(),
      });
      try {
        const parsed = packageFromTree(tree.files, {
          agentId: tree.suggestedId,
          name: tree.suggestedId,
          packagedBy: "unknown",
        });
        return {
          parsed,
          origin: tree.origin,
          kind: source.kind,
          suggestedId: tree.files.has("penguin-agent.json")
            ? parsed.manifest.agentId
            : tree.suggestedId,
        };
      } catch (err) {
        if (err instanceof PackageFormatError) {
          throw new HttpError(400, "invalid_package", err.message);
        }
        throw err;
      }
    }
    const id = source.id;
    const body = await this.fetchGist(id);
    const files = body.files;
    if (files === undefined || files === null || typeof files !== "object") {
      throw new HttpError(502, "github_bad_response", "GitHub returned an unexpected gist.");
    }
    try {
      const parsed = parsePackage(
        Object.fromEntries(
          Object.entries(files).map(([name, f]) => [
            name,
            {
              content: typeof f?.content === "string" ? f.content : undefined,
              truncated: f?.truncated === true,
            },
          ]),
        ),
      );
      const url =
        typeof body.html_url === "string" ? body.html_url : `https://gist.github.com/${id}`;
      return { parsed, origin: url, kind: "gist", suggestedId: parsed.manifest.agentId };
    } catch (err) {
      if (err instanceof PackageFormatError)
        throw new HttpError(400, "invalid_package", err.message);
      throw err;
    }
  }

  /** One GitHub call, with its failures translated into statuses a user can act on. */
  private async github(url: string, init: RequestInit, token: string | null): Promise<Response> {
    let res: Response;
    try {
      res = await this.http.fetch(url, {
        ...init,
        headers: {
          ...GITHUB_HEADERS,
          ...(init.headers as Record<string, string> | undefined),
          ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new HttpError(502, "github_unreachable", "GitHub could not be reached.");
    }
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(
        400,
        "github_rejected",
        "GitHub rejected the request: the token is missing, expired, or lacks the `gist` scope.",
      );
    }
    if (res.status === 404) throw new HttpError(404, "not_found", "No such gist.");
    if (!res.ok) {
      throw new HttpError(502, "github_bad_response", `GitHub answered ${res.status}.`);
    }
    return res;
  }
}

/** A gist's description as GitHub returned it. */
function liveDescription(gist: GistResponse): string {
  return typeof (gist as { description?: unknown }).description === "string"
    ? (gist as { description: string }).description
    : "";
}

/** Whether a gist already holds exactly these files, with exactly this content. */
function sameContent(
  gist: GistResponse,
  files: Record<string, { content: string } | null>,
): boolean {
  const live = gist.files ?? {};
  const wanted = Object.entries(files).filter(([, v]) => v !== null) as Array<
    [string, { content: string }]
  >;
  if (Object.keys(live).length !== wanted.length) return false;
  for (const [name, value] of wanted) {
    const found = live[name];
    if (found === undefined || found.truncated === true) return false;
    if (typeof found.content !== "string" || found.content !== value.content) return false;
  }
  return true;
}

/** Every file under `dir`, as posix-relative paths. */
async function walk(dir: string, prefix = ""): Promise<string[]> {
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}
