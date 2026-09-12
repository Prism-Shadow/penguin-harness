/**
 * Benchmark routes, Project-level because a Benchmark is a peer of an Agent rather than
 * something an Agent owns — which Agents it has evaluated comes from its scoreboard:
 *   GET /api/projects/:p/benchmarks (any member, read-only)
 *   POST /api/projects/:p/benchmarks (owner: create a Benchmark by hand)
 *   DELETE /api/projects/:p/benchmarks/:benchmarkId (owner: remove the directory whole)
 *   GET /api/projects/:p/benchmarks/:benchmarkId/cases
 *   GET /api/projects/:p/benchmarks/:benchmarkId/cases/:caseId/files
 *   GET /api/projects/:p/benchmarks/:benchmarkId/cases/:caseId/files/content
 *   GET /api/projects/:p/benchmarks/:benchmarkId/cases/:caseId/rubric/files
 *   GET /api/projects/:p/benchmarks/:benchmarkId/cases/:caseId/rubric/files/content
 * Returns the Project's Benchmark list (title/description from benchmark_config.toml)
 * along with the evaluations[] from scoreboard.yaml.
 */
import { Hono, type Context } from "hono";
import { isValidId } from "@prismshadow/penguin-core";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import type { BenchmarkCreateResponse, CaseMaterial } from "../../api/types.js";
import type { BenchmarkCaseInput } from "../../services/benchmark-service.js";
import {
  badRequest,
  optionalNumber,
  optionalString,
  readJson,
  requireString,
  requireValidId,
} from "../validate.js";

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

function listCaseFiles(deps: AppDeps, material: CaseMaterial) {
  return async (c: Context<AppEnv>) => {
    const projectId = requireValidId(c, "projectId");
    const benchmarkId = requireValidId(c, "benchmarkId");
    const caseId = requireValidId(c, "caseId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
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

function readCaseFile(deps: AppDeps, material: CaseMaterial) {
  return async (c: Context<AppEnv>) => {
    const projectId = requireValidId(c, "projectId");
    const benchmarkId = requireValidId(c, "benchmarkId");
    const caseId = requireValidId(c, "caseId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
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

export function benchmarksRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    return c.json(await deps.benchmarks.list(projectId));
  });

  app.post("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    // Writing into the Project's benchmarks directory is Project management: owner only, like
    // schedules and imports.
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
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
    deps.projectService.requireProjectOwner(c.var.user.userId, projectId);
    await deps.benchmarks.remove(projectId, benchmarkId);
    return c.body(null, 204);
  });

  app.get("/:benchmarkId/cases", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const benchmarkId = requireValidId(c, "benchmarkId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    return c.json(await deps.benchmarks.listCases(projectId, benchmarkId));
  });

  app.get("/:benchmarkId/cases/:caseId/files", listCaseFiles(deps, "statement"));
  app.get("/:benchmarkId/cases/:caseId/files/content", readCaseFile(deps, "statement"));
  app.get("/:benchmarkId/cases/:caseId/rubric/files", listCaseFiles(deps, "rubric"));
  app.get("/:benchmarkId/cases/:caseId/rubric/files/content", readCaseFile(deps, "rubric"));

  return app;
}
