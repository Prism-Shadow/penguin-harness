/**
 * Benchmark routes, Project-level because a Benchmark is a peer of an Agent rather than
 * something an Agent owns — which Agents it has evaluated comes from its scoreboard:
 *   GET /api/projects/:p/benchmarks (any member, read-only)
 *   POST /api/projects/:p/benchmarks (owner: create a Benchmark by hand)
 *   DELETE /api/projects/:p/benchmarks/:benchmarkId (owner: remove the directory whole)
 *   POST /api/projects/:p/benchmarks/archive (any member: import a package from a zip)
 *   GET /api/projects/:p/benchmarks/:benchmarkId/archive (any member: export the package)
 *   GET /api/projects/:p/benchmarks/:benchmarkId/cases
 *   GET /api/projects/:p/benchmarks/:benchmarkId/cases/:caseId/files
 *   GET /api/projects/:p/benchmarks/:benchmarkId/cases/:caseId/files/content
 *   GET /api/projects/:p/benchmarks/:benchmarkId/cases/:caseId/rubric/files
 *   GET /api/projects/:p/benchmarks/:benchmarkId/cases/:caseId/rubric/files/content
 * Returns the Project's Benchmark list (title, description, version and the rest from each
 * benchmark.json) along with the evaluations[] from scoreboard.yaml.
 */
import { Hono, type Context } from "hono";
import { isValidId } from "@prismshadow/penguin-core";
import type { AppEnv } from "../../auth/middleware.js";
import type {
  BenchmarkArchiveGitOrigin,
  BenchmarkArchiveImportResponse,
  BenchmarkCreateResponse,
  CaseMaterial,
} from "../../api/types.js";
import type { BenchmarkCaseInput } from "../../services/benchmark-service.js";
import { benchmarkTooLarge } from "../../services/benchmark-archive.js";
import { isHttpUrl } from "../../services/protocol-detect.js";
import { MAX_ARCHIVE_BYTES } from "../../services/skill-import-limits.js";
import type { Benchmarks } from "../../mechanisms/agents.js";
import type { Access } from "../../mechanisms/projects.js";
import {
  badRequest,
  optionalNumber,
  optionalString,
  readJson,
  requireString,
  requireValidId,
} from "../validate.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface BenchmarksRouteDeps {
  benchmarks: Benchmarks;
  access: Access;
}

const TEXT_PREVIEW_BYTES = 256 * 1024;

/** Case directories carry the `CASE-` prefix the reader lists by; the rest is the shared id alphabet. */
const CASE_ID_PATTERN = /^CASE-[A-Za-z0-9_-]+$/;
const MAX_CASES = 100;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2000;
/** Statement and rubric bodies: generous, but a hand-written case is a page, not a corpus. */
const MAX_BODY = 100_000;
/**
 * Runs per case. Every run is one evaluation of the Test Agent, so the count multiplies the cost
 * of each optimization round; the Web App's Optimize dialog refuses anything beyond this, which a
 * stored value has to stay within to remain usable.
 */
const MAX_RUNS = 1000;

/**
 * The longest `dataBase64` a zip within the 14MB cap encodes to. A longer one is refused before it
 * is decoded: the request body cap follows the admin's attachment budget, which can be far larger.
 */
const MAX_ARCHIVE_BASE64 = Math.ceil(MAX_ARCHIVE_BYTES / 3) * 4;

/** The only `ref` a git origin records: a commit, since a branch or a tag can move. */
const COMMIT = /^[0-9a-f]{40}$/;

/**
 * An import request's `origin`: absent, or the repository folder the package was fetched from
 * (`{kind: "git", url, ref, path}`) — an http(s) link, the 40-character commit it resolved to and
 * the folder inside the repository. The server never fetches or opens them: they go into the copy's
 * manifest, and the Benchmark's page links the url.
 */
function optionalGitOrigin(body: Record<string, unknown>): BenchmarkArchiveGitOrigin | undefined {
  const raw = body.origin;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) throw badRequest("origin must be an object.");
  const origin = raw as Record<string, unknown>;
  if (origin.kind !== "git") throw badRequest('origin.kind must be "git".');
  const url = requireString(origin, "url", { minLen: 1, maxLen: 2048, label: "origin.url" });
  if (!isHttpUrl(url)) throw badRequest("origin.url must be an http(s) link.");
  const ref = requireString(origin, "ref", { label: "origin.ref" });
  if (!COMMIT.test(ref)) throw badRequest("origin.ref must be a 40-character commit id.");
  const folder = requireString(origin, "path", { minLen: 1, maxLen: 1024, label: "origin.path" });
  return { kind: "git", url, ref, path: folder };
}

/** A required Markdown body: present, within the cap, and not blank. */
function requireText(obj: Record<string, unknown>, key: string, maxLen: number, label: string) {
  const v = requireString(obj, key, { maxLen, label });
  if (v.trim() === "") throw badRequest(`${label} must not be blank.`);
  return v;
}

/** The `cases` array of a create request: non-empty, capped, unique `CASE-…` ids, every text present. */
function requireCases(body: Record<string, unknown>): BenchmarkCaseInput[] {
  const raw = body.cases;
  if (!Array.isArray(raw) || raw.length === 0) throw badRequest("cases must be a non-empty array.");
  if (raw.length > MAX_CASES) throw badRequest(`cases must hold at most ${MAX_CASES} entries.`);
  const seen = new Set<string>();
  return raw.map((item, i) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw badRequest(`cases[${i}] must be an object.`);
    }
    const c = item as Record<string, unknown>;
    const id = requireString(c, "id", { maxLen: 100, label: `cases[${i}].id` });
    if (!CASE_ID_PATTERN.test(id)) {
      throw badRequest(
        `cases[${i}].id must start with "CASE-" and use only letters, digits, "_" and "-".`,
      );
    }
    if (seen.has(id)) throw badRequest(`cases[${i}].id is a duplicate: ${id}`);
    seen.add(id);
    return {
      id,
      title: requireText(c, "title", MAX_TITLE, `cases[${i}].title`),
      statement: requireText(c, "statement", MAX_BODY, `cases[${i}].statement`),
      rubric: requireText(c, "rubric", MAX_BODY, `cases[${i}].rubric`),
    };
  });
}

