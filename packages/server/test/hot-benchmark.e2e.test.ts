/**
 * Agent benchmark (project sense: a scored, repeated evaluation of an agent
 * capability): can DeepSeek v4 flash author a CONFORMANT hot-reload skill
 * script for our platform, first try, from the spec alone?
 *
 * Each run: prompt the model with the hot-script spec → extract the script →
 * install through the real API (eval + context → arktype contract; a
 * non-conformant script is rejected with 400) → invoke the registered tool →
 * check the answer. The suite passes when at least MIN_PASSES of RUNS runs
 * succeed, and prints a scoreboard-style summary line per run.
 *
 * OFF BY DEFAULT — it spends tokens and needs an API key. Enable with:
 *   PENGUIN_BENCHMARK=1 DEEPSEEK_API_KEY=sk-... pnpm test:benchmark
 * Optional: DEEPSEEK_BASE_URL (default https://api.deepseek.com),
 *           DEEPSEEK_MODEL (default deepseek-v4-flash).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthorPrompt, extractScript } from "../src/hot/author.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const API_KEY = process.env.DEEPSEEK_API_KEY;
const ENABLED = process.env.PENGUIN_BENCHMARK === "1" && API_KEY !== undefined;
const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";

const RUNS = 3;
const MIN_PASSES = 2;

/** Shared with the authoring endpoint: one spec, one benchmark, no drift. */
const TASK = `register ONE tool named "word-count" whose run({ text }) returns
{ count: <number of whitespace-separated words in text> }.`;

async function askDeepseek(): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: buildAuthorPrompt(TASK) }],
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`deepseek API ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { choices: { message: { content: string } }[] };
  return body.choices[0]!.message.content;
}

describe.skipIf(!ENABLED)("agent benchmark: hot-skill-authoring (deepseek v4 flash)", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    const admin = await loginAdmin(t.app);
    api = apiClient(t.app, admin.cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it(
    `authors a conformant script in ≥${MIN_PASSES}/${RUNS} runs`,
    { timeout: 300_000 },
    async () => {
      let passes = 0;
      for (let run = 1; run <= RUNS; run++) {
        const id = `bench_${run}`;
        let verdict = "pass";
        try {
          const script = extractScript(await askDeepseek());
          const installed = await api.post("/api/hot/skills", { id, script });
          if (installed.status !== 201) {
            verdict = `install ${installed.status}: ${JSON.stringify(await installed.json())}`;
          } else {
            const invoked = await api.post("/api/hot/tools/word-count/invoke", {
              input: { text: "  the quick   brown fox  " },
            });
            const result = (await invoked.json()) as { result?: { count?: unknown } };
            if (invoked.status !== 200) verdict = `invoke ${invoked.status}`;
            else if (result.result?.count !== 4) {
              verdict = `wrong answer: ${JSON.stringify(result.result)}`;
            }
          }
        } catch (err) {
          verdict = `error: ${err instanceof Error ? err.message : String(err)}`;
        }
        if (verdict === "pass") passes += 1;
        // Scoreboard-style line, one per run (see docs/self-improvement §
        // "Benchmark storage" for the on-disk sibling of this format).
        console.log(`[hot-skill-authoring] model=${MODEL} run=${run}/${RUNS} verdict=${verdict}`);
        // The tool name is shared across runs: clean up for the next attempt.
        await api.delete(`/api/hot/skills/${id}`);
      }
      console.log(`[hot-skill-authoring] score=${passes}/${RUNS} (min ${MIN_PASSES})`);
      expect(passes).toBeGreaterThanOrEqual(MIN_PASSES);
    },
  );
});
