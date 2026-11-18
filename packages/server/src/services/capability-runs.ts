import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { projectDir, type ProjectConfig } from "@prismshadow/penguin-core";
import type { Resources } from "@prismshadow/penguin-core/kernel";
import type { ContentItem, UniConfig } from "@prismshadow/mmsp";
import type { Db } from "../hmr/capabilities.js";
import type {
  ModelOperation as Capability,
  CapabilityArtifact,
  CapabilityResult,
} from "../api/capabilities.js";
import type { ModelRefDto } from "../api/types.js";
import { HttpError } from "../http/errors.js";
import { playableMedia, runProjectModel, type ModelMedia } from "./capability-model.js";
import { polishTranscript } from "./voice-polish.js";

const suffix: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};
interface Task {
  listener?: string;
  projectId: string;
  sessionId?: string;
  model: ModelRefDto;
  capability: Capability | "voice-polish";
  config: ProjectConfig;
  item: ContentItem;
  instruction?: string;
  options: UniConfig;
}
function decode(row: unknown): CapabilityResult {
  return JSON.parse((row as { data: string }).data) as CapabilityResult;
}
function reason(err: unknown): string {
  if (err instanceof HttpError) return err.message;
  const e = err as { name?: string; status?: number; parameter?: string };
  if (e?.name === "ApiKeyRequiredError" || e?.status === 401 || e?.status === 403)
    return "The model provider rejected the credential. Check the model or provider key.";
  if (e?.status === 429) return "The model provider rate-limited this request.";
  if (
    e?.name === "UnsupportedParameterError" ||
    e?.name === "UnsupportedOperationError" ||
    e?.name === "UnsupportedContentError"
  )
    return "The selected model does not support this operation or its options.";
  if (e?.status && e.status >= 400) return "The model provider returned HTTP " + e.status + ".";
  return "The model request failed. Check the selected model and its endpoint.";
}
interface PendingSpeech {
  controller: AbortController;
  listeners: number;
  result: Promise<CapabilityResult>;
}

