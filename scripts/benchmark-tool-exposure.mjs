#!/usr/bin/env node

/**
 * Reproducible offline benchmark for direct versus fixed-gateway tool exposure.
 *
 * It intentionally uses PenguinHarness's production schema mapper, token estimator, search
 * definition, and catalog ranker. It does not call a model or network endpoint, so it measures
 * the deterministic part of the tradeoff: schema input size and catalog recall. Agent success,
 * latency, and billed tokens still require the separate live A/B evaluation protocol.
 *
 * Usage:
 *   pnpm benchmark:tool-exposure
 *   pnpm benchmark:tool-exposure -- --json
 *   pnpm benchmark:tool-exposure -- --check
 */
import { McpToolProvider, searchToolCatalog } from "../packages/core/dist/index.js";
import {
  curatedTools,
  retrievalCases,
  schemaTokens,
  syntheticTools,
} from "./lib/tool-exposure-fixtures.mjs";

const countsArg = process.argv.find((arg) => arg.startsWith("--counts="));
const counts = (countsArg?.slice("--counts=".length) ?? "10,50,100")
  .split(",")
  .map(Number)
  .filter((value) => Number.isInteger(value) && value > 0);
if (counts.length === 0) throw new Error("--counts must contain positive integers");

const gatewayTools = await new McpToolProvider([], { exposure: "lazy" }).listTools();
const gatewayTokens = schemaTokens(gatewayTools);
const gatewaySurface = JSON.stringify(gatewayTools);
const rows = counts.map((count) => {
  const tools = syntheticTools(count);
  const directTokens = schemaTokens(tools);
  return {
    tools: count,
    direct_tokens: directTokens,
    gateway_tokens: gatewayTokens,
    gateway_saved_pct: Number(((1 - gatewayTokens / directTokens) * 100).toFixed(1)),
    gateway_surface_stable: JSON.stringify(gatewayTools) === gatewaySurface,
  };
});

const catalog = curatedTools.map((definition) => ({
  definition,
  metadata: null,
  aliases: definition.name.split("__").slice(1),
}));
const retrieval = retrievalCases.map(([query, target]) => {
  const matches = searchToolCatalog(catalog, query, 5).map((match) => match.definition.name);
  return {
    query,
    target,
    rank: matches.indexOf(target) + 1 || null,
    matches,
  };
});
const recallAt1 = retrieval.filter((item) => item.rank === 1).length / retrieval.length;
const recallAt5 =
  retrieval.filter((item) => item.rank !== null && item.rank <= 5).length / retrieval.length;
const result = {
  methodology: {
    token_estimator: "PenguinHarness approximateTokens over production AgentHub tool schemas",
    synthetic_schema_fields: 5,
    gateway_surface_tools: gatewayTools.map((tool) => tool.name),
    gateway_surface_changes_after_search: 0,
    network_requests: 0,
  },
  schema: rows,
  retrieval: {
    cases: retrieval.length,
    recall_at_1: Number(recallAt1.toFixed(3)),
    recall_at_5: Number(recallAt5.toFixed(3)),
    failures: retrieval.filter((item) => item.rank === null),
  },
};

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write("Offline tool-exposure benchmark (fixed gateway)\n\n");
  process.stdout.write("Tools  Direct tokens  Gateway tokens  Saved  Stable surface\n");
  for (const row of rows) {
    process.stdout.write(
      `${String(row.tools).padStart(5)}  ${String(row.direct_tokens).padStart(13)}  ` +
        `${String(row.gateway_tokens).padStart(14)}  ` +
        `${`${row.gateway_saved_pct}%`.padStart(6)}  ` +
        `${String(row.gateway_surface_stable).padStart(14)}\n`,
    );
  }
  process.stdout.write(
    `\nCatalog retrieval: recall@1 ${(recallAt1 * 100).toFixed(1)}%, ` +
      `recall@5 ${(recallAt5 * 100).toFixed(1)}% (${retrieval.length} curated queries).\n`,
  );
  process.stdout.write(
    "This benchmark does not claim Agent success, latency, or billed-token improvements; " +
      "those require live A/B runs.\n",
  );
}

if (process.argv.includes("--check")) {
  const largeCatalogRows = rows.filter((row) => row.tools >= 50);
  const failed =
    largeCatalogRows.length === 0 ||
    largeCatalogRows.some((row) => row.gateway_saved_pct < 90 || !row.gateway_surface_stable) ||
    recallAt5 < 0.95;
  if (failed) process.exitCode = 1;
}
