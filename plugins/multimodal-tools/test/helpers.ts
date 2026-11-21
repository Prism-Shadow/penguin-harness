/**
 * The boundaries the plugin's server module sits between, for its tests: the model (a scripted
 * ProjectModelRequests that records every request), the Project's bindings and model table, a
 * data root in a temporary directory, and the host's command runner — a commander program built
 * per run with the plugin's code halves on their keys, as the server's PluginCliCommandsProvider
 * builds one.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command, CommanderError } from "commander";
import type {
  CliCommandCaller,
  CliCommandCode,
  CliCommandProgram,
} from "@prismshadow/penguin-core/cli";
import type { ProjectModelRequest } from "@prismshadow/penguin-core";
import type { UniEvent } from "@prismshadow/mmsp";
import { cancelCommand, listCommand, operationCommand, statusCommand } from "../src/cli.js";
import type {
  BindingView,
  ModelBindings,
  ModelRef,
  ModelRequests,
  ModelRequestScope,
  ProjectModels,
} from "../src/host.js";
import { OPERATIONS } from "../src/operations.js";
import { Tools } from "../src/tools.js";

/** One request the model received. */
export interface Received {
  scope: ModelRequestScope;
  model: ModelRef;
  request: ProjectModelRequest;
}

/** How the model answers one request: these events, or nothing until the request is stopped. */
export type Reply = { events: UniEvent[] } | { hang: true };

/** The events of an answer carrying these content items and this usage. */
export function answer(
  items: UniEvent["content_items"],
  usage: UniEvent["usage_metadata"] = null,
): Reply {
  return {
    events: [
      {
        role: "assistant",
        event_type: "delta",
        content_items: items,
        usage_metadata: null,
        finish_reason: null,
      },
      {
        role: "assistant",
        event_type: "stop",
        content_items: [],
        usage_metadata: usage,
        finish_reason: "stop",
      },
    ] as UniEvent[],
  };
}

/** A scripted model: answers each request with `reply(request)` and keeps every request it got. */
export function scriptedModel(
  reply: (r: Received) => Reply,
): ModelRequests & { received: Received[] } {
  const received: Received[] = [];
  return {
    received,
    async *stream(scope, model, request) {
      const r = { scope, model, request: request as ProjectModelRequest };
      received.push(r);
      const out = reply(r);
      if ("hang" in out) {
        // As the host's stream does: a caller's abort ends it quietly.
        await new Promise<void>((resolve) => {
          if (r.request.signal?.aborted) resolve();
          r.request.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return;
      }
      for (const event of out.events) yield event;
    },
  };
}

/** A Project's bindings: the models bound by key, each listed with this plugin's package. */
export function bindings(bound: Record<string, ModelRef>): ModelBindings {
  return {
    get: async (_projectId, key) => bound[key],
    list: async () =>
      OPERATIONS.filter((op) => op !== "i2t").map((key): BindingView => ({
        key,
        title: { en: `${key} title`, zh: `${key} 标题` },
        package: "@penguinharness/multimodal-tools",
        ...(bound[key] !== undefined ? { model: bound[key] } : {}),
        candidates: [],
      })),
  };
}

/** A Project's model table: its vision and default chat models and the rows' client types. */
export function modelTable(
  rows: { provider: string; modelId: string; clientType?: string }[],
  visionModel?: ModelRef,
  defaultModel?: ModelRef,
): ProjectModels {
  return {
    getModels: async () => ({
      ...(defaultModel !== undefined ? { defaultModel } : {}),
      ...(visionModel !== undefined ? { visionModel } : {}),
      models: rows.map(({ clientType, ...ref }) => ({
        ...ref,
        effective: clientType !== undefined ? { clientType } : {},
      })),
    }),
  };
}

export async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "multimodal-tools-"));
}

/** What one command run printed, handed back and exited with. */
export interface CliRun {
  stdout: string;
  stderr: string;
  exitCode: number;
  files: { name: string; mimeType?: string; data: Uint8Array }[];
}

/** The plugin's commands on their keys, as the server registers them. */
function commandsOf(tools: Tools): [string, CliCommandCode][] {
  const get = () => tools;
  return [
    ...OPERATIONS.map((op): [string, CliCommandCode] => [`tools.${op}`, operationCommand(get, op)]),
    ["tools.list", listCommand(get)],
    ["tools.status", statusCommand(get)],
    ["tools.cancel", cancelCommand(get)],
  ];
}

/** Runs one `penguin tools …` command line for a caller, with the files the terminal would send. */
export async function runCli(
  tools: Tools,
  argv: string[],
  caller: CliCommandCaller,
  sent: Record<string, { name: string; data: Uint8Array }> = {},
): Promise<CliRun> {
  const run: CliRun = { stdout: "", stderr: "", exitCode: 0, files: [] };
  let exitCode: number | undefined;
  const program = new Command()
    .name("penguin")
    .exitOverride()
    .configureOutput({
      writeOut: (t) => void (run.stdout += t),
      writeErr: (t) => void (run.stderr += t),
    });
  for (const [key, code] of commandsOf(tools)) {
    let node = program;
    for (const segment of key.split(".")) {
      node = node.commands.find((c) => c.name() === segment) ?? node.command(segment);
    }
    code.register(node as unknown as CliCommandProgram, {
      messages: { language: "en" },
      stdout: { write: (t) => void (run.stdout += t) },
      stderr: { write: (t) => void (run.stderr += t) },
      exit: (c) => void (exitCode = c),
      caller,
      input: (value) => sent[value],
      output: (file) => void run.files.push(file),
    });
  }
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (err) {
    if (!(err instanceof CommanderError)) throw err;
    exitCode = err.exitCode;
  }
  run.exitCode = exitCode ?? 0;
  return run;
}

/** A 16 kHz mono 16-bit PCM WAV of four samples. */
export const WAV = Buffer.from(
  "524946462c00000057415645666d74201000000001000100803e0000007d000002001000646174610800000000000100ffff0000",
  "hex",
);

/** The first bytes of a PNG file. */
export const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