function listCaseFiles(deps: BenchmarksRouteDeps, material: CaseMaterial) {
  return async (c: Context<AppEnv>) => {
    const projectId = requireValidId(c, "projectId");
    const benchmarkId = requireValidId(c, "benchmarkId");
    const caseId = requireValidId(c, "caseId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    return c.json(
      await deps.benchmarks.listCaseFiles(
        projectId,
        benchmarkId,
        caseId,
        c.req.query("path") ?? "",
        material,
      ),
    );
  };
}

function readCaseFile(deps: BenchmarksRouteDeps, material: CaseMaterial) {
  return async (c: Context<AppEnv>) => {
    const projectId = requireValidId(c, "projectId");
    const benchmarkId = requireValidId(c, "benchmarkId");
    const caseId = requireValidId(c, "caseId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const download = c.req.query("download") === "1";
    const boundedPreview = !download && c.req.query("preview") === "1";
    const { data, fileName, contentType, scriptable, truncated } =
      await deps.benchmarks.readCaseFile(
        projectId,
        benchmarkId,
        caseId,
        c.req.query("path") ?? "",
        material,
        boundedPreview ? { maxBytes: TEXT_PREVIEW_BYTES } : undefined,
      );
    // Case material is browsed the same way a Workspace is, and gets the same inline
    // hardening (see the session file-content route for the reasoning behind each branch).
    const inertSvg = !download && scriptable === "svg";
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type":
          !download && scriptable === "html" ? "text/plain; charset=utf-8" : contentType,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Content-Type-Options": "nosniff",
        ...(inertSvg ? { "Content-Security-Policy": "sandbox" } : {}),
        ...(truncated ? { "X-Content-Truncated": "1" } : {}),
      },
    });
  };
}

export function benchmarksRoutes(deps: BenchmarksRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    return c.json(await deps.benchmarks.list(projectId));
  });

  app.post("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    // Writing into the Project's benchmarks directory is Project management: owner only, like
    // schedules and imports.
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const body = await readJson(c);
    const id = requireString(body, "id", { minLen: 1, maxLen: 100 });
    if (!isValidId(id)) throw badRequest('id may only contain letters, digits, "_" and "-".');
    const title = requireText(body, "title", MAX_TITLE, "title");
    const description = optionalString(body, "description", { maxLen: MAX_DESCRIPTION });
    const runs = optionalNumber(body, "runs", { integer: true }) ?? 1;
    if (runs < 1 || runs > MAX_RUNS) {
      throw badRequest(`runs must be an integer between 1 and ${MAX_RUNS}.`);
    }
    const cases = requireCases(body);
    const benchmark = await deps.benchmarks.create(projectId, {
      id,
      title,
      ...(description !== undefined ? { description } : {}),
      runs,
      cases,
    });
    return c.json({ benchmark } satisfies BenchmarkCreateResponse, 201);
  });

  app.delete("/:benchmarkId", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const benchmarkId = requireValidId(c, "benchmarkId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    await deps.benchmarks.remove(projectId, benchmarkId);
    return c.body(null, 204);
  });

  // Import a package from a zip. Unlike creating or deleting, this is open to every member: a
  // Benchmark belongs to the Project, and anyone in it may bring one in. With `overwrite` it
  // replaces a Benchmark of the same id whole, evaluation records included — the Web App says so
  // before it sends one. `penguin benchmark import` posts here too, with the repository folder
  // an Agent fetched the package from as `origin`, so the same checks hold whoever imports.
  app.post("/archive", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const body = await readJson(c);
    const dataBase64 = requireString(body, "dataBase64");
    // The same 413 the decoded size would get, answered before a byte is decoded.
    if (dataBase64.length > MAX_ARCHIVE_BASE64) {
      throw benchmarkTooLarge("The zip archive exceeds the 14MB limit.");
    }
    const origin = optionalGitOrigin(body);
    const benchmark = await deps.benchmarks.importArchive(
      projectId,
      Buffer.from(dataBase64, "base64"),
      { overwrite: body.overwrite === true, ...(origin !== undefined ? { origin } : {}) },
    );
    return c.json({ benchmark } satisfies BenchmarkArchiveImportResponse, 201);
  });

  // Export a published Benchmark's package: a direct binary attachment, as the Skill and hook
  // exports are, which the import above takes back unchanged.
  app.get("/:benchmarkId/archive", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const benchmarkId = requireValidId(c, "benchmarkId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const { fileName, data } = await deps.benchmarks.exportArchive(projectId, benchmarkId);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/zip",
        // An id and a date version: the encoded name is the name itself.
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  app.get("/:benchmarkId/cases", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const benchmarkId = requireValidId(c, "benchmarkId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    return c.json(await deps.benchmarks.listCases(projectId, benchmarkId));
  });

  app.get("/:benchmarkId/cases/:caseId/files", listCaseFiles(deps, "statement"));
  app.get("/:benchmarkId/cases/:caseId/files/content", readCaseFile(deps, "statement"));
  app.get("/:benchmarkId/cases/:caseId/rubric/files", listCaseFiles(deps, "rubric"));
  app.get("/:benchmarkId/cases/:caseId/rubric/files/content", readCaseFile(deps, "rubric"));

  return app;
}
