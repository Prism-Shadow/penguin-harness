/**
 * `penguin tools …`: this plugin's member commands (PRFC-0024), run in the server for the caller's
 * Project and Session, which the run request names and the host checked (`ctx.caller`).
 *
 * Local files never reach the server as paths. A file an operation reads is an option the command
 * declares in `files.read` (`--image`, `--audio`): the terminal reads it and sends its bytes, and
 * the command takes them with `ctx.input`. What an operation generates goes back with `ctx.output`,
 * and the terminal saves it under `--out` (`files.write`), else in the current directory.
 *
 * A run waits for its model (up to ATTACHED_WAIT_MS inside a Session, where a longer one goes on
 * and `penguin tools status <id>` finds it later); `--detach` returns its id at once, which only a
 * Session can do, since only a Session keeps a run's result.
 */
import type { CliCommandCode, CliCommandContext } from "@prismshadow/penguin-core/cli";
import { badInput, errorFields, ToolError } from "./errors.js";
import { typeByName } from "./media.js";
import type { Operation, OperationInput } from "./operations.js";
import type { Finished, RunRecord } from "./runs.js";
import { stringsFor, type Strings } from "./strings.js";
import type { Tools } from "./tools.js";

/** How long a run in a Session keeps its caller waiting before it goes on by itself. */
export const ATTACHED_WAIT_MS = 240_000;

/** The part of commander's Command a code half uses (the host's commander builds the node). */
interface CommandNode {
  argument(name: string, description?: string): CommandNode;
  option(flags: string, description?: string): CommandNode;
  requiredOption(flags: string, description?: string): CommandNode;
  action(fn: (...args: unknown[]) => void | Promise<void>): CommandNode;
}

type Ctx = CliCommandContext;
type Options = Record<string, string | boolean | undefined>;

/** The caller's Project and Session: a member command always has the first. */
function scope(ctx: Ctx): { projectId: string; sessionId?: string } {
  const projectId = ctx.caller?.projectId;
  if (projectId === undefined)
    throw new ToolError(400, "project_required", "This command runs in a Project.");
  return {
    projectId,
    ...(ctx.caller?.sessionId !== undefined ? { sessionId: ctx.caller.sessionId } : {}),
  };
}

/** Runs a command body: a refusal or failure is one `error:` line, exit 2 for bad input, else 1. */
async function guarded(ctx: Ctx, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (err) {
    const { status, message } = errorFields(err);
    ctx.stderr.write(`error: ${message}\n`);
    ctx.exit(status === 400 ? 2 : 1);
  }
}

/** A number option's value, or a 400. */
function numberOption(value: string | boolean | undefined, flag: string): number | undefined {
  if (value === undefined || typeof value === "boolean") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw badInput(`${flag} takes a number.`);
  return n;
}

/** A file the terminal sent for an option, with its type: `--mime-type`, else its extension. */
function sentFile(
  ctx: Ctx,
  flag: string,
  value: string | boolean | undefined,
  mimeType: string | boolean | undefined,
) {
  if (typeof value !== "string") throw badInput(`${flag} names the local file to send.`);
  const file = ctx.input?.(value);
  if (file === undefined) throw badInput(`The terminal sent no file for ${flag} ${value}.`);
  const type = typeof mimeType === "string" ? mimeType : (file.mimeType ?? typeByName(file.name));
  if (type === undefined) throw badInput(`Name the type of ${file.name} with --mime-type.`);
  return { data: file.data, mimeType: type };
}

/** The run, printed: JSON, or the text, the sources or the generated files' names. */
function printRun(ctx: Ctx, record: RunRecord, json: boolean): void {
  if (json) {
    ctx.stdout.write(`${JSON.stringify(record)}\n`);
    return;
  }
  const blocks = [
    ...(record.text !== undefined ? [record.text] : []),
    ...(record.sources ?? []).map((s) => [s.title, s.url, s.content].join("\n")),
    ...record.files.map((f) => f.name),
  ];
  if (record.status === "running") blocks.push(record.id);
  if (blocks.length > 0) ctx.stdout.write(`${blocks.join("\n\n")}\n`);
}