export class CapabilityRuns {
  private readonly speech: Map<string, PendingSpeech>;
  private readonly active: Map<string, AbortController>;
  constructor(
    private readonly db: Db,
    private readonly root: string,
    resources: Resources,
  ) {
    const speechSlot = "capability-runs:read-aloud";
    const speech = resources.claim<Map<string, PendingSpeech>>(speechSlot);
    this.speech = speech ?? new Map();
    if (!speech)
      resources.register(speechSlot, this.speech, () => {
        for (const entry of this.speech.values()) entry.controller.abort();
      });
    // An outstanding video continues when the HTTP routes are hot-replaced.
    const slot = "capability-runs:controllers";
    const existing = resources.claim<Map<string, AbortController>>(slot);
    this.active = existing ?? new Map();
    if (!existing)
      resources.register(slot, this.active, () => {
        for (const controller of this.active.values()) controller.abort();
      });
  }
  private dir(project: string) {
    return path.join(projectDir(this.root, project), ".capability-artifacts");
  }
  private update(row: CapabilityResult) {
    this.db
      .prepare("UPDATE capability_runs SET status=?,data=? WHERE id=?")
      .run(row.status, JSON.stringify(row), row.id);
  }
  get(project: string, id: string): CapabilityResult {
    const stored = this.db
      .prepare("SELECT data FROM capability_runs WHERE project_id=? AND id=?")
      .get(project, id);
    if (!stored)
      throw new HttpError(404, "capability_run_not_found", "This tool run does not exist.");
    const row = decode(stored);
    if (row.status === "running" && !this.active.has(row.id)) {
      row.status = "failed";
      row.error = "The server restarted before this request finished.";
      this.update(row);
    }
    return row;
  }
  list(
    project: string,
    session: string | undefined,
    limit: number,
    offset: number,
  ): CapabilityResult[] {
    const sql =
      "SELECT id FROM capability_runs WHERE project_id=?" +
      (session ? " AND session_id=?" : "") +
      " ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?";
    return this.db
      .prepare(sql)
      .all(project, ...(session ? [session] : []), limit, offset)
      .map((r) => this.get(project, String(r.id)));
  }
  artifacts(
    project: string,
    session: string | undefined,
    limit: number,
    offset: number,
  ): CapabilityArtifact[] {
    const sql =
      "SELECT j.value FROM capability_runs AS r, json_each(r.data,'$.artifacts') AS j WHERE r.project_id=? AND r.status='completed'" +
      (session ? " AND r.session_id=?" : "") +
      " ORDER BY r.created_at DESC,r.id DESC,j.key LIMIT ? OFFSET ?";
    return this.db
      .prepare(sql)
      .all(project, ...(session ? [session] : []), limit, offset)
      .map((r) => JSON.parse(String(r.value)) as CapabilityArtifact);
  }
  async file(project: string, id: string) {
    const run = id.match(/^([0-9a-f-]{36})-\d+$/)?.[1];
    if (!run) throw new HttpError(404, "artifact_not_found", "This artifact does not exist.");
    const item = this.get(project, run).artifacts.find((f) => f.id === id);
    if (!item) throw new HttpError(404, "artifact_not_found", "This artifact does not exist.");
    try {
      return { item, bytes: await readFile(path.join(this.dir(project), item.id)) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new HttpError(404, "artifact_not_found", "This artifact file no longer exists.");
      throw error;
    }
  }
  cancel(project: string, id: string) {
    const row = this.get(project, id);
    const active = this.active.get(id);
    if (active) {
      active.abort();
      row.status = "cancelled";
      this.update(row);
    }
    return row;
  }
  private async existingSpeech(task: Task, key: string): Promise<CapabilityResult | undefined> {
    const row = this.db
      .prepare(
        "SELECT r.data FROM read_aloud_cache c JOIN capability_runs r ON r.id=c.run_id WHERE c.fingerprint=? AND r.project_id=? AND r.session_id=? AND r.status='completed'",
      )
      .get(key, task.projectId, task.sessionId!);
    if (!row) return;
    const result = decode(row);
    const audio = result.artifacts.find((item) => item.mimeType.startsWith("audio/"));
    if (audio) {
      try {
        const file = await stat(path.join(this.dir(task.projectId), audio.id));
        if (file.isFile() && file.size === audio.bytes && file.size > 0) return result;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    this.db
      .prepare("DELETE FROM read_aloud_cache WHERE fingerprint=? AND run_id=?")
      .run(key, result.id);
  }

  private async speechResult(task: Task, key: string, signal: AbortSignal) {
    const existing = await this.existingSpeech(task, key);
    signal.throwIfAborted();
    if (existing) return existing;
    const result = await this.start(task, signal, false);
    if (result.status === "completed") {
      this.db
        .prepare("INSERT OR REPLACE INTO read_aloud_cache(fingerprint,run_id) VALUES(?,?)")
        .run(key, result.id);
    }
    return result;
  }

  async run(task: Task, signal: AbortSignal, background: boolean) {
    if (
      !task.listener ||
      task.capability !== "tts" ||
      !task.sessionId ||
      task.item.type !== "text.done"
    )
      return this.start(task, signal, background);
    signal.throwIfAborted();
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          task.projectId,
          task.sessionId,
          task.listener,
          task.model.provider,
          task.model.modelId,
          task.options,
          task.item.text,
        ]),
      )
      .digest("hex");
    let entry = this.speech.get(key);
    if (!entry || entry.controller.signal.aborted) {
      const controller = new AbortController();
      const next = {
        controller,
        listeners: 0,
        result: this.speechResult(task, key, controller.signal),
      };
      entry = next;
      this.speech.set(key, next);
      const remove = () => {
        if (this.speech.get(key) === next) this.speech.delete(key);
      };
      void next.result.then(remove, remove);
    }
    const job = entry;
    job.listeners++;
    const leave = () => {
      if (--job.listeners === 0) job.controller.abort();
    };
    signal.addEventListener("abort", leave, { once: true });
    try {
      return await job.result;
    } finally {
      signal.removeEventListener("abort", leave);
      if (!signal.aborted) leave();
    }
  }

