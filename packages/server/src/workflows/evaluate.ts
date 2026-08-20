/**
 * A stored workflow script, evaluated into the object the harness drives.
 *
 * The script's body runs once per App creation and returns the contract below. It is
 * evaluated with `new Function`, not imported: it arrives over HTTP as a string and has
 * no module identity to cache-bust. It runs in this process with this process's
 * authority - installing one is an admin action for that reason.
 *
 * Three members beyond `run` carry the capability that makes a workflow more than a
 * callable function:
 *
 *   - `setup` registers TOOLS, which is how a workflow reaches an agent's tool set.
 *   - `run` receives a run context, which is how a workflow reaches back and drives an
 *     agent.
 *   - `park` returns the state that survives a reload, so a workflow can keep something
 *     across the swap that rebuilt it.
 */
import type { Json } from "@prismshadow/penguin-core/kernel";
import { type } from "@prismshadow/penguin-core/kernel";

export class ScriptContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptContractError";
  }
}

/** A tool a workflow contributes to the agent's tool set. */
export interface WorkflowTool {
  name: string;
  description: string;
  run(input: unknown): unknown;
}

/** Where registered tools land. `register` returns its own undo. */
export interface WorkflowToolRegistry {
  register(owner: string, tool: WorkflowTool): () => void;
}

/** What a workflow may do while running. */
export interface WorkflowRunCtx {
  runAgent(prompt: string): Promise<string>;
}

export interface WorkflowObject {
  name: string;
  version: number;
  run(input: unknown, ctx: WorkflowRunCtx): unknown;
  setup?(ctx: { registerTool(tool: WorkflowTool): void }): void;
  park?(): unknown;
}

const WorkflowContract = type({
  name: "string > 0",
  version: "number",
  run: "Function",
  "setup?": "Function",
  "park?": "Function",
});

const ToolContract = type({ name: "string > 0", description: "string", run: "Function" });

/**
 * Runs the script body with its parked state and checks the contract. `state` is what the
 * previous instance's `park()` returned, so a workflow rebuilt by a swap resumes from it.
 */
export function evaluateWorkflow(script: string, state: Json = null): WorkflowObject {
  let factory: (context: { state: Json }) => unknown;
  try {
    factory = new Function("context", `"use strict";\n${script}`) as typeof factory;
  } catch (err) {
    throw new ScriptContractError(`script does not parse as a function body: ${detail(err)}`);
  }
  let value: unknown;
  try {
    value = factory({ state });
  } catch (err) {
    throw new ScriptContractError(`script threw while evaluating: ${detail(err)}`);
  }
  const out = WorkflowContract(value);
  if (out instanceof type.errors) {
    throw new ScriptContractError(`workflow contract violation: ${out.summary}`);
  }
  return out as unknown as WorkflowObject;
}

/** Validates a tool the script offers, so a malformed one is refused at registration. */
export function checkTool(tool: unknown): WorkflowTool {
  const checked = ToolContract(tool);
  if (checked instanceof type.errors) {
    throw new ScriptContractError(`tool contract violation: ${checked.summary}`);
  }
  return checked as unknown as WorkflowTool;
}

/** What `park()` returned, refused unless it can actually be written down. */
export function jsonValue(value: unknown, label: string): Json {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) throw new Error("value is undefined");
    return JSON.parse(text) as Json;
  } catch (err) {
    throw new ScriptContractError(`${label} is not JSON-serializable: ${detail(err)}`);
  }
}

const detail = (err: unknown): string => (err instanceof Error ? err.message : String(err));
