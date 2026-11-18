/** Terminal-side transport for project model commands. Only the terminal can name local
 * files, choose the server/Project and react to a signal; grammar and execution live on the server. */
import { randomUUID } from "node:crypto";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Command } from "commander";
import type { CapabilityCliReply, CapabilityResult } from "../api/capabilities.js";
import { resolveConnection } from "./connection.js";
import { resolveProjectId, ServerClient } from "./client.js";
import type { Messages } from "./i18n.js";

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
async function outputFile(
  client: ServerClient,
  base: string,
  result: CapabilityResult,
  out: string,
) {
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
    const res = await client.raw("GET", base + "/artifacts/" + encodeURIComponent(item.id));
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

interface ClientArgs {
  args: string[];
  server?: string;
  projectId?: string;
  file?: string;
  out?: string;
}

/** Strip connection options and replace file operands with markers. Neither raw local path is
 * transmitted. Unknown options and usage errors remain for the server's scoped parser. */
export function splitModelToolArgs(argv: readonly string[]): ClientArgs {
  const parsed: ClientArgs = { args: [] };
  let positional = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!positional && arg === "--") {
      positional = true;
      parsed.args.push(arg);
      continue;
    }
    if (!positional && arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq < 0 ? arg : arg.slice(0, eq);
      if (["--server", "--project-id", "--out", "--mime-type", "--session-id"].includes(name)) {
        const value = eq < 0 ? argv[++i] : arg.slice(eq + 1);
        if (!value || (eq < 0 && value.startsWith("--")))
          throw new Error(`Missing value for ${name}.`);
        if (name === "--server") parsed.server = value;
        else if (name === "--project-id") parsed.projectId = value;
        else if (name === "--out") {
          parsed.out = value;
          parsed.args.push("--out", "client-file");
        } else parsed.args.push(name, value);
        continue;
      }
    }
    if (parsed.args[0] === "stt" && !parsed.file && (positional || !arg.startsWith("-"))) {
      parsed.file = arg;
      parsed.args.push("client-audio");
    } else parsed.args.push(arg);
  }
  return parsed;
}

export async function runModelTool(argv: readonly string[], m: Messages): Promise<number> {
  const t = (en: string, zh: string) => (m.language === "zh" ? zh : en);
  const opts = splitModelToolArgs(argv);
  const api = new ServerClient(await resolveConnection({ server: opts.server }, m), m);
  const base =
    "/api/projects/" + encodeURIComponent(resolveProjectId(opts.projectId)) + "/capabilities";
  const request = {
    args: opts.args,
    language: m.language,
    sessionId: process.env.PENGUIN_SESSION_ID?.trim() || undefined,
  };
  const submit = (audio?: { data: string; mimeType: string }) =>
    api.request<CapabilityCliReply>("POST", base + "/cli", { ...request, audio });
  let runId: string | undefined;
  let cancelled = false;
  const cancel = async () => {
    cancelled = true;
    if (runId) await api.request("DELETE", base + "/runs/" + encodeURIComponent(runId));
  };
  const signal = () => {
    void cancel().catch(() => {});
  };
  process.once("SIGINT", signal);
  process.once("SIGTERM", signal);
  try {
    let response = await submit();
    if (response.kind === "audio") {
      if (!opts.file) throw new Error(t("Select an audio file.", "请选择音频文件。"));
      const info = await stat(opts.file);
      if (!info.isFile() || info.size > 20 * 1024 * 1024)
        throw new Error(
          t("Select an audio file up to 20 MiB.", "请选择不超过 20 MiB 的音频文件。"),
        );
      const mimeType =
        response.mimeType ?? audioTypes[path.extname(opts.file).slice(1).toLowerCase()];
      if (!mimeType)
        throw new Error(
          t("Specify the audio type with --mime-type.", "请用 --mime-type 指定音频类型。"),
        );
      if (cancelled) return 130;
      response = await submit({ mimeType, data: (await readFile(opts.file)).toString("base64") });
    }
    if (response.kind === "audio")
      throw new Error("The server did not accept the audio attachment.");
    if (response.kind === "message") {
      if (response.stdout) process.stdout.write(response.stdout);
      if (response.stderr) process.stderr.write(response.stderr);
      return response.exitCode;
    }
    if (response.kind === "data") {
      process.stdout.write(
        JSON.stringify(response.data, null, response.json ? undefined : 2) + "\n",
      );
      return 0;
    }
    let result = response.result;
    if (response.kind === "status") {
      if (response.save && opts.out) await outputFile(api, base, result, opts.out);
      process.stdout.write(JSON.stringify(result, null, response.json ? undefined : 2) + "\n");
      return 0;
    }
    runId = result.id;
    if (cancelled) await cancel();
    if (response.detached) {
      process.stdout.write((response.json ? JSON.stringify(result) : result.id) + "\n");
      return 0;
    }
    while (result.status === "running") {
      await delay(600);
      result = await api.request("GET", base + "/runs/" + encodeURIComponent(runId));
    }
    if (result.status !== "completed")
      throw new Error(result.error ?? t("The request did not complete.", "任务未完成。"));
    const files = response.save && opts.out ? await outputFile(api, base, result, opts.out) : [];
    const readable = [
      result.text,
      ...(result.sources ?? []).map((s) => [s.title, s.url, s.content].join("\n")),
      ...(files.length ? files : result.artifacts.map((a) => a.url)),
    ]
      .filter(Boolean)
      .join("\n\n");
    process.stdout.write(
      (response.json
        ? JSON.stringify({ ...result, ...(files.length ? { files } : {}) })
        : readable) + "\n",
    );
    return 0;
  } finally {
    process.off("SIGINT", signal);
    process.off("SIGTERM", signal);
  }
}

export function registerModelToolTransport(command: Command, m: Messages) {
  command
    .enablePositionalOptions()
    .passThroughOptions()
    .allowUnknownOption()
    .allowExcessArguments()
    .helpOption(false)
    .action(async () => {
      process.exitCode = await runModelTool(command.args, m);
    });
}
