/**
 * Promotion workflow E2E:
 * - structured Benchmark roles and Scoreboard metadata render without summary/id inference;
 * - active and production versions are distinguished;
 * - an ungated Development Candidate opens a NEW draft with only the Promotion binding;
 * - promoted/restored records advance or preserve production and never reopen the gate.
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

function evaluation({ version, kind, sessionId, productionVersion, decision }) {
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
    score: version === 1 ? 60 : 80,
    cost: null,
    duration_ms: 10,
    cases: [
      {
        case: "CASE-001-fixture",
        score: version === 1 ? 60 : 80,
        cost: null,
        duration_ms: 10,
        runs: [
          {
            score: version === 1 ? 60 : 80,
            cost: null,
            duration_ms: 10,
            session_id: `fixture-run-v${version}`,
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

async function openBenchmark(page, title) {
  await page.goto(`${BASE}/benchmark?agentId=${AGENT}`);
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await expect(page.locator("section").getByRole("heading", { name: title })).toBeVisible();
}

test("pending Candidate opens an isolated promotion draft; promoted/restored states render", async ({
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

  const baseline = evaluation({ version: 1, kind: "formal_baseline" });
  const candidateV2 = evaluation({
    version: 2,
    kind: "development_candidate",
    sessionId: "optimizer-batch-1",
    productionVersion: 1,
  });
  await writeBenchmark(projectId, DEVELOPMENT, "development", PROMOTION, [baseline, candidateV2]);
  await writeBenchmark(projectId, PROMOTION, "promotion", DEVELOPMENT, [baseline]);
  await setAgentVersion(projectId, 2);

  await openBenchmark(page, "Development fixture");
  const details = page.locator("section");
  await expect(details.getByText("活动 v2", { exact: true })).toBeVisible();
  await expect(details.getByText("生产 v1", { exact: true })).toBeVisible();
  await expect(details.getByText("待晋升验证", { exact: true })).toBeVisible();
  await expect(details.getByText("开发已接受", { exact: true })).toBeVisible();
  await expect(details.getByText("基线", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "开始晋升验证" }).click();
  await expect(page).toHaveURL(/\/chat\/new$/);
  const composer = page.getByPlaceholder(/输入消息/);
  await expect(composer).toHaveValue(/optimization_session_id.*optimizer-batch-1/s);
  await expect(composer).toHaveValue(new RegExp(`promotion_benchmark_id.*${PROMOTION}`, "s"));
  const prompt = await composer.inputValue();
  expect(prompt).not.toContain(DEVELOPMENT);
  expect(prompt).toContain("snapshots/v1.tar.gz");
  expect(prompt).toContain("snapshots/v2.tar.gz");

  const promotedV2 = evaluation({
    version: 2,
    kind: "promotion_candidate",
    sessionId: "optimizer-batch-1",
    productionVersion: 1,
    decision: "promoted",
  });
  await writeBenchmark(projectId, PROMOTION, "promotion", DEVELOPMENT, [baseline, promotedV2]);
  await openBenchmark(page, "Development fixture");
  await expect(details.getByText("活动 v2", { exact: true })).toBeVisible();
  await expect(details.getByText("生产 v2", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始晋升验证" })).toHaveCount(0);

  const candidateV3 = evaluation({
    version: 3,
    kind: "development_candidate",
    sessionId: "optimizer-batch-2",
    productionVersion: 2,
  });
  const restoredV3 = evaluation({
    version: 3,
    kind: "promotion_candidate",
    sessionId: "optimizer-batch-2",
    productionVersion: 2,
    decision: "restored",
  });
  await writeBenchmark(projectId, DEVELOPMENT, "development", PROMOTION, [
    baseline,
    candidateV2,
    candidateV3,
  ]);
  await writeBenchmark(projectId, PROMOTION, "promotion", DEVELOPMENT, [
    baseline,
    promotedV2,
    restoredV3,
  ]);
  await setAgentVersion(projectId, 2);

  await openBenchmark(page, "Development fixture");
  await expect(details.getByText("活动 v2", { exact: true })).toBeVisible();
  await expect(details.getByText("生产 v2", { exact: true })).toBeVisible();
  await expect(details.getByText("待晋升验证", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "开始晋升验证" })).toHaveCount(0);

  await page.getByRole("button", { name: /Promotion fixture/ }).click();
  await expect(details.getByText("已晋升", { exact: true })).toBeVisible();
  await expect(details.getByText("已回滚", { exact: true })).toBeVisible();
});