/** A finished run's outcome: its files handed back, printed, and a failure's exit code. */
function report(ctx: Ctx, finished: Finished, json: boolean): void {
  const { record, files } = finished;
  if (record.status !== "completed") {
    if (json) printRun(ctx, record, true);
    ctx.stderr.write(`error: ${record.error ?? `The run ${record.status}.`}\n`);
    ctx.exit(1);
    return;
  }
  for (const file of files)
    ctx.output?.({ name: file.name, mimeType: file.mimeType, data: file.data });
  printRun(ctx, record, json);
}

/** An operation's input from its operand and options. */
function inputOf(
  ctx: Ctx,
  op: Operation,
  operand: string[] | string | undefined,
  opts: Options,
): OperationInput {
  const words = Array.isArray(operand) ? operand.join(" ") : operand;
  const str = (v: string | boolean | undefined) => (typeof v === "string" ? v : undefined);
  switch (op) {
    case "i2t":
      return {
        image: sentFile(ctx, "--image", opts.image, opts.mimeType),
        ...(str(opts.prompt) !== undefined ? { text: str(opts.prompt)! } : {}),
      };
    case "s2t":
      return { audio: sentFile(ctx, "--audio", opts.audio, opts.mimeType) };
    case "fetch":
      return { ...(words !== undefined ? { url: words } : {}) };
    default: {
      const count = numberOption(opts.count, "--count");
      const duration = numberOption(opts.duration, "--duration");
      return {
        ...(words !== undefined ? { text: words } : {}),
        ...(count !== undefined ? { count } : {}),
        ...(duration !== undefined ? { duration } : {}),
        ...(str(opts.voice) !== undefined ? { voice: str(opts.voice)! } : {}),
        ...(str(opts.aspectRatio) !== undefined ? { aspectRatio: str(opts.aspectRatio)! } : {}),
        ...(str(opts.resolution) !== undefined ? { resolution: str(opts.resolution)! } : {}),
      };
    }
  }
}

/** Runs one operation for the caller and reports it. */
async function runOperation(
  tools: Tools,
  ctx: Ctx,
  s: Strings,
  op: Operation,
  operand: string[] | string | undefined,
  opts: Options,
) {
  const { projectId, sessionId } = scope(ctx);
  const json = opts.json === true;
  if (opts.detach === true && sessionId === undefined) {
    throw badInput(
      "--detach keeps the run in its Session: run the command inside a Session (PENGUIN_SESSION_ID).",
    );
  }
  const { record, done } = await tools.start(
    projectId,
    sessionId,
    op,
    inputOf(ctx, op, operand, opts),
  );
  if (opts.detach === true) {
    printRun(ctx, record, json);
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited =
    sessionId === undefined
      ? await done
      : await Promise.race([
          done,
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), ATTACHED_WAIT_MS);
          }),
        ]);
  if (timer !== undefined) clearTimeout(timer);
  if (waited === null) {
    printRun(ctx, (await tools.runs.get(projectId, record.id, sessionId)) ?? record, json);
    ctx.stderr.write(s.stillRunning(record.id));
    return;
  }
  report(ctx, waited, json);
}

/** The operand and options each operation declares, beside `--json` and `--detach`. */
function declareOperation(node: CommandNode, op: Operation, s: Strings): CommandNode {
  switch (op) {
    case "t2t":
      node.argument("<text...>", s.text);
      break;
    case "i2t":
      node
        .requiredOption("--image <file>", s.image)
        .option("--prompt <text>", s.question)
        .option("--mime-type <type>", s.mimeType);
      break;
    case "search":
      node.argument("<query...>", s.query).option("--count <n>", s.count);
      break;
    case "fetch":
      node.argument("<url>", s.url);
      break;
    case "t2i":
      node
        .argument("<prompt...>", s.prompt)
        .option("--aspect-ratio <ratio>", s.aspectRatio)
        .option("--resolution <size>", s.imageResolution)
        .option("--out <dir>", s.out);
      break;
    case "t2v":
      node
        .argument("<prompt...>", s.prompt)
        .option("--aspect-ratio <ratio>", s.aspectRatio)
        .option("--resolution <size>", s.videoResolution)
        .option("--duration <seconds>", s.duration)
        .option("--out <dir>", s.out);
      break;
    case "t2s":
      node
        .argument("<text...>", s.speech)
        .option("--voice <name>", s.voice)
        .option("--out <dir>", s.out);
      break;
    case "s2t":
      node.requiredOption("--audio <file>", s.audio).option("--mime-type <type>", s.mimeType);
      break;
  }
  return node.option("--json", s.json).option("--detach", s.detach);
}

