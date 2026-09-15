/**
 * Argument handling shared by the built-in tools: reading an argument that may arrive under
 * more than one name, and explaining a call whose arguments do not fit the tool.
 *
 * Environment parses the argument JSON and hands each tool a plain object; whether that
 * object fits is the tool's own check, and a failed check ends the call with
 * `stop_reason: fatal` and the explanation built here as its whole output. The explanation
 * is written for the model that made the call, which has to repair the call from the tool
 * output alone: it names the fault, lists the argument names actually received and calls
 * out the ones the tool does not know, restates the tool's parameters from the schema the
 * model was handed, and closes with the shape of a correct call. Without the restatement a
 * model that misnamed one argument tends to re-issue the same call unchanged — it believes
 * it followed the schema, and a one-line "missing argument" gives it nothing to compare
 * against.
 *
 * The closing line repeats the tool and argument names on purpose: the server's error
 * ledger keeps the **tail** of a failed tool's output (see the server's
 * stream-error-watcher), so the tail has to say what went wrong on its own.
 * Docs: /docs/tools § "Execution contract".
 */
import type { ToolDefinitionConfig } from "../../interfaces/index.js";

/** A string argument as read from a call: the name it arrived under and its value. */
export interface StringArgument {
  name: string;
  value: string;
}

/**
 * The first of `names` that carries a string in `args`, with its value; undefined when none
 * does. `names` is in priority order — the schema name first, then any alias — so a call
 * carrying several is read the same way by every consumer: the tool that runs the value and
 * the command policy that screens it see one value, not two.
 */
export function stringArgument(
  args: Record<string, unknown>,
  names: readonly string[],
): StringArgument | undefined {
  for (const name of names) {
    const value = args[name];
    if (typeof value === "string") return { name, value };
  }
  return undefined;
}

/** What is wrong with one argument of a call. */
export type ArgumentFault =
  /**
   * A required argument the tool cannot proceed without. The explanation reads `args` to say
   * whether it is absent, of the wrong type, or empty.
   */
  | { argument: string; kind: "missing" }
  /**
   * An argument that is present but unusable; `detail` states the requirement and what
   * arrived, without a trailing period, e.g. `expected a positive number (got 0)`.
   */
  | { argument: string; kind: "invalid"; detail: string };

export interface ArgumentErrorOptions {
  /**
   * Names accepted for a parameter beyond its schema name (exec_command's `command` for
   * `cmd`): not reported as unrecognized, and listed beside the parameter.
   */
  aliases?: Readonly<Record<string, readonly string[]>>;
  /** Guidance appended to the fault sentence, e.g. which tool to use instead. */
  hint?: string;
}

/** One parameter as the tool's schema declares it. */
interface SchemaParameter {
  name: string;
  type: string;
  required: boolean;
  description: string | undefined;
}

/**
 * The parameters declared by the definition's JSON schema, in declaration order (the order
 * the model was shown). Empty when the definition carries no schema or no properties.
 */
function schemaParameters(definition: ToolDefinitionConfig): SchemaParameter[] {
  const params = definition.parameters;
  const properties = params?.["properties"];
  if (properties === null || typeof properties !== "object") return [];
  const required = params?.["required"];
  const requiredNames = new Set(
    Array.isArray(required) ? required.filter((n): n is string => typeof n === "string") : [],
  );
  return Object.entries(properties as Record<string, unknown>).map(([name, schema]) => {
    const s =
      schema !== null && typeof schema === "object" ? (schema as Record<string, unknown>) : {};
    return {
      name,
      type: schemaType(s["type"]),
      required: requiredNames.has(name),
      description: typeof s["description"] === "string" ? s["description"] : undefined,
    };
  });
}

/** A schema `type` as prose: a name, a union of names, or `any` when the schema states none. */
function schemaType(type: unknown): string {
  if (typeof type === "string") return type;
  if (Array.isArray(type)) {
    const names = type.filter((t): t is string => typeof t === "string");
    if (names.length > 0) return names.join(" | ");
  }
  return "any";
}

/** The type of a received value, as prose with its article: `a number`, `an array`, `null`. */
function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  switch (typeof value) {
    case "string":
      return "a string";
    case "number":
      return "a number";
    case "boolean":
      return "a boolean";
    case "object":
      return "an object";
    default:
      return typeof value;
  }
}

/** Prefixes a type name with its article: `a string`, `an integer`. */
function withArticle(type: string): string {
  return /^[aeiou]/i.test(type) ? `an ${type}` : `a ${type}`;
}

/** A placeholder value of the parameter's type for the example call. */
function placeholder(parameter: SchemaParameter): string {
  switch (parameter.type) {
    case "number":
    case "integer":
      return "0";
    case "boolean":
      return "false";
    case "array":
      return "[]";
    case "object":
      return "{}";
    default:
      return `"<${parameter.name}>"`;
  }
}

/**
 * The sentence naming the fault: which argument, and — for a missing one — whether it is
 * absent, arrived under the wrong type, or is empty. When the argument arrived under an
 * alias, the sentence says so, so the model can map the schema name to what it sent.
 */
