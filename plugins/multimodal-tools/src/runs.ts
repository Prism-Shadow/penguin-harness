/**
 * A run: one operation's request to its model, from start to the stored result.
 *
 * A run in flight is memory state — this process's, shared by every generation of the module tree
 * so a hot swap neither drops nor duplicates it. A run in a Session is written to the Session's
 * folder when it starts and again when it ends, with the files it generated (store.ts); a run
 * with no Session stores nothing and hands its result to the caller that waits for it. A stored
 * run still marked running that is in no process's memory was cut off by a restart, and reads so.
 */
import { randomUUID } from "node:crypto";
import type { UniConfig, UniMessage, UsageMetadata } from "@prismshadow/mmsp";
import type { ModelRef, ModelRequests } from "./host.js";
import { failureReason, ToolError } from "./errors.js";
import { extensionOf, playable } from "./media.js";
import { PACKAGE, type Operation, type ResultKind } from "./operations.js";
import type { ToolStore } from "./store.js";

/** The most one run may generate, all files together: what one CLI run may hand back. */
export const MAX_RESULT_BYTES = 64 * 1024 * 1024;

/** A file a run generated, as its record lists it. */
export interface RunFile {
  name: string;
  mimeType: string;
  bytes: number;
  /** Where a signed-in member downloads it; only for a stored (Session) file. */
  url?: string;
}

export type RunStatus = "running" | "completed" | "failed" | "cancelled";

/** One run, as it is stored, listed and printed. */
export interface RunRecord {
  id: string;
  operation: Operation;
  model: ModelRef;
  sessionId?: string;
  createdAt: string;
  status: RunStatus;
  /** The model's text: the answer, the description, the transcript. */
  text?: string;
  /** The pages a search or a fetch returned. */
  sources?: { title: string; url: string; content: string }[];
  files: RunFile[];
  /** The provider's usage as MMSP reported it; null when it reported none. */
  usage?: UsageMetadata | null;
  error?: string;
}

/** A generated file's bytes, for the caller that hands them back to a terminal. */
export interface GeneratedFile {
  name: string;
  mimeType: string;
  data: Uint8Array;
}

export interface Finished {
  record: RunRecord;
  files: GeneratedFile[];
}

/** One run to start. */
export interface RunTask {
  projectId: string;
  sessionId?: string;
  operation: Operation;
  result: ResultKind;
  model: ModelRef;
  messages: UniMessage[];
  config: UniConfig;
}

interface Flight {
  projectId: string;
  record: RunRecord;
  controller: AbortController;
  done: Promise<Finished>;
}

/** Runs in flight, by id: one map per process, whichever generation started them. */
const flights = new Map<string, Flight>();

/** The Sessions with a run in flight: their folders are not swept. */
export function busySessions(): Set<string> {
  const busy = new Set<string>();
  for (const flight of flights.values()) {
    if (flight.record.sessionId !== undefined) busy.add(flight.record.sessionId);
  }
  return busy;
}

/** What a model's events added up to. */
interface Output {
  text: string;
  sources: { title: string; url: string; content: string }[];
  media: { mimeType: string; data: Uint8Array }[];
  usage: UsageMetadata | null;
}

export class Runs {
  constructor(
    private readonly requests: ModelRequests,
    private readonly store: ToolStore,
  ) {}

  /** Starts a run; it goes on whether or not anyone waits for it. */
  async start(task: RunTask): Promise<{ record: RunRecord; done: Promise<Finished> }> {
    const record: RunRecord = {
      id: randomUUID(),
      operation: task.operation,
      model: task.model,
      ...(task.sessionId !== undefined ? { sessionId: task.sessionId } : {}),
      createdAt: new Date().toISOString(),
      status: "running",
      files: [],
    };
    await this.store.writeRun(task.projectId, record);
    const controller = new AbortController();
    const done = this.finish(task, record, controller.signal).finally(() =>
      flights.delete(record.id),
    );
    flights.set(record.id, { projectId: task.projectId, record, controller, done });
    return { record: { ...record }, done };
  }

  /** A run of the Project: in flight, else stored in the Session; null when there is none. */
  async get(projectId: string, runId: string, sessionId?: string): Promise<RunRecord | null> {
    const flight = flights.get(runId);
    if (flight !== undefined && flight.projectId === projectId) {
      if (sessionId !== undefined && flight.record.sessionId !== sessionId) return null;
      return { ...flight.record };
    }
    if (sessionId === undefined) return null;
    const stored = await this.store.readRun(projectId, sessionId, runId);
    if (stored?.status === "running") {
      return {
        ...stored,
        status: "failed",
        error: "The server restarted before this run finished.",
      };
    }
    return stored;
  }

