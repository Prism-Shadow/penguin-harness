/**
 * The Self-Evolution Workbench's handler as the demo answers it: the routes under its API mount
 * (`/api/projects/:projectId/agents/:agentId/workbenches/benchmark/api/…`) that the pinned
 * package's page calls — the Benchmarks (the list, a hand-made one, a delete, the package
 * download, the cases whole or by page, a case's statement and rubric files with their preview),
 * the prompt Start sends, and the tasks the page started. The paths, answers and error codes are
 * the handler's (the package's `lib/routes.ts`), and so is the prompt: it is built by the
 * handler's own `buildRequest`, so a Start in the demo sends the request a server's would.
 *
 * The page's other requests are the Web App's own routes (the Agents, their Skills, the models,
 * a new conversation and its first message, a conversation's state), which routes.ts answers.
 * The Benchmarks are the workbench's data on the Agent that has it installed, the default Agent;
 * an Agent without it answers 404, and importing a package, which needs a server to unpack it,
 * answers the demo's read-only refusal.
 */
import type {
  BenchmarkCasesResponse,
  BenchmarkCreateResponse,
  BenchmarksResponse,
  BenchmarkSummary,
  CaseFilesResponse,
  CaseMaterial,
  PromptResponse,
  TaskRecord,
  TaskRecordResponse,
  TasksResponse,
  WorkbenchTaskKind,
} from "../../../node_modules/@penguinharness/rsi-workbench/workbenches/benchmark/lib/api";
import { casePage } from "../../../node_modules/@penguinharness/rsi-workbench/workbenches/benchmark/lib/api";
import { buildRequest } from "../../../node_modules/@penguinharness/rsi-workbench/workbenches/benchmark/lib/prompts";
import type { TaskSpec } from "../../../node_modules/@penguinharness/rsi-workbench/workbenches/benchmark/lib/prompts";
import { READ_ONLY } from "./errors";
import { IDS } from "./ids";
import { empty, fail, json, raw } from "./router";
import type { RequestContext, Router } from "./router";

/** The workbench's folder name on an Agent, which its API mount names. */
export const BENCHMARK_WORKBENCH = "benchmark";

const MOUNT = `/api/projects/:projectId/agents/:agentId/workbenches/${BENCHMARK_WORKBENCH}/api`;

/** The workbench's data folder on an Agent, as a server names it: where its Benchmarks are. */
export function benchmarksDirOf(agentId: string): string {
  return `/home/demo/.penguin/data/projects/${IDS.project}/agents/${agentId}/app/data/${BENCHMARK_WORKBENCH}`;
}

const ID = /^[A-Za-z0-9_-]+$/;
const CASE_ID = /^CASE-[A-Za-z0-9_-]+$/;
const TASK_KINDS: readonly WorkbenchTaskKind[] = ["create", "import", "evaluate", "optimize", "ask"];

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const whole = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;

function badRequest(message: string): never {
  return fail(400, "bad_request", message);
}

/** The Agent the request names, when its workbench is installed there. */
function workbenchAgent({ store, params }: RequestContext): string {
  const agentId = params.agentId!;
  const installed = store.f.installed[agentId]?.workbenches ?? [];
  if (!installed.some((w) => w.id === BENCHMARK_WORKBENCH)) {
    fail(404, "not_found", "Resource does not exist or you do not have access.");
  }
  return agentId;
}

function benchmarkOf(ctx: RequestContext): BenchmarkSummary {
  workbenchAgent(ctx);
  const id = ctx.params.benchmarkId!;
  const benchmark = ctx.store.f.benchmarks.find((b) => b.id === id);
  if (!benchmark) fail(404, "not_found", `Benchmark does not exist: ${id}`);
  return benchmark;
}

/** A case's files of one material, by path below the material's root. */
function caseFilesOf(ctx: RequestContext, material: CaseMaterial): Record<string, string> {
  const benchmark = benchmarkOf(ctx);
  const files = ctx.store.f.caseFiles[`${benchmark.id}/${ctx.params.caseId}`];
  if (!files) fail(404, "not_found", `Case ${material} does not exist.`);
  return files[material];
}

/** A request path below a material's root: no leading or trailing slash, no `..`. */
function relativePath(raw: string | null): string {
  const path = (raw ?? "").replace(/^\/+|\/+$/g, "");
  if (path.split("/").includes("..")) badRequest("path must stay inside the case.");
  return path;
}

function listCaseFiles(ctx: RequestContext, material: CaseMaterial): CaseFilesResponse {
  const files = caseFilesOf(ctx, material);
  const path = relativePath(ctx.query.get("path"));
  const entries = new Map<string, CaseFilesResponse["entries"][number]>();
  for (const [filePath, content] of Object.entries(files)) {
    if (path !== "" && !filePath.startsWith(`${path}/`)) continue;
    const rest = path === "" ? filePath : filePath.slice(path.length + 1);
    const name = rest.split("/")[0]!;
    if (entries.has(name)) continue;
    const dir = rest.includes("/");
    entries.set(name, {
      name,
      kind: dir ? "dir" : "file",
      sizeBytes: dir ? 0 : new TextEncoder().encode(content).length,
      mtime: new Date(ctx.store.f.now).toISOString(),
    });
  }
  if (path !== "" && entries.size === 0) fail(404, "path_not_found", `${path} does not exist.`);
  return { path, entries: [...entries.values()] };
}