function faultSentence(
  fault: ArgumentFault,
  args: Record<string, unknown>,
  parameters: SchemaParameter[],
  aliases: Readonly<Record<string, readonly string[]>>,
): string {
  const quoted = `"${fault.argument}"`;
  if (fault.kind === "invalid") {
    return `argument ${quoted} is invalid: ${fault.detail}.`;
  }
  const present = [fault.argument, ...(aliases[fault.argument] ?? [])].find((n) => n in args);
  if (present === undefined) return `required argument ${quoted} is missing.`;
  const as = present === fault.argument ? "" : ` (received as "${present}")`;
  const value = args[present];
  const expected = parameters.find((p) => p.name === fault.argument)?.type ?? "string";
  // A string where a string was wanted is only ever rejected for being blank; a string where
  // a number or a boolean was wanted is the wrong type, blank or not.
  if (typeof value === "string" && (expected === "string" || value.trim() === "")) {
    return `required argument ${quoted}${as} is empty.`;
  }
  if (expected === "any") {
    // A hand-edited schema property with no `type`: there is no type to hold the value against.
    return `argument ${quoted}${as} cannot be used as received (${typeName(value)}).`;
  }
  return `argument ${quoted}${as} must be ${withArticle(expected)}, but ${typeName(value)} was received.`;
}

/**
 * The argument names the call carried, with the ones the schema does not declare (and no
 * alias covers) called out — the line a misnamed argument is caught by. Without a schema
 * there is nothing to judge names against, so only the names are listed.
 */
function receivedLine(
  tool: string,
  args: Record<string, unknown>,
  parameters: SchemaParameter[],
  aliases: Readonly<Record<string, readonly string[]>>,
): string {
  const names = Object.keys(args);
  if (names.length === 0) return "Arguments received: none.";
  let line = `Arguments received: ${names.join(", ")}.`;
  if (parameters.length > 0) {
    const known = new Set(parameters.map((p) => p.name));
    for (const list of Object.values(aliases)) for (const alias of list) known.add(alias);
    const unknown = names.filter((n) => !known.has(n));
    if (unknown.length > 0) {
      const noun = unknown.length === 1 ? "a parameter" : "parameters";
      line += ` Not ${noun} of ${tool}: ${unknown.join(", ")}.`;
    }
  }
  return line;
}

/** One line of the parameter list: name, type, required or optional, aliases, description. */
function parameterLine(parameter: SchemaParameter, aliases: readonly string[] | undefined): string {
  const facts = [parameter.type, parameter.required ? "required" : "optional"].join(", ");
  const alias =
    aliases !== undefined && aliases.length > 0
      ? `; also accepted as ${aliases.map((a) => `"${a}"`).join(", ")}`
      : "";
  const head = `- ${parameter.name} (${facts}${alias})`;
  return parameter.description === undefined ? head : `${head}: ${parameter.description}`;
}

/**
 * The closing instruction: call again with the faulted argument fixed, as one JSON object
 * under the schema's names, with an example carrying every required parameter plus the
 * faulted one. Names the tool and the argument so the tail of the output says what went wrong.
 */
function closingLine(tool: string, fault: ArgumentFault, parameters: SchemaParameter[]): string {
  const fix =
    fault.kind === "missing"
      ? `with "${fault.argument}" provided`
      : `with a valid "${fault.argument}"`;
  const shown = parameters.filter((p) => p.required || p.name === fault.argument);
  if (shown.length === 0) {
    return `Call ${tool} again ${fix}, as one JSON object using the tool's parameter names.`;
  }
  const example = `{${shown.map((p) => `"${p.name}": ${placeholder(p)}`).join(", ")}}`;
  return `Call ${tool} again ${fix}, as one JSON object using exactly these parameter names, e.g. ${example}.`;
}

/**
 * The whole output of a call rejected for its arguments (see the module header for what it
 * carries and why). `definition` is the entry the tool was assembled from — the same schema
 * the model was handed, `call_description` filtering included — so the restated parameter
 * list is exactly what the model can send.
 */
export function describeArgumentError(
  definition: ToolDefinitionConfig,
  args: Record<string, unknown>,
  fault: ArgumentFault,
  options: ArgumentErrorOptions = {},
): string {
  const tool = definition.name;
  const parameters = schemaParameters(definition);
  const aliases = options.aliases ?? {};
  const hint = options.hint === undefined ? "" : ` ${options.hint}`;
  const lines = [
    `${tool} was not run: ${faultSentence(fault, args, parameters, aliases)}${hint}`,
    receivedLine(tool, args, parameters, aliases),
  ];
  if (parameters.length > 0) {
    lines.push(`Parameters of ${tool}:`);
    for (const parameter of parameters)
      lines.push(parameterLine(parameter, aliases[parameter.name]));
  }
  lines.push(closingLine(tool, fault, parameters));
  return lines.join("\n");
}
