import { randomUUID } from "node:crypto";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Command } from "commander";
import { Bind, Component } from "@prismshadow/penguin-core/kernel";
import type { CliCommandCode, CliCommandProgram } from "@prismshadow/penguin-core/cli";
import type {
  Capability,
  CapabilityResult,
  CapabilityRunRequest,
} from "@prismshadow/penguin-server/api";
import {
  resolveConnection,
  resolveProjectId,
  ServerClient,
  type Messages,
} from "@prismshadow/penguin-server/cli";

interface Options {
  server?: string;
  projectId?: string;
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
const audioTypes: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  webm: "audio/webm",
};
async function outputFile(client: ServerClient, result: CapabilityResult, out: string) {
  if (!result.artifacts.length) throw new Error("The model returned no file.");
  const isDir = await stat(out).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (result.artifacts.length > 1 && !isDir)
    throw new Error("Choose a directory for multiple files.");
  const files: string[] = [];
  for (const item of result.artifacts) {
    const target = path.resolve(isDir ? path.join(out, path.basename(item.name)) : out);
    const temp = target + "." + randomUUID() + ".tmp";
    const res = await client.raw("GET", item.url);
    try {
      await writeFile(temp, Buffer.from(await res.arrayBuffer()), { flag: "wx", mode: 0o600 });
      await rename(temp, target);
    } finally {
      await unlink(temp).catch(() => {});
    }
    files.push(target);
  }
  return files;
}
const scope = (opts: Options, m: Messages) => ({
  client: resolveConnection({ server: opts.server }, m).then((c) => new ServerClient(c, m)),
  base: "/api/projects/" + encodeURIComponent(resolveProjectId(opts.projectId)) + "/capabilities",
  sessionId: opts.sessionId ?? process.env.PENGUIN_SESSION_ID?.trim() ?? undefined,
});
export function registerTools(program: Command, m: Messages) {
  const t = (en: string, zh: string) => (m.language === "zh" ? zh : en);
  const common = (cmd: Command) =>
    cmd
      .option("--project-id <id>", m.common.projectId)
      .option("--session-id <id>", t("Calling Session ID", "调用此工具的会话 ID"))
      .option("--server <url>", m.common.server)
      .option("--json", m.common.json);
  const specs: [Capability, string, string, string][] = [
    ["search", "<query>", "Search the web", "搜索网页"],
    ["fetch", "<url>", "Read a web page", "读取网页"],
    ["image", "<prompt>", "Generate an image", "生成图片"],
    ["video", "<prompt>", "Generate a video", "生成视频"],
    ["tts", "<text>", "Synthesize speech", "把文字转换为语音"],
    ["stt", "<file>", "Transcribe an audio file", "转写音频文件"],
  ];
  for (const [key, arg, en, cn] of specs) {
    const cmd = common(program.command(key + " " + arg).description(t(en, cn))).option(
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
    cmd.action(async (input: string, opts: Options) => {
      const { client, base, sessionId } = scope(opts, m);
      const api = await client;
      const req: CapabilityRunRequest = { sessionId, async: true };
      if (key === "stt") {
        const file = await stat(input);
        if (!file.isFile()) throw new Error(t("Select an audio file.", "请选择音频文件。"));
        if (file.size > 20 * 1024 * 1024)
          throw new Error(t("Audio exceeds 20 MiB.", "音频文件超过 20 MiB。"));
        const mime = opts.mimeType ?? audioTypes[path.extname(input).slice(1).toLowerCase()];
        if (!mime)
          throw new Error(
            t("Specify the file type with --mime-type.", "请用 --mime-type 指定文件类型。"),
          );
        req.audio = { data: (await readFile(input)).toString("base64"), mimeType: mime };
      } else if (key === "fetch") req.url = input;
      else req.text = input;
      Object.assign(req, {
        count: opts.count,
        duration: opts.duration,
        resolution: opts.resolution,
        aspectRatio: opts.aspectRatio,
        voice: opts.voice,
      });
      const submit = () => api.request<CapabilityResult>("POST", base + "/" + key + "/run", req);
      if (opts.detach) {
        const run = await submit();
        process.stdout.write((opts.json ? JSON.stringify(run) : run.id) + "\n");
        return;
      }
      let run: CapabilityResult | undefined;
      let interrupted = false;
      const cancelById = (id: string) =>
        api.request<CapabilityResult>("DELETE", base + "/runs/" + encodeURIComponent(id));
      const cancel = () => {
        interrupted = true;
        if (run) void cancelById(run.id).catch(() => {});
      };
      process.once("SIGINT", cancel);
      process.once("SIGTERM", cancel);
      try {
        run = await submit();
        // A Session can be stopped while its upload or the start acknowledgement is in flight.
        if (interrupted) run = await cancelById(run.id);
        while (run.status === "running") {
          await delay(600);
          run = await api.request<CapabilityResult>(
            "GET",
            base + "/runs/" + encodeURIComponent(run.id),
          );
        }
      } finally {
        process.off("SIGINT", cancel);
        process.off("SIGTERM", cancel);
      }
      if (run.status !== "completed")
        throw new Error(run.error ?? t("The request failed.", "任务失败。"));
      const files = opts.out ? await outputFile(api, run, opts.out) : [];
      const readable = [
        run.text,
        ...(run.sources ?? []).map((s) => [s.title, s.url, s.content].join("\n")),
        ...(files.length ? files : run.artifacts.map((a) => a.url)),
      ]
        .filter(Boolean)
        .join("\n\n");
      process.stdout.write(
        (opts.json ? JSON.stringify({ ...run, ...(files.length ? { files } : {}) }) : readable) +
          "\n",
      );
    });
  }
  for (const [key, description, cn] of [
    ["list", "Show bindings and eligible models", "显示绑定和可用模型"],
    ["usage", "Show recorded model usage", "查看已记录用量"],
    ["artifacts", "List generated files", "列出生成的文件"],
    ["status <id>", "Get a run", "查看任务"],
    ["cancel <id>", "Cancel a run", "取消任务"],
  ] as const) {
    const cmd = common(program.command(key).description(t(description, cn)));
    if (key.startsWith("status"))
      cmd.option("--out <file-or-dir>", t("Save the generated file", "保存生成的文件"));
    cmd.action(async (...args: unknown[]) => {
      const hasId = key.includes("<id>");
      const opts = args[hasId ? 1 : 0] as Options;
      const { client, base, sessionId } = scope(opts, m);
      const api = await client;
      const route = hasId
        ? "/runs/" + encodeURIComponent(String(args[0]))
        : key === "list"
          ? ""
          : "/" + key + (sessionId ? "?sessionId=" + encodeURIComponent(sessionId) : "");
      const data = await api.request<CapabilityResult>(
        key.startsWith("cancel") ? "DELETE" : "GET",
        base + route,
      );
      if (opts.out) await outputFile(api, data, opts.out);
      process.stdout.write(JSON.stringify(data, null, opts.json ? undefined : 2) + "\n");
    });
  }
}
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.tools",
        key: "tools",
        summary: {
          en: "Run project web, media and speech models",
          zh: "调用项目绑定的网页、图像、视频和语音模型",
        },
      },
    ],
  },
})
export class ToolsCommand {
  @Bind("cli.tools") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command: CliCommandProgram, ctx) =>
        registerTools(command as unknown as Command, ctx.messages),
    };
  }
}