function caseFileContent(ctx: RequestContext, material: CaseMaterial) {
  const files = caseFilesOf(ctx, material);
  const path = relativePath(ctx.query.get("path"));
  const content = files[path];
  if (content === undefined) fail(404, "path_not_found", `${path} does not exist.`);
  const download = ctx.query.get("download") === "1";
  const name = path.split("/").pop()!;
  return raw(content, {
    "content-type": "text/plain; charset=utf-8",
    "content-disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
    "x-content-type-options": "nosniff",
  });
}

/** The day's first date version, on the local calendar, as the handler writes a new one. */
function todaysVersion(): string {
  const day = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${day.getFullYear()}.${two(day.getMonth() + 1)}.${two(day.getDate())}.1`;
}

function createBenchmark(ctx: RequestContext) {
  workbenchAgent(ctx);
  const body = record(ctx.body);
  const id = text(body.id);
  if (!ID.test(id)) badRequest('id may only contain letters, digits, "_" and "-".');
  const title = text(body.title).trim();
  if (title === "") badRequest("title must not be blank.");
  const cases = Array.isArray(body.cases) ? body.cases.map(record) : [];
  if (cases.length === 0) badRequest("cases must be a non-empty array.");
  for (const [i, c] of cases.entries()) {
    if (!CASE_ID.test(text(c.id))) badRequest(`cases[${i}].id must start with "CASE-".`);
  }
  const { f } = ctx.store;
  if (f.benchmarks.some((b) => b.id === id)) {
    fail(409, "benchmark_exists", `Benchmark already exists: ${id}`);
  }
  const description = text(body.description).trim();
  const benchmark: BenchmarkSummary = {
    id,
    title,
    ...(description !== "" ? { description } : {}),
    runs: whole(body.runs) ?? 1,
    status: "published",
    version: todaysVersion(),
    origin: { kind: "manual" },
    caseCount: cases.length,
    evaluations: [],
    agentIds: [],
  };
  f.benchmarks.push(benchmark);
  f.benchmarkCases[id] = cases.map((c) => ({ id: text(c.id), title: text(c.title).trim() }));
  for (const c of cases) {
    f.caseFiles[`${id}/${text(c.id)}`] = {
      statement: { "README.md": `# ${text(c.title).trim()}\n\n${text(c.statement).trim()}\n` },
      rubric: { "README.md": text(c.rubric) },
    };
  }
  return json(
    { benchmark: { ...benchmark, dir: `${benchmarksDirOf(ctx.params.agentId!)}/${id}` } },
    201,
  );
}

/**
 * The spec the handler builds a request's prompt from, with its defaults: the Benchmark's own run
 * count when a request gives none, three test repetitions for a paper's toolkit.
 */
function specOf(body: Record<string, unknown>, benchmarkDir: string, runs: number): TaskSpec {
  const kind = text(body.kind);
  const model = record(body.testedModel);
  const notes = text(body.notes);
  switch (kind) {
    case "create":
      return { kind, targetAgentId: text(body.targetAgentId), notes };
    case "import":
      return { kind, source: text(body.source) };
    case "evaluate":
      return {
        kind,
        benchmarkId: text(body.benchmarkId),
        benchmarkDir,
        targetAgentId: text(body.targetAgentId),
        runs: whole(body.runs) ?? runs,
        provider: text(model.provider),
        modelId: text(model.modelId),
        notes,
      };
    case "optimize":
      return {
        kind,
        method: { plugin: text(body.method), skill: text(body.skill) },
        benchmarkId: text(body.benchmarkId),
        benchmarkDir,
        targetAgentId: text(body.targetAgentId),
        provider: text(model.provider),
        modelId: text(model.modelId),
        runs: whole(body.runs) ?? runs,
        roundLimit: whole(body.roundLimit) ?? 0,
        targetScore: whole(body.targetScore) ?? 0,
        testRepetitions: whole(body.testRepetitions) ?? 3,
        notes,
      };
    case "ask":
      return {
        kind,
        benchmarkId: text(body.benchmarkId),
        benchmarkDir,
        question: text(body.question),
        ...(body.evaluation !== undefined
          ? { evaluation: body.evaluation as NonNullable<Extract<TaskSpec, { kind: "ask" }>["evaluation"]> }
          : { case: body.case as NonNullable<Extract<TaskSpec, { kind: "ask" }>["case"]> }),
      };
    default:
      return badRequest(`kind must be one of ${TASK_KINDS.join(", ")}.`);
  }
}

/**
 * What Start sends for a request to the workbench on `agentId`: the handler's prompt, naming the
 * Benchmark's folder in that workbench's data, and the Skills it preselects and requires.
 * `runsOf` gives a Benchmark's own run count, for a request that names none.
 */
