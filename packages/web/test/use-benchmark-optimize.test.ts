// @vitest-environment jsdom
/**
 * The Use dialog's Optimize tab (features/benchmark/use-benchmark-modal.tsx) under the toolkits of
 * both protocols, read from the plugin library the dialog fetches.
 *
 * - Given a toolkit that learns on a Train/Test pair, the tab asks for test repetitions in place
 *   of runs per case, says which packages the method uses, and the conversation it opens carries
 *   that toolkit's Train/Test tail with the repetitions and only its Skill preselected.
 * - Given a toolkit that optimizes against one Benchmark, the tab keeps runs per case and the
 *   conversation carries the one-Benchmark tail, as before.
 * - Given test repetitions out of range, the tab says so under the field and does not open the
 *   conversation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import type {
  AgentSummary,
  BenchmarkSummary,
  ModelsResponse,
  PluginItem,
} from "@prismshadow/penguin-server/api";
import { UseBenchmarkModal } from "../src/features/benchmark/use-benchmark-modal";
import { DEFAULT_TOOLKIT_PLUGIN, OPTIMIZATION_SKILL } from "../src/features/benchmark/rsi-methods";
import { draftKey, loadDraft } from "../src/features/chat/draft-cache";
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
const TEST_PACKAGE = "penguinharness-benchmark-gdpevo-essential-service-ticket-resolution-test";
const DRAFT_KEY = draftKey(ADMIN_ME.user.userId, PROJECT_ID);

const toolkit = (name: string, over: Partial<PluginItem> = {}): PluginItem => ({
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
  ...over,
});

const LIBRARY = {
  groups: [
    {
      id: "rsi",
      title: "Agent Self-Evolution",
      plugins: [
        toolkit(DEFAULT_TOOLKIT_PLUGIN),
        toolkit("opro-rsi-toolkit"),
        toolkit("skillopt-rsi-toolkit", { rsiProtocol: "train-test" }),
      ],
    },
  ],
};

const BENCHMARK: BenchmarkSummary = {
  id: TEST_PACKAGE,
  title: "GDPEVO Essential-Service Ticket Resolution-Test",
  status: "published",
  caseCount: 5,
  evaluations: [],
  agentIds: [],
};

const AGENTS = [
  { agentId: AGENT_ID, name: "Ticket agent", createdAt: "2026-01-01T00:00:00Z" },
] as unknown as AgentSummary[];

const MODELS = {
  providers: {},
  models: [{ provider: "custom", modelId: "m-1", contextWindow: 200_000 }],
  defaultModel: { provider: "custom", modelId: "m-1" },
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

/** The dialog on its Optimize tab, under the providers its conversation hand-off needs. */
async function openOptimize() {
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
              benchmark: BENCHMARK,
              agents: AGENTS,
              models: MODELS,
              initialTab: "optimize",
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
  await waitFor(() => hasButton(DEFAULT_TOOLKIT_PLUGIN), 40);
  return router;
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

describe("the Optimize tab", () => {
  it("asks a Train/Test toolkit for test repetitions and hands it the Train/Test tail", async () => {
    const router = await openOptimize();
    await pickMethod("skillopt-rsi-toolkit");

    expect(hasField(S.benchmark.testRepetitionsField)).toBe(true);
    expect(hasField(S.benchmark.runsField)).toBe(false);
    expect(field(S.benchmark.testRepetitionsField).value).toBe("3");
    expect(document.body.textContent).toContain(S.benchmark.methodTrainTestHint);

    await type(field(S.benchmark.testRepetitionsField), "5");
    await click(button(S.aiCreate.editInChat));
    await waitFor(() => router.state.location.pathname.startsWith("/chat/"), 40);

    const draft = loadDraft(DRAFT_KEY);
    expect(draft.agentId).toBe(AGENT_ID);
    expect(draft.skills).toEqual(["skillopt-rsi-toolkit"]);
    expect(draft.text).toContain("`skillopt-rsi-toolkit`");
    expect(draft.text).toContain(`\`benchmarks/${TEST_PACKAGE}/\``);
    expect(draft.text).toMatch(/test_repetitions[：:] ?`5`/);
    expect(draft.text).not.toMatch(/^- runs[：:]/m);
  });

  it("keeps runs per case for a toolkit that optimizes against one Benchmark", async () => {
    const router = await openOptimize();
    await pickMethod("opro-rsi-toolkit");

    expect(hasField(S.benchmark.runsField)).toBe(true);
    expect(hasField(S.benchmark.testRepetitionsField)).toBe(false);
    expect(document.body.textContent).toContain(S.benchmark.methodBudgetHint);

    await click(button(S.aiCreate.editInChat));
    await waitFor(() => router.state.location.pathname.startsWith("/chat/"), 40);
    const draft = loadDraft(DRAFT_KEY);
    expect(draft.skills).toEqual(["opro-rsi-toolkit"]);
    expect(draft.text).toMatch(/^- runs[：:] ?`1`/m);
    expect(draft.text).not.toContain("test_repetitions");
  });

  it("refuses test repetitions out of range", async () => {
    await openOptimize();
    await pickMethod("skillopt-rsi-toolkit");

    await type(field(S.benchmark.testRepetitionsField), "0");

    expect(document.body.textContent).toContain(S.benchmark.invalidRuns);
    expect(button(S.aiCreate.editInChat).disabled).toBe(true);
  });
});
