<!-- English | [简体中文](README.zh.md) -->

# Example: an Agent that builds another Agent (local, on an AMD GPU via Ollama)

This example is the **"Harness for Building Agents"** pillar in runnable code. Using only the
PenguinHarness SDK, it:

1. **builds** a brand-new agent (`commit-helper`) by driving `default_agent` with the
   `agent-creation` skill from a plain-language requirement, then
2. **runs** that freshly-created agent to prove the generated `AGENTS.md` actually shapes its
   behavior (it writes a Conventional Commits message).

Everything runs on a **local open-weight model** — `qwen3.6:35b` served by Ollama — so no cloud
API and no data leaving the machine. Ollama's ROCm backend runs this natively on AMD GPUs
(from Radeon PRO workstation cards up to Instinct accelerators).

## 1. Serve the model locally with Ollama

```bash
# Ollama detects an AMD GPU (ROCm) automatically; pin a specific card if you like:
export HIP_VISIBLE_DEVICES=0
ollama serve &          # if not already running as a service
ollama pull qwen3.6:35b
```

## 2. Point PenguinHarness at it (once)

```bash
penguin config model add \
  --model-id qwen3.6:35b \
  --provider custom --client-type openai \
  --base-url http://localhost:11434/v1 \
  --api-key ollama --set-default
```

This writes the model into `~/.penguin/data/default_project/.project_config.toml`. The example
uses the project's default model, so no model id is hard-coded in the script.

## 3. Run the example

From the repo root (build the workspace first so `@prismshadow/penguin-core` resolves to its
`dist/`):

```bash
pnpm install
pnpm build
pnpm --dir examples/build-agent-with-agent start
# or directly:  npx tsx examples/build-agent-with-agent/build-agent.ts
```

## What you should see

- **Phase 1** — `default_agent` scaffolds `agents/commit-helper/` under the project: its
  directory layout, a copied `system_config.yaml` (with name + description), and an `AGENTS.md`
  encoding the Conventional Commits rules.
- **Phase 2** — the new `commit-helper` agent, following only that generated `AGENTS.md`,
  produces something like:

  ```text
  fix(payment): add retry-with-backoff for transient gateway 503 errors

  Transient 503 responses from the payment gateway were causing checkout
  failures during peak traffic. Retry with exponential backoff gives the
  gateway time to recover, preventing spurious user-facing errors.
  ```

## Notes

- Output quality tracks the model. `qwen3.6:35b` handles this task well; much smaller models
  may not follow the tool-calling protocol reliably.
- A capable model occasionally introduces a mechanical slip when re-serializing the base config
  (e.g. an invalid YAML escape) — every file is plain text and every run is traced, so such
  slips are quick to spot and fix. This is the realistic shape of "agents building agents":
  the requirement→`AGENTS.md` heavy lifting is automated; a human reviews the mechanical edges.
- Re-running Phase 1 will update the existing `commit-helper` agent in place.
