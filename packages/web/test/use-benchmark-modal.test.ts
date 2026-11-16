// @vitest-environment jsdom
/**
 * The Use dialog (features/benchmark/use-benchmark-modal.tsx): the two models it picks apart,
 * and what the Optimize tab asks a toolkit other than the default for.
 *
 * - Given a tested agent whose latest evaluation here ran on another model than the Project's
 *   default, the tested-model picker presets to that model while the conversation keeps the
 *   default: the conversation opens on the default and its prompt names the tested model.
 * - Given a tested model picked by hand, the prompt names it and the conversation's model is
 *   left alone.
 * - Given a last-evaluated model the Project no longer lists, the tested model is the Project's
 *   default instead.
 * - Given the default loop, the baseline is the tested agent's score on the tested model, and a
 *   tested model with no score there shows the no-baseline notice.
 * - Given a toolkit other than the default, the tab asks for test-set repetitions (3) in place of
 *   runs per case, and the conversation carries the repetitions, the tested model and only that
 *   toolkit's Skill; repetitions out of range are refused under the field and keep the exit shut.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import type {
  AgentSummary,
  BenchmarkEvaluation,
  BenchmarkSummary,
  ModelsResponse,
  PluginItem,
} from "@prismshadow/penguin-server/api";
import { UseBenchmarkModal, type UseTab } from "../src/features/benchmark/use-benchmark-modal";
import { DEFAULT_TOOLKIT_PLUGIN, OPTIMIZATION_SKILL } from "../src/features/benchmark/rsi-methods";
import { draftKey, loadDraft } from "../src/features/chat/draft-cache";
import { formatScore } from "../src/lib/format";
import { S } from "../src/lib/strings";
import { AuthProvider } from "../src/state/auth";
import { LocaleProvider } from "../src/state/locale";
import { ProjectProvider } from "../src/state/project";
import { ADMIN_ME } from "./helpers/admin-settings";
import { button, click, field, hasButton, mount, type, unmountAll, waitFor } from "./helpers/dom";
import { apiError, json, stubFetch } from "./helpers/fetch";
import { SignedIn } from "./helpers/signed-in";

const PROJECT_ID = "proj";
const AGENT_ID = "ticket-agent";
const BENCHMARK_ID = "ticket-resolution";
const DRAFT_KEY = draftKey(ADMIN_ME.user.userId, PROJECT_ID);

const toolkit = (name: string): PluginItem => ({
  name,
  title: name,
  description: "",
  version: "0.2.18",
  package: `@penguinharness/${name}`,
  source: "builtin",
  skills: [
    {
      name: name === DEFAULT_TOOLKIT_PLUGIN ? OPTIMIZATION_SKILL : name,
      description: "",
      version: "",
    },
  ],
  hooks: [],
  mcpServers: [],
});

const LIBRARY = {
  groups: [
    {
      id: "rsi",
      title: "Agent Self-Evolution",
      plugins: [toolkit(DEFAULT_TOOLKIT_PLUGIN), toolkit("skillopt-rsi-toolkit")],
    },
  ],
};

const evaluation = (modelId: string, score: number): BenchmarkEvaluation => ({
  time: "2026-11-01T00:00:00Z",
  agentId: AGENT_ID,
  provider: "custom",
  modelId,
  thinkingLevel: "medium",
  version: 1,
  score,
  cost: null,
  durationMs: 1000,
  cases: [],
});

const benchmarkWith = (evaluations: BenchmarkEvaluation[]): BenchmarkSummary => ({
  id: BENCHMARK_ID,
  title: "Ticket resolution",
  status: "published",
  caseCount: 5,
  evaluations,
  agentIds: [AGENT_ID],
});

const AGENTS = [
  { agentId: AGENT_ID, name: "Ticket agent", createdAt: "2026-01-01T00:00:00Z" },
] as unknown as AgentSummary[];

// m-a is the Project's default; the agent was last evaluated here on m-b.
const MODELS = {
  providers: {},
  models: ["m-a", "m-b", "m-c"].map((modelId) => ({
    provider: "custom",
    modelId,
    contextWindow: 200_000,
  })),
  defaultModel: { provider: "custom", modelId: "m-a" },
} as unknown as ModelsResponse;

/** This server: the user, one Project, its one agent with every toolkit's Skill, and the library. */
function serve() {
  return stubFetch(async ({ path }) => {
    if (path === "/api/me") return json(ADMIN_ME);
    if (path === "/api/me/prefs") return json({ prefs: {} });
    if (path === "/api/projects") {
      return json({
        projects: [
          {
            projectId: PROJECT_ID,
            name: "Project",
            role: "owner",
            ownerUserId: "admin",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      });
    }
    if (path === `/api/projects/${PROJECT_ID}/agents`) return json({ agents: AGENTS });
    if (path === `/api/projects/${PROJECT_ID}/agents/${AGENT_ID}/skills`) {
      return json({
        skills: LIBRARY.groups[0]!.plugins.flatMap((p) => p.skills.map((s) => ({ name: s.name }))),
      });
    }
    if (path === "/api/plugins") return json(LIBRARY);
    return apiError(404, "not_found");
  });
}

/** The dialog on `tab`, under the providers its conversation hand-off needs. */
async function openDialog(tab: UseTab, benchmark: BenchmarkSummary) {
  serve();
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: h(
          SignedIn,
          null,
          h(
            ProjectProvider,
            null,
            h(UseBenchmarkModal, {
              open: true,
              onClose: () => {},
              projectId: PROJECT_ID,
              benchmark,
              agents: AGENTS,
              models: MODELS,
              initialTab: tab,
            }),
          ),
        ),
      },
      { path: "/chat/:sessionId", element: h("p", null, "Conversation") },
    ],
    { initialEntries: ["/"] },
  );
  await mount(h(LocaleProvider, null, h(AuthProvider, null, h(RouterProvider, { router }))));
  // The Method select is live once the library is read.
  await waitFor(() => hasButton(DEFAULT_TOOLKIT_PLUGIN) || tab === "evaluate", 40);
  return router;
}