/** The code half of `tools.<op>`. */
export function operationCommand(tools: () => Tools, op: Operation): CliCommandCode {
  return {
    register(command, ctx) {
      const s = stringsFor(ctx.messages.language);
      const takesOperand = op !== "i2t" && op !== "s2t";
      declareOperation(command as unknown as CommandNode, op, s).action(
        async (...args: unknown[]) => {
          const operand = takesOperand ? (args[0] as string[] | string) : undefined;
          const opts = (takesOperand ? args[1] : args[0]) as Options;
          await guarded(ctx, () => runOperation(tools(), ctx, s, op, operand, opts));
        },
      );
    },
  };
}

/** The code half of `tools.list`: each operation and the model it runs on in the Project. */
export function listCommand(tools: () => Tools): CliCommandCode {
  return {
    register(command, ctx) {
      const s = stringsFor(ctx.messages.language);
      const zh = ctx.messages.language === "zh";
      (command as unknown as CommandNode)
        .option("--json", s.json)
        .action(async (...args: unknown[]) => {
          const opts = args[0] as Options;
          await guarded(ctx, async () => {
            const ops = await tools().operations(scope(ctx).projectId);
            if (opts.json === true) {
              ctx.stdout.write(`${JSON.stringify(ops)}\n`);
              return;
            }
            const lines = ops.map((o) => {
              const model =
                o.model === undefined
                  ? s.noModel
                  : `${o.model.provider} / ${o.model.modelId}${o.via === "default" ? ` ${s.followsDefault}` : ""}`;
              return `${o.operation.padEnd(7)} ${(zh ? o.title.zh : o.title.en).padEnd(28)} ${model}`;
            });
            ctx.stdout.write(`${lines.join("\n")}\n`);
          });
        });
    },
  };
}

/** The code half of `tools.status`: a run of the caller's Session, its files on request. */
export function statusCommand(tools: () => Tools): CliCommandCode {
  return {
    register(command, ctx) {
      const s = stringsFor(ctx.messages.language);
      (command as unknown as CommandNode)
        .argument("<id>", s.runId)
        .option("--out <dir>", s.statusOut)
        .option("--json", s.json)
        .action(async (...args: unknown[]) => {
          const id = args[0] as string;
          const opts = args[1] as Options;
          await guarded(ctx, async () => {
            const { projectId, sessionId } = scope(ctx);
            const t = tools();
            const record = await t.runs.get(projectId, id, sessionId);
            if (record === null)
              throw new ToolError(
                404,
                "run_not_found",
                `No run ${id.slice(0, 64)} in this Session.`,
              );
            if (
              record.status === "completed" &&
              opts.out !== undefined &&
              sessionId !== undefined
            ) {
              for (const file of record.files) {
                const data = await t.store.readFile(projectId, sessionId, file.name);
                if (data === null)
                  throw new ToolError(404, "file_not_found", `${file.name} is no longer stored.`);
                ctx.output?.({ name: file.name, mimeType: file.mimeType, data });
              }
            }
            printRun(ctx, record, opts.json === true);
            if (record.status === "failed" || record.status === "cancelled") {
              ctx.stderr.write(`error: ${record.error ?? `The run ${record.status}.`}\n`);
              ctx.exit(1);
            }
          });
        });
    },
  };
}

/** The code half of `tools.cancel`: stops a run of the caller's Session that is in flight. */
export function cancelCommand(tools: () => Tools): CliCommandCode {
  return {
    register(command, ctx) {
      const s = stringsFor(ctx.messages.language);
      (command as unknown as CommandNode)
        .argument("<id>", s.runId)
        .option("--json", s.json)
        .action(async (...args: unknown[]) => {
          const id = args[0] as string;
          const opts = args[1] as Options;
          await guarded(ctx, async () => {
            const { projectId, sessionId } = scope(ctx);
            const record = await tools().runs.cancel(projectId, id, sessionId);
            if (record === null)
              throw new ToolError(
                404,
                "run_not_running",
                `No run ${id.slice(0, 64)} is in flight in this Session.`,
              );
            printRun(ctx, record, opts.json === true);
          });
        });
    },
  };
}
