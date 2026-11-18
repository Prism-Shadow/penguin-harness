import { Command, CommanderError } from "commander";
import { isCapability } from "../services/capability-input.js";
import type { AvailableCapability, Capability, CapabilityRunRequest } from "../api/capabilities.js";

interface Options {
  sessionId?: string;
  json?: boolean;
  out?: string;
  detach?: boolean;
  voice?: string;
  count?: number;
  duration?: number;
  resolution?: string;
  aspectRatio?: string;
  mimeType?: string;
}
export type ToolInvocation =
  | { kind: "message"; stdout: string; stderr: string; exitCode: number }
  | { kind: "operation"; key: Capability; operand: string; options: Options }
  | {
      kind: "management";
      key: "list" | "usage" | "artifacts" | "status" | "cancel";
      id?: string;
      options: Options;
    };

/** Only contributions on this Project become executable commands. Commander and its output
 * belong to this request; no plugin callback, process stream or process exit code is touched. */
export async function parseModelTool(
  args: string[],
  available: AvailableCapability[],
  language: "en" | "zh",
): Promise<ToolInvocation> {
  const t = (en: string, zh: string) => (language === "zh" ? zh : en);
  const first = args[0];
  if (first && isCapability(first) && !available.some((c) => c.key === first)) {
    return {
      kind: "message",
      stdout: "",
      stderr: t(
        `No enabled plugin provides ${first} for this project.\n`,
        `此项目没有已启用的插件提供 ${first}。\n`,
      ),
      exitCode: 2,
    };
  }
  const output = { kind: "message" as const, stdout: "", stderr: "", exitCode: 0 };
  const root = new Command("penguin tools").exitOverride().configureOutput({
    writeOut: (text) => {
      output.stdout += text;
    },
    writeErr: (text) => {
      output.stderr += text;
    },
  });
  let parsed: ToolInvocation = output;
  const common = (cmd: Command) =>
    cmd
      .option("--project-id <id>", t("Project ID", "项目 ID"))
      .option("--session-id <id>", t("Calling Session ID", "调用此工具的会话 ID"))
      .option("--server <url>", t("Server address", "服务端地址"))
      .option("--json", t("Print JSON", "输出 JSON"));
  const operands: Record<Capability, string> = {
    search: "<query>",
    fetch: "<url>",
    image: "<prompt>",
    video: "<prompt>",
    tts: "<text>",
    stt: "<file>",
  };
  for (const { key, title } of available) {
    const cmd = common(root.command(key + " " + operands[key]).description(title[language])).option(
      "--detach",
      t("Return the run ID immediately", "立即返回任务 ID"),
    );
    if (["tts", "video", "image"].includes(key))
      cmd.option("--out <file-or-dir>", t("Save the generated file", "保存生成的文件"));
    if (key === "tts") cmd.option("--voice <name>", t("Provider voice name", "服务商音色名称"));
    if (key === "stt") cmd.option("--mime-type <type>", t("Audio MIME type", "音频 MIME 类型"));
    if (key === "search") cmd.option("--count <number>", t("Maximum results", "结果上限"), Number);
    if (key === "video" || key === "image")
      cmd
        .option("--resolution <size>", t("Output resolution", "输出分辨率"))
        .option("--aspect-ratio <ratio>", t("Aspect ratio", "画面宽高比"));
    if (key === "video")
      cmd.option("--duration <seconds>", t("Video duration in seconds", "视频时长（秒）"), Number);
    cmd.action((operand: string, options: Options) => {
      parsed = { kind: "operation", key, operand, options };
    });
  }
  for (const [key, en, zh] of [
    ["list", "Show bindings and eligible models", "显示绑定和可用模型"],
    ["usage", "Show recorded model usage", "查看已记录用量"],
    ["artifacts", "List generated files", "列出生成的文件"],
    ["status", "Get a run", "查看任务"],
    ["cancel", "Cancel a run", "取消任务"],
  ] as const) {
    const hasId = key === "status" || key === "cancel";
    const cmd = common(root.command(key + (hasId ? " <id>" : "")).description(t(en, zh)));
    if (key === "status")
      cmd.option("--out <file-or-dir>", t("Save the generated file", "保存生成的文件"));
    cmd.action((...args: unknown[]) => {
      parsed = {
        kind: "management",
        key,
        id: hasId ? String(args[0]) : undefined,
        options: args[hasId ? 1 : 0] as Options,
      };
    });
  }
  root.action(() => {
    root.outputHelp();
  });
  try {
    await root.parseAsync(args, { from: "user" });
  } catch (err) {
    if (!(err instanceof CommanderError)) throw err;
    output.exitCode = err.exitCode === 0 ? 0 : 2;
    return output;
  }
  return parsed;
}

export function requestFromCommand(
  op: Extract<ToolInvocation, { kind: "operation" }>,
): CapabilityRunRequest {
  const { key, operand, options } = op;
  return {
    ...(key === "stt" ? {} : key === "fetch" ? { url: operand } : { text: operand }),
    count: options.count,
    duration: options.duration,
    resolution: options.resolution,
    aspectRatio: options.aspectRatio,
    voice: options.voice,
    async: true,
  };
}
