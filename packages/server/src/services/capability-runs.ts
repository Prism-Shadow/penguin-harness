import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
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
import { observeProviderAttempt } from "./capability-attempt.js";
import {
  playableMedia,
  runProjectModel,
  type ModelMedia,
  type ModelRunContext,
} from "./capability-model.js";
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
export class CapabilityRuns {
  private readonly active: Map<string, AbortController>;
  constructor(
    private readonly db: Db,
    private readonly root: string,
    resources: Resources,
  ) {
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
  async run(task: Task, signal: AbortSignal, background: boolean) {
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
    const attempt = { sent: false };
    const context: ModelRunContext = {
      signal,
      sessionId: task.sessionId,
      capability: task.capability,
      onUsage: (usage, inputMeter, registryRouteMatched) => {
        attempt.sent = true;
        if (registryRouteMatched) row.registryRouteMatched = true;
        row.usage = usage;
        if (inputMeter) row.inputMeter = inputMeter;
      },
    };
    try {
      const output = await observeProviderAttempt(attempt, async () =>
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
            ),
      );
      attempt.sent = true;
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
        row.measurements.push({
          unit: kind === "audio" ? "audio_file" : kind,
          quantity: requested.length,
        });
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
      if (!(error instanceof HttpError) && Number.isInteger((error as { status?: number })?.status))
        attempt.sent = true;
      row.status = signal.aborted ? "cancelled" : "failed";
      row.error = signal.aborted ? "The request was cancelled." : reason(error);
    }
    row.providerAttempted = attempt.sent;
    this.update(row);
    return row;
  }
}