  /** Waits for a run in flight; null when it is not in flight (finished, or never was). */
  waitFor(projectId: string, runId: string): Promise<Finished> | null {
    const flight = flights.get(runId);
    return flight !== undefined && flight.projectId === projectId ? flight.done : null;
  }

  /** Stops a run in flight and answers it as it ended; null when it is not in flight. */
  async cancel(projectId: string, runId: string, sessionId?: string): Promise<RunRecord | null> {
    const flight = flights.get(runId);
    if (flight === undefined || flight.projectId !== projectId) return null;
    if (sessionId !== undefined && flight.record.sessionId !== sessionId) return null;
    flight.controller.abort();
    return (await flight.done).record;
  }

  private async collect(task: RunTask, signal: AbortSignal): Promise<Output> {
    const out: Output = { text: "", sources: [], media: [], usage: null };
    const chunks: string[] = [];
    let bytes = 0;
    const events = this.requests.stream(
      {
        projectId: task.projectId,
        ...(task.sessionId !== undefined ? { sessionId: task.sessionId } : {}),
        purpose: `${PACKAGE}:${task.operation}`,
      },
      task.model,
      { messages: task.messages, config: task.config, signal },
    );
    for await (const event of events) {
      for (const item of event.content_items) {
        if (item.type === "text.done") chunks.push(item.text);
        else if (item.type === "webtool.done") out.sources.push(...item.webdata);
        else if (item.type === "inline_data.done") {
          bytes += item.data.byteLength;
          if (bytes > MAX_RESULT_BYTES) {
            throw new ToolError(
              502,
              "result_too_large",
              `The generated files exceed ${MAX_RESULT_BYTES / (1024 * 1024)} MiB.`,
            );
          }
          out.media.push({ mimeType: item.mime_type, data: item.data });
        }
      }
      if (event.event_type === "stop" && event.usage_metadata) out.usage = event.usage_metadata;
    }
    out.text = chunks.join("");
    return out;
  }

  /** The files of a completed media run, converted and named; throws when there are none of the kind asked for. */
  private generated(task: RunTask, record: RunRecord, out: Output): GeneratedFile[] {
    const kind = task.result;
    const files: GeneratedFile[] = [];
    for (const raw of out.media.filter((m) => m.mimeType.toLowerCase().startsWith(`${kind}/`))) {
      const media = playable(raw);
      const ext = media === null ? undefined : extensionOf(media.mimeType);
      if (media === null || ext === undefined) {
        throw new ToolError(
          502,
          "unsupported_media",
          `The model returned a ${kind} file in a format this tool cannot store (${raw.mimeType.slice(0, 64)}).`,
        );
      }
      const suffix = files.length === 0 ? "" : `-${files.length + 1}`;
      files.push({
        name: `${task.operation}-${record.id.slice(0, 8)}${suffix}.${ext}`,
        mimeType: media.mimeType.split(";")[0]!.trim().toLowerCase(),
        data: media.data,
      });
    }
    if (files.length === 0)
      throw new ToolError(502, "missing_media", `The model returned no ${kind} file.`);
    return files;
  }

  private async finish(task: RunTask, record: RunRecord, signal: AbortSignal): Promise<Finished> {
    let files: GeneratedFile[] = [];
    try {
      const out = await this.collect(task, signal);
      record.usage = out.usage;
      if (out.text !== "") record.text = out.text;
      if (task.result === "sources") record.sources = out.sources;
      if (task.result === "image" || task.result === "video" || task.result === "audio") {
        files = this.generated(task, record, out);
      } else if (task.result === "text" && task.operation !== "s2t" && out.text.trim() === "") {
        throw new ToolError(502, "empty_result", "The model returned no text.");
      }
      signal.throwIfAborted();
      if (task.sessionId !== undefined) {
        const stored: string[] = [];
        try {
          for (const file of files) {
            await this.store.writeFile(task.projectId, task.sessionId, file.name, file.data);
            stored.push(file.name);
          }
        } catch (err) {
          await this.store.removeFiles(task.projectId, task.sessionId, stored);
          throw err;
        }
      }
      record.files = files.map((file) => ({
        name: file.name,
        mimeType: file.mimeType,
        bytes: file.data.byteLength,
        ...(task.sessionId !== undefined
          ? {
              url: `/api/projects/${encodeURIComponent(task.projectId)}/multimodal-tools/sessions/${encodeURIComponent(task.sessionId)}/files/${file.name}`,
            }
          : {}),
      }));
      record.status = "completed";
    } catch (err) {
      files = [];
      record.files = [];
      record.status = signal.aborted ? "cancelled" : "failed";
      record.error = signal.aborted ? "The run was cancelled." : failureReason(err);
    }
    try {
      await this.store.writeRun(task.projectId, record);
    } catch (err) {
      console.error(
        `[multimodal-tools] run ${record.id} could not be stored: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { record: { ...record }, files };
  }
}