export function benchmarkPrompt(
  body: Record<string, unknown>,
  agentId: string,
  runsOf: (benchmarkId: string) => number | undefined,
): PromptResponse {
  const benchmarkId = text(body.benchmarkId);
  const language = body.language === "zh" ? "zh" : "en";
  const dir = benchmarksDirOf(agentId);
  const spec = specOf(body, `${dir}/${benchmarkId}`, runsOf(benchmarkId) ?? 1);
  const { prompt, skills, required } = buildRequest(spec, language, dir);
  return { prompt, skills, required };
}

function prompt(ctx: RequestContext, body: Record<string, unknown>): PromptResponse {
  const agentId = workbenchAgent(ctx);
  return benchmarkPrompt(
    body,
    agentId,
    (id) => ctx.store.f.benchmarks.find((b) => b.id === id)?.runs,
  );
}

function recordTask(ctx: RequestContext) {
  workbenchAgent(ctx);
  const body = record(ctx.body);
  const kind = text(body.kind) as WorkbenchTaskKind;
  if (!TASK_KINDS.includes(kind)) badRequest(`kind must be one of ${TASK_KINDS.join(", ")}.`);
  const sessionId = text(body.sessionId);
  if (sessionId === "") badRequest("sessionId is required.");
  const task: TaskRecord = {
    sessionId,
    kind,
    ...(typeof body.benchmarkId === "string" ? { benchmarkId: body.benchmarkId } : {}),
    agentId: text(body.agentId),
    approvalMode:
      body.approvalMode === "deny-all" ||
      body.approvalMode === "read-only" ||
      body.approvalMode === "always-ask"
        ? body.approvalMode
        : "allow-all",
    createdAt: new Date().toISOString(),
  };
  ctx.store.f.benchmarkTasks.push(task);
  return json({ task } satisfies TaskRecordResponse, 201);
}

/** The workbench's routes, on the demo's router. */
export function benchmarkWorkbenchRoutes(router: Router): void {
  router
    .get(`${MOUNT}/benchmarks`, (ctx): BenchmarksResponse => {
      const dir = benchmarksDirOf(workbenchAgent(ctx));
      return {
        benchmarks: ctx.store.f.benchmarks.map((b) => ({ ...b, dir: `${dir}/${b.id}` })),
        dir,
      };
    })
    .post(`${MOUNT}/benchmarks`, createBenchmark)
    .post(`${MOUNT}/benchmarks/archive`, (ctx) => {
      workbenchAgent(ctx);
      return fail(
        409,
        READ_ONLY,
        "The gallery's demo cannot import a Benchmark package; it has no server behind it.",
      );
    })
    .delete(`${MOUNT}/benchmarks/:benchmarkId`, (ctx) => {
      const benchmark = benchmarkOf(ctx);
      const { f } = ctx.store;
      f.benchmarks = f.benchmarks.filter((b) => b.id !== benchmark.id);
      delete f.benchmarkCases[benchmark.id];
      return empty();
    })
    .get(`${MOUNT}/benchmarks/:benchmarkId/archive`, (ctx) => {
      const benchmark = benchmarkOf(ctx);
      return raw("PK\u0003\u0004 demo archive", {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${benchmark.id}-${benchmark.version ?? "0"}.zip`)}`,
      });
    })
    .get(`${MOUNT}/benchmarks/:benchmarkId/cases`, (ctx): BenchmarkCasesResponse => {
      const cases = ctx.store.f.benchmarkCases[benchmarkOf(ctx).id] ?? [];
      const raw = ctx.query.get("page");
      if (raw === null) return { cases };
      const page = Number(raw);
      if (!Number.isSafeInteger(page) || page < 1) badRequest("page must be a positive integer.");
      return { cases: casePage(cases, page), total: cases.length };
    })
    .get(`${MOUNT}/benchmarks/:benchmarkId/cases/:caseId/files`, (ctx) =>
      listCaseFiles(ctx, "statement"),
    )
    .get(`${MOUNT}/benchmarks/:benchmarkId/cases/:caseId/rubric/files`, (ctx) =>
      listCaseFiles(ctx, "rubric"),
    )
    .get(`${MOUNT}/benchmarks/:benchmarkId/cases/:caseId/files/content`, (ctx) =>
      caseFileContent(ctx, "statement"),
    )
    .get(`${MOUNT}/benchmarks/:benchmarkId/cases/:caseId/rubric/files/content`, (ctx) =>
      caseFileContent(ctx, "rubric"),
    )
    .get(`${MOUNT}/prompt`, (ctx) =>
      prompt(ctx, Object.fromEntries(ctx.query.entries()) as Record<string, unknown>),
    )
    .post(`${MOUNT}/prompt`, (ctx) => prompt(ctx, record(ctx.body)))
    .get(`${MOUNT}/tasks`, (ctx): TasksResponse => {
      workbenchAgent(ctx);
      const benchmarkId = ctx.query.get("benchmarkId");
      if (benchmarkId !== null && !ID.test(benchmarkId)) {
        badRequest('benchmarkId may only contain letters, digits, "_" and "-".');
      }
      const tasks = ctx.store.f.benchmarkTasks
        .filter((task) => benchmarkId === null || task.benchmarkId === benchmarkId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { tasks };
    })
    .post(`${MOUNT}/tasks`, recordTask);
}