  private async start(task: Task, signal: AbortSignal, background: boolean) {
    const { projectId, capability, model, sessionId } = task;
    const row: CapabilityResult = {
      id: randomUUID(),
      capability,
      model,
      sessionId,
      createdAt: new Date().toISOString(),
      status: "running",
      usage: null,
      artifacts: [],
      measurements: [],
    };
    const controller = new AbortController();
    const interrupt = background ? controller.signal : AbortSignal.any([signal, controller.signal]);
    interrupt.throwIfAborted();
    this.db
      .prepare(
        "INSERT INTO capability_runs(id,project_id,session_id,created_at,status,data) VALUES(?,?,?,?,?,?)",
      )
      .run(row.id, projectId, sessionId ?? null, row.createdAt, row.status, JSON.stringify(row));
    this.active.set(row.id, controller);
    const completion = this.finish(task, row, interrupt).finally(() => this.active.delete(row.id));
    if (background) {
      void completion.catch(() => {});
      return { ...row };
    }
    return await completion;
  }
  private async finish(task: Task, row: CapabilityResult, signal: AbortSignal) {
    const files: string[] = [];
    const context = { signal, sessionId: task.sessionId };
    try {
      const output =
        task.capability === "voice-polish" && task.item.type === "text.done"
          ? {
              ...(await polishTranscript({
                config: task.config,
                model: task.model,
                text: task.item.text,
                ...context,
              })),
              sources: [],
              media: [],
            }
          : await runProjectModel(
              task.config,
              task.model,
              [
                {
                  role: "user",
                  content_items: task.instruction
                    ? [{ type: "text.done", text: task.instruction }, task.item]
                    : [task.item],
                },
              ],
              task.options,
              context,
            );
      row.usage = output.usage;
      if (output.text) row.text = output.text;
      if (task.capability === "search" || task.capability === "fetch") row.sources = output.sources;
      // A completed upstream request is directly observed, independently of whether its endpoint reports tokens.
      row.measurements.push({ unit: "request", quantity: 1 });
      const kind = ({ image: "image", video: "video", tts: "audio" } as Record<string, string>)[
        task.capability
      ];
      if (kind) {
        const requested = output.media.filter((m) =>
          m.mimeType.toLowerCase().startsWith(kind + "/"),
        );
        if (!requested.length)
          throw new HttpError(502, "missing_artifact", "The model returned no " + kind + " file.");
        await mkdir(this.dir(task.projectId), { recursive: true, mode: 0o700 });
        let seconds = 0;
        for (const blob of requested) {
          signal.throwIfAborted();
          const media: ModelMedia = playableMedia(blob);
          if (media.seconds !== undefined) seconds += media.seconds;
          const mimeType = media.mimeType.split(";")[0]!.toLowerCase();
          const extension = suffix[mimeType];
          if (!extension)
            throw new HttpError(
              502,
              "unsupported_media",
              "The model returned an unsupported file format.",
            );
          const id = row.id + "-" + row.artifacts.length;
          const target = path.join(this.dir(task.projectId), id);
          const handle = await open(target, "wx", 0o600);
          files.push(target);
          try {
            await handle.writeFile(media.data);
          } finally {
            await handle.close();
          }
          row.artifacts.push({
            id,
            name: task.capability + "-" + id + "." + extension,
            mimeType,
            bytes: media.data.length,
            sessionId: row.sessionId,
            url:
              "/api/projects/" +
              encodeURIComponent(task.projectId) +
              "/capabilities/artifacts/" +
              id,
          });
        }
        if (seconds > 0) row.measurements.push({ unit: "audio_second", quantity: seconds });
        row.measurements.push({
          unit: kind === "audio" ? "audio_file" : kind,
          quantity: row.artifacts.length,
        });
      } else if (
        ["stt", "voice-polish", "t2t", "i2t"].includes(task.capability) &&
        !output.text.trim()
      )
        throw new HttpError(502, "empty_transcript", "The model returned no text.");
      signal.throwIfAborted();
      row.status = "completed";
    } catch (error) {
      await Promise.allSettled(files.map((f) => unlink(f)));
      row.artifacts = [];
      row.status = signal.aborted ? "cancelled" : "failed";
      row.error = signal.aborted ? "The request was cancelled." : reason(error);
    }
    this.update(row);
    return row;
  }
}
