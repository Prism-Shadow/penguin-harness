/**
 * Automatic Promotion workflow E2E:
 * - an Optimizer Task settles with one immutable request file;
 * - the server creates an isolated top-level Promotion Session without a UI button;
 * - a valid held-out score promotes, while a regression restores the production Snapshot;
 * - the Benchmark page is a status/read-through surface and links to the automatic Session.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const DATA = process.env.E2E_DATA_ROOT;
const U = "promotionflow";
const P = "password123";
const AGENT = "promotion_agent";
const DEVELOPMENT = "promotion-e2e-development";
const PROMOTION = "promotion-e2e-heldout";

function evaluation({ version, score, kind, sessionId, productionVersion, decision }) {
  return {
    time: new Date(2026, 7, 11, version).toISOString(),
    version,
    provider: "custom",
    model_id: "claude-4-8",
    thinking_level: "medium",
    evaluation_kind: kind,
    ...(sessionId ? { optimization_session_id: sessionId } : {}),
    ...(productionVersion ? { production_reference_version: productionVersion } : {}),
    ...(decision ? { promotion_decision: decision } : {}),
    summary_title: "Human-readable fixture title only",
    summary: "This text deliberately carries no workflow state.",
    score,
    cost: null,
    duration_ms: 10,
    cases: [
      {
        case: "CASE-001-fixture",
        score,
        cost: null,
        duration_ms: 10,
        runs: [
          {
            score,
            cost: null,
            duration_ms: 10,
            session_id: `fixture-run-v${version}-${kind}`,
          },
        ],
      },
    ],
  };
}

async function setAgentVersion(projectId, version) {
  const configPath = join(DATA, projectId, "agents", AGENT, "agent_state", "system_config.yaml");
  const config = await readFile(configPath, "utf8");
  await writeFile(configPath, config.replace(/^version:\s*\d+\s*$/m, `version: ${version}`));
}

async function writeBenchmark(projectId, id, role, pair, evaluations) {
  const root = join(DATA, projectId, "agents", AGENT, "benchmarks", id);
  await mkdir(join(root, "CASE-001-fixture", "statement"), { recursive: true });
  await mkdir(join(root, "CASE-001-fixture", "rubric"), { recursive: true });
  await writeFile(
    join(root, "benchmark_config.toml"),
    `title = "${role === "development" ? "Development fixture" : "Promotion fixture"}"\nrole = "${role}"\npaired_benchmark_id = "${pair}"\nruns = 1\n`,
  );
  await writeFile(
    join(root, "CASE-001-fixture", "statement", "README.md"),
    "# Fixture task\n\nProduce fixture.txt.\n",
  );
  await writeFile(
    join(root, "CASE-001-fixture", "rubric", "README.md"),
    "# Fixture rubric\n\n- Correct fixture: 100 points\n",
  );
  await writeFile(join(root, "scoreboard.yaml"), `${JSON.stringify({ evaluations }, null, 2)}\n`);
}

async function settleOptimizerBatch(
  request,
  projectId,
  sessionId,
  candidateVersion,
  productionVersion,
) {
  const requestsDir = join(DATA, projectId, "promotion_requests");
  await mkdir(requestsDir, { recursive: true });
  await writeFile(
    join(requestsDir, `${sessionId}.yaml`),
    [
      "protocol_version: 1",
      `optimization_session_id: ${sessionId}`,
      `test_agent_id: ${AGENT}`,
      `development_benchmark_id: ${DEVELOPMENT}`,
      `production_reference_version: ${productionVersion}`,
      `candidate_version: ${candidateVersion}`,
      "",
    ].join("\n"),
    { flag: "wx" },
  );
  const started = await request.post(`${BASE}/api/sessions/${sessionId}/tasks`, {
    data: { input: [{ type: "text", text: "Finish this optimization batch." }] },
  });
  expect(started.ok(), "start Optimizer Task").toBeTruthy();
}

async function expectPromotionStatus(request, projectId, optimizationSessionId, status) {
  await expect
    .poll(
      async () => {
        const body = await (
          await request.get(
            `${BASE}/api/projects/${projectId}/agents/${AGENT}/benchmarks/promotion-runs`,
          )
        ).json();
        return body.runs.find((item) => item.optimizationSessionId === optimizationSessionId)
          ?.status;
      },
      { timeout: 20_000 },
    )
    .toBe(status);
}

async function openBenchmark(page, title) {
  await page.goto(`${BASE}/benchmark?agentId=${AGENT}`);
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await expect(page.locator("section").getByRole("heading", { name: title })).toBeVisible();
}

test("server automatically promotes and restores isolated batches; UI only observes", async ({
  page,
}) => {
  expect(DATA, "run.sh must expose its disposable data root").toBeTruthy();
  await provisionAndLogin(page.request, U, P);
  const projectId = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0]
    .projectId;

  const models = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: 200000,
        },
      ],
    },
  });
  expect(models.ok(), "configure mock model").toBeTruthy();
  const created = await page.request.post(`${BASE}/api/projects/${projectId}/agents`, {
    data: { agentId: AGENT, name: "Promotion Agent" },
  });
  expect(created.ok(), "create target Agent").toBeTruthy();

  // Establish the recoverable production Snapshot before constructing Candidate v2.
  const snapshotV1 = await page.request.get(
    `${BASE}/api/projects/${projectId}/agents/${AGENT}/export`,
  );
  expect(snapshotV1.ok(), "snapshot production v1").toBeTruthy();
  const baseline = evaluation({ version: 1, score: 80, kind: "formal_baseline" });
  await writeBenchmark(projectId, PROMOTION, "promotion", DEVELOPMENT, [baseline]);
  await setAgentVersion(projectId, 2);

  const firstSession = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8" },
    })
  ).json();
  const firstOptimizer = firstSession.session.sessionId;
  const candidateV2 = evaluation({
    version: 2,
    score: 90,
    kind: "development_candidate",
    sessionId: firstOptimizer,
    productionVersion: 1,
  });
  await writeBenchmark(projectId, DEVELOPMENT, "development", PROMOTION, [
    evaluation({ version: 1, score: 60, kind: "formal_baseline" }),
    candidateV2,
  ]);
  await settleOptimizerBatch(page.request, projectId, firstOptimizer, 2, 1);
  await expectPromotionStatus(page.request, projectId, firstOptimizer, "promoted");

  await openBenchmark(page, "Development fixture");
  const details = page.locator("section");
  await expect(details.getByText("活动 v2", { exact: true })).toBeVisible();
  await expect(details.getByText("生产 v2", { exact: true })).toBeVisible();
  await expect(details.getByText("已晋升", { exact: true })).toBeVisible();
  await expect(details.getByRole("link", { name: "查看晋升 Session" })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始晋升验证" })).toHaveCount(0);

  // A second independent Batch starts at production v2. The mock held-out score for v3
  // regresses, so the server must restore v2 without a user action.
  await setAgentVersion(projectId, 3);
  const secondSession = await (
    await page.request.post(`${BASE}/api/projects/${projectId}/agents/default_agent/sessions`, {
      data: { provider: "custom", modelId: "claude-4-8" },
    })
  ).json();
  const secondOptimizer = secondSession.session.sessionId;
  const candidateV3 = evaluation({
    version: 3,
    score: 95,
    kind: "development_candidate",
    sessionId: secondOptimizer,
    productionVersion: 2,
  });
  await writeBenchmark(projectId, DEVELOPMENT, "development", PROMOTION, [
    evaluation({ version: 1, score: 60, kind: "formal_baseline" }),
    candidateV2,
    candidateV3,
  ]);
  // The Promotion Scoreboard remains untouched: its server-authored v2 record is the
  // frozen production reference for this second gate.
  await settleOptimizerBatch(page.request, projectId, secondOptimizer, 3, 2);
  await expectPromotionStatus(page.request, projectId, secondOptimizer, "restored");

  await openBenchmark(page, "Development fixture");
  await expect(details.getByText("活动 v2", { exact: true })).toBeVisible();
  await expect(details.getByText("生产 v2", { exact: true })).toBeVisible();
  await expect(details.getByText("已回滚", { exact: true })).toBeVisible();
  await expect(details.getByRole("link", { name: "查看晋升 Session" })).toBeVisible();
  await page.getByRole("button", { name: /Promotion fixture/ }).click();
  await expect(details.getByText("已晋升", { exact: true })).toBeVisible();
  await expect(details.getByText("已回滚", { exact: true })).toBeVisible();
});
