/**
 * A stored workflow script, evaluated into the extension seam's own currency.
 *
 * An installed workflow is a workflow FACTORY source: the script's body runs once per
 * App creation and returns an object satisfying the contract below, which this module
 * wraps as a {@link WorkflowFactory} (see ../extension/index.ts). Installed workflows and
 * extension-registered ones therefore enter the harness through exactly one door — the
 * `iface.workflow` map — and a hot swap rebuilds both the same way, so neither can
 * carry a half-built instance across.
 *
 * The script is evaluated with `new Function`, not imported: it arrives over HTTP as a
 * string and has no module identity to cache-bust. It runs in this process with this
 * process's authority — installing one is an admin action for that reason.
 */
import { type } from "@prismshadow/penguin-core/kernel";
import type { WorkflowFactory, WorkflowInstance } from "../extension/index.js";

export class ScriptContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptContractError";
  }
}

/** What a stored script must return. `run` is the only member the seam calls. */
export interface WorkflowObject {
  name: string;
  version: number;
  run(input: unknown): unknown;
}

const WorkflowContract = type({
  name: "string > 0",
  version: "number",
  run: "Function",
});

/**
 * Parses and runs the script's body once to check the contract, and returns a factory
 * that re-runs it per App creation. Failing here is how a malformed script is refused at
 * INSTALL time rather than at the next boot, where it would break an unrelated push.
 */
export function workflowFactoryFrom(script: string): { factory: WorkflowFactory; name: string } {
  const built = evaluateScript(script);
  return {
    name: built.name,
    factory: (): WorkflowInstance => {
      const fresh = evaluateScript(script);
      return { run: (input) => fresh.run(input) };
    },
  };
}

function evaluateScript(script: string): WorkflowObject {
  let body: () => unknown;
  try {
    body = new Function(`"use strict";\n${script}`) as typeof body;
  } catch (err) {
    throw new ScriptContractError(`script does not parse as a function body: ${detail(err)}`);
  }
  let value: unknown;
  try {
    value = body();
  } catch (err) {
    throw new ScriptContractError(`script threw while evaluating: ${detail(err)}`);
  }
  const out = WorkflowContract(value);
  if (out instanceof type.errors) {
    throw new ScriptContractError(`workflow contract violation: ${out.summary}`);
  }
  return out as unknown as WorkflowObject;
}

const detail = (err: unknown): string => (err instanceof Error ? err.message : String(err));
