/**
 * Hot-script loading: the eval + context contract.
 *
 * A hot script is the BODY of a strict-mode JS function receiving `context`;
 * evaluating it (new Function) and CALLING it with the context is what yields
 * the contract object used for everything afterwards — the object, not the
 * source, is the unit the system operates on. The object is validated with
 * arktype; validation failures surface as ScriptContractError, which the HTTP
 * layer maps to 400 bad_request.
 *
 * Example script (what an LLM is asked to produce in the agent benchmark):
 *
 *   return {
 *     name: "word-count",
 *     version: 1,
 *     setup(ctx) {
 *       ctx.registerTool({
 *         name: "word-count",
 *         description: "Counts words in `text`.",
 *         run: (input) => ({ count: String(input.text).trim().split(/\s+/).length }),
 *       });
 *     },
 *   };
 */
import { type } from "arktype";

export class ScriptContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptContractError";
  }
}

/** Evaluates a hot script (a function body) with the given context. */
export function evalHotScript(source: string, context: unknown): unknown {
  let factory: (context: unknown) => unknown;
  try {
    factory = new Function("context", `"use strict";\n${source}`) as typeof factory;
  } catch (err) {
    throw new ScriptContractError(
      `script does not parse as a function body: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    return factory(context);
  } catch (err) {
    throw new ScriptContractError(
      `script threw while evaluating: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** The object a skill script must return (validated with arktype). */
const SkillContract = type({
  name: "string > 0",
  version: "number",
  setup: "Function",
  "park?": "Function",
  "description?": "string",
});

export interface SkillObject {
  name: string;
  version: number;
  setup: (ctx: SkillSetupCtx) => void;
  park?: () => unknown;
  description?: string;
}

export interface SkillSetupCtx {
  registerTool(tool: ToolObject): void;
}

/** The object shape registerTool accepts (validated with arktype). */
const ToolContract = type({
  name: "string > 0",
  description: "string",
  run: "Function",
});

export interface ToolObject {
  name: string;
  description: string;
  run: (input: unknown) => unknown;
}

export function validateSkillObject(value: unknown): SkillObject {
  const out = SkillContract(value);
  if (out instanceof type.errors) {
    throw new ScriptContractError(`skill contract violation: ${out.summary}`);
  }
  return out as unknown as SkillObject;
}

export function validateToolObject(value: unknown): ToolObject {
  const out = ToolContract(value);
  if (out instanceof type.errors) {
    throw new ScriptContractError(`tool contract violation: ${out.summary}`);
  }
  return out as unknown as ToolObject;
}

/**
 * Dry validation for the API boundary: evaluate with an inert context and
 * check the contract WITHOUT running setup (no registrations happen), so a
 * bad script is rejected with 400 before any state is touched.
 */
export function validateSkillScript(source: string, state: unknown = null): SkillObject {
  return validateSkillObject(evalHotScript(source, { state }));
}