/** The two model pickers, in form order: the tested agent's, then the conversation's. */
function modelTriggers(): { tested: HTMLButtonElement; session: HTMLButtonElement } {
  const triggers = [
    ...document.querySelectorAll<HTMLButtonElement>(`button[aria-label="${S.chat.chooseModel}"]`),
  ];
  if (triggers.length !== 2) throw new Error(`expected two model pickers, saw ${triggers.length}`);
  return { tested: triggers[0]!, session: triggers[1]! };
}

/** Picks `modelId` in the picker behind `trigger`. */
async function pickModel(trigger: HTMLButtonElement, modelId: string) {
  await click(trigger);
  const row = [...document.querySelectorAll('[role="option"] button')].find((b) =>
    b.textContent?.includes(modelId),
  );
  if (row === undefined) throw new Error(`no model ${modelId}`);
  await click(row);
}

/** Picks a Method by its label. */
async function pickMethod(label: string) {
  await click(button(DEFAULT_TOOLKIT_PLUGIN));
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (o) => o.textContent?.trim() === label,
  );
  if (option === undefined) throw new Error(`no method ${label}`);
  await click(option);
}

/** Opens the conversation and returns the draft it was handed. */
async function handOff(router: Awaited<ReturnType<typeof openDialog>>) {
  await click(button(S.aiCreate.editInChat));
  await waitFor(() => router.state.location.pathname.startsWith("/chat/"), 40);
  return loadDraft(DRAFT_KEY);
}

const hasField = (label: string) => {
  try {
    field(label);
    return true;
  } catch {
    return false;
  }
};

afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe("the tested agent's model", () => {
  it("presets to the model of the agent's latest evaluation and leaves the conversation on the default", async () => {
    const router = await openDialog("evaluate", benchmarkWith([evaluation("m-b", 70)]));

    expect(modelTriggers().tested.textContent).toContain("m-b");
    expect(modelTriggers().session.textContent).toContain("m-a");
    const draft = await handOff(router);
    expect(draft.modelRef).toEqual({ provider: "custom", modelId: "m-a" });
    expect(draft.text).toMatch(/provider[：:] ?`custom`/);
    expect(draft.text).toMatch(/model_id[：:] ?`m-b`/);
    expect(draft.text).not.toMatch(/model_id[：:] ?`m-a`/);
  });

  it("names a model picked by hand and leaves the conversation's model alone", async () => {
    const router = await openDialog("evaluate", benchmarkWith([evaluation("m-b", 70)]));

    await pickModel(modelTriggers().tested, "m-c");

    expect(modelTriggers().session.textContent).toContain("m-a");
    const draft = await handOff(router);
    expect(draft.modelRef).toEqual({ provider: "custom", modelId: "m-a" });
    expect(draft.text).toMatch(/model_id[：:] ?`m-c`/);
  });

  it("falls back to the Project's default when the last-evaluated model is no longer listed", async () => {
    await openDialog("evaluate", benchmarkWith([evaluation("m-gone", 70)]));

    expect(modelTriggers().tested.textContent).toContain("m-a");
  });
});

describe("the Optimize tab", () => {
  it("reads the default loop's baseline on the tested model", async () => {
    await openDialog("optimize", benchmarkWith([evaluation("m-a", 40), evaluation("m-b", 70)]));

    expect(document.body.textContent).toContain(S.benchmark.baselineLine(formatScore(70), 80));
    await pickModel(modelTriggers().tested, "m-a");
    expect(document.body.textContent).toContain(S.benchmark.baselineLine(formatScore(40), 50));
    await pickModel(modelTriggers().tested, "m-c");
    expect(document.body.textContent).toContain(S.benchmark.noBaseline);
  });

  it("asks a toolkit for test-set repetitions and hands it the general tail", async () => {
    const router = await openDialog("optimize", benchmarkWith([evaluation("m-b", 70)]));
    await pickMethod("skillopt-rsi-toolkit");

    expect(hasField(S.benchmark.runsField)).toBe(false);
    expect(field(S.benchmark.testRepetitionsField).value).toBe("3");
    await type(field(S.benchmark.testRepetitionsField), "5");
    const draft = await handOff(router);

    expect(draft.agentId).toBe(AGENT_ID);
    expect(draft.skills).toEqual(["skillopt-rsi-toolkit"]);
    expect(draft.text).toContain("`skillopt-rsi-toolkit`");
    expect(draft.text).toMatch(/test_repetitions[：:] ?`5`/);
    expect(draft.text).toMatch(/model_id[：:] ?`m-b`/);
    expect(draft.text).not.toMatch(/^- runs[：:]/m);
  });

  it("refuses test-set repetitions out of range", async () => {
    await openDialog("optimize", benchmarkWith([]));
    await pickMethod("skillopt-rsi-toolkit");

    await type(field(S.benchmark.testRepetitionsField), "0");

    expect(document.body.textContent).toContain(S.benchmark.invalidRuns);
    expect(button(S.aiCreate.editInChat).disabled).toBe(true);
  });
});
