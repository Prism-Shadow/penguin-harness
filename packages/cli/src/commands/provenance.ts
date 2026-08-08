/**
 * `penguin provenance` — prints an Agent's content-derived reproducibility fingerprint.
 *
 *   penguin provenance [--agent-id <id>] [--project-id <id>] [--root <dir>]
 *                      [--provider <p> --model-id <m>] [--format yaml|json]
 *
 * This is the deterministic capture path the self-evolution skills call: `agent-optimization`
 * runs it against the Test Agent before writing a scoreboard record, and embeds the returned
 * block as that evaluation's `provenance:` field. An LLM cannot reliably compute sha256, so the
 * fingerprint must come from code — hence a CLI command rather than a skill instruction.
 *
 * Output goes to stdout only (no logs), so a skill can consume it verbatim; `--format yaml`
 * (default) drops straight into scoreboard.yaml, `--format json` is available for programmatic use.
 * Docs: /docs/cli § "penguin provenance".
 */
import path from "node:path";
import type { Command } from "commander";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  buildAgentProvenance,
  loadOrInitAgentState,
  resolveRoot,
  type ProvenanceModelRef,
} from "@prismshadow/penguin-core";
import { stringify as stringifyYaml } from "yaml";
import type { Messages } from "../i18n.js";

function resolveRootOption(root: string | undefined): string {
  return root !== undefined ? path.resolve(root) : resolveRoot();
}

export function registerProvenanceCommand(program: Command, t: Messages): void {
  program
    .command("provenance")
    .description(t.provenance.desc)
    .option("--agent-id <id>", t.common.agentId, DEFAULT_AGENT_ID)
    .option("--project-id <id>", t.common.projectId, DEFAULT_PROJECT_ID)
    .option("--provider <group>", t.provenance.provider)
    .option("--model-id <id>", t.provenance.modelId)
    .option("--format <fmt>", t.provenance.format, "yaml")
    .option("--root <dir>", t.common.root)
    .action(async (opts) => {
      const root = resolveRootOption(opts.root);
      // A model reference is always the complete (provider, model_id) pair — reject a lone half.
      if ((opts.provider === undefined) !== (opts.modelId === undefined)) {
        throw new Error("--provider and --model-id must be given together (a model is a pair).");
      }
      const model: ProvenanceModelRef | undefined =
        opts.provider !== undefined && opts.modelId !== undefined
          ? { provider: opts.provider, model_id: opts.modelId }
          : undefined;

      const state = await loadOrInitAgentState({
        root,
        projectId: opts.projectId,
        agentId: opts.agentId,
      });
      const provenance = await buildAgentProvenance(state, model ? { model } : undefined);

      const format = String(opts.format).toLowerCase();
      if (format === "json") {
        process.stdout.write(`${JSON.stringify(provenance, null, 2)}\n`);
      } else if (format === "yaml") {
        process.stdout.write(stringifyYaml(provenance));
      } else {
        throw new Error(`Unknown --format ${JSON.stringify(opts.format)}: expected yaml or json.`);
      }
    });
}
