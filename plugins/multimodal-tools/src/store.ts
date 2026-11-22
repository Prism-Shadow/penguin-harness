/**
 * This plugin's files in a Project directory — the only place its results live:
 *
 *   <root>/<project>/.multimodal-tools/
 *     voice-polish.json                 the Project's transcript-editing settings (absent until an
 *                                       owner sets them: editing then follows the bindings)
 *     sessions/<session>/<run>.json     one run: its operation, model, status, text, sources, files
 *     sessions/<session>/<file>         the images, video and speech that run generated
 *     sessions/<session>/read-aloud/    replies read aloud: `<key>.json` and its audio `<key>.<ext>`
 *
 * Every stored result belongs to a Session. A Session that is gone takes its folder with it: the
 * sweep, at boot and once a day, compares the folders with the Session index (there is no platform
 * hook for a Session's deletion), and deleting the Project deletes the directory with it. A run
 * with no Session stores nothing — its files go back to whoever ran it and nowhere else.
 */
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { RunRecord } from "./runs.js";

const DIR = ".multimodal-tools";

/** An id that may become a path segment: what the host's Project and Session ids are made of. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
/** A run id: a UUID. */
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A generated file's name: `<operation>-<run prefix>[-n].<ext>`. */
const FILE_NAME = /^[a-z0-9]+-[0-9a-f]{8}(?:-\d{1,3})?\.[a-z0-9]{1,5}$/;

/** A reply's audio: `<key>.<ext>`, the key a digest of what it is reused by (read-aloud.ts). */
const SPEECH_NAME = /^[0-9a-f]{32}\.[a-z0-9]{1,5}$/;
const SPEECH_KEY = /^[0-9a-f]{32}$/;

export const isRunId = (id: string): boolean => RUN_ID.test(id);
export const isFileName = (name: string): boolean => FILE_NAME.test(name);
export const isSpeechName = (name: string): boolean => SPEECH_NAME.test(name);

function segment(id: string): string {
  if (!SEGMENT.test(id) || id === "." || id === "..")
    throw new Error(`'${id.slice(0, 64)}' is not an id.`);
  return id;
}

/**
 * Transcript editing in one Project, as an owner set it: the switch absent = never set (the
 * plugin then decides, polish.ts), the prompt absent = the default.
 */
export interface PolishSettings {
  enabled?: boolean;
  prompt?: string;
}

/** A stored file, as a Session's file list shows it. */
export interface StoredFile {
  name: string;
  mimeType: string;
  bytes: number;
  runId: string;
  operation: string;
  createdAt: string;
}

/** A reply's stored audio. */
export interface StoredSpeech {
  name: string;
  mimeType: string;
  bytes: number;
}

/** Writes a file whole, so a reader never sees half of it. */
async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, data, { mode: 0o600 });
  await fs.rename(temp, file);
}

export class ToolStore {
  constructor(readonly root: string) {}

  private projectBase(projectId: string): string {
    return path.join(this.root, segment(projectId), DIR);
  }

  sessionDir(projectId: string, sessionId: string): string {
    return path.join(this.projectBase(projectId), "sessions", segment(sessionId));
  }

  async writeRun(projectId: string, record: RunRecord): Promise<void> {
    if (record.sessionId === undefined) return;
    const dir = this.sessionDir(projectId, record.sessionId);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await writeAtomic(path.join(dir, `${record.id}.json`), JSON.stringify(record));
  }

  async readRun(projectId: string, sessionId: string, runId: string): Promise<RunRecord | null> {
    if (!isRunId(runId)) return null;
    try {
      const text = await fs.readFile(
        path.join(this.sessionDir(projectId, sessionId), `${runId}.json`),
        "utf8",
      );
      return JSON.parse(text) as RunRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  /** Stores one generated file of a Session; never over an existing one. */
  async writeFile(
    projectId: string,
    sessionId: string,
    name: string,
    data: Uint8Array,
  ): Promise<void> {
    if (!isFileName(name)) throw new Error(`'${name}' is not a generated file name.`);
    const dir = this.sessionDir(projectId, sessionId);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(dir, name), data, { flag: "wx", mode: 0o600 });
  }

  async removeFiles(projectId: string, sessionId: string, names: readonly string[]): Promise<void> {
    const dir = this.sessionDir(projectId, sessionId);
    await Promise.allSettled(
      names.filter(isFileName).map((name) => fs.rm(path.join(dir, name), { force: true })),
    );
  }

  async readFile(projectId: string, sessionId: string, name: string): Promise<Uint8Array | null> {
    if (!isFileName(name)) return null;
    try {
      return await fs.readFile(path.join(this.sessionDir(projectId, sessionId), name));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  /** One stored file as a stream, with its size; null when there is none by that name. */
  async openFile(
    projectId: string,
    sessionId: string,
    name: string,
  ): Promise<{ stream: NodeJS.ReadableStream; bytes: number } | null> {
    if (!isFileName(name)) return null;
    const file = path.join(this.sessionDir(projectId, sessionId), name);
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) return null;
      return { stream: createReadStream(file), bytes: stat.size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  /** Every run stored for a Session, newest first. */
  async runs(projectId: string, sessionId: string): Promise<RunRecord[]> {
    const dir = this.sessionDir(projectId, sessionId);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const records: RunRecord[] = [];
    for (const name of names) {
      if (!name.endsWith(".json") || !isRunId(name.slice(0, -5))) continue;
      const record = await this.readRun(projectId, sessionId, name.slice(0, -5));
      if (record !== null) records.push(record);
    }
    return records.sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
  }

  /** The files a Session's completed runs generated, newest first. */
  async files(projectId: string, sessionId: string): Promise<StoredFile[]> {
    return (await this.runs(projectId, sessionId)).flatMap((run) =>
      run.status !== "completed"
        ? []
        : run.files.map((file) => ({
            name: file.name,
            mimeType: file.mimeType,
            bytes: file.bytes,
            runId: run.id,
            operation: run.operation,
            createdAt: run.createdAt,
          })),
    );
  }

  private speechDir(projectId: string, sessionId: string): string {
    return path.join(this.sessionDir(projectId, sessionId), "read-aloud");
  }

  /** A reply's audio stored under `key`, or null when there is none whole on disk. */
  async readSpeech(
    projectId: string,
    sessionId: string,
    key: string,
  ): Promise<StoredSpeech | null> {
    if (!SPEECH_KEY.test(key)) return null;
    const dir = this.speechDir(projectId, sessionId);
    let meta: StoredSpeech;
    try {
      meta = JSON.parse(await fs.readFile(path.join(dir, `${key}.json`), "utf8")) as StoredSpeech;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT" || err instanceof SyntaxError)
        return null;
      throw err;
    }
    if (!isSpeechName(meta.name) || !meta.name.startsWith(`${key}.`)) return null;
    try {
      const stat = await fs.stat(path.join(dir, meta.name));
      return stat.isFile() && stat.size === meta.bytes && stat.size > 0 ? meta : null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  /** Stores a reply's audio under `key`: the audio first, then the record that points at it. */
  async writeSpeech(
    projectId: string,
    sessionId: string,
    key: string,
    file: { extension: string; mimeType: string; data: Uint8Array },
  ): Promise<StoredSpeech> {
    const name = `${key}.${file.extension}`;
    if (!SPEECH_KEY.test(key) || !isSpeechName(name))
      throw new Error(`'${name}' is not a speech file name.`);
    const dir = this.speechDir(projectId, sessionId);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await writeAtomic(path.join(dir, name), file.data);
    const meta: StoredSpeech = { name, mimeType: file.mimeType, bytes: file.data.byteLength };
    await writeAtomic(path.join(dir, `${key}.json`), JSON.stringify(meta));
    return meta;
  }

  /** A reply's stored audio as a stream, with its size; null when there is none by that name. */
  async openSpeech(
    projectId: string,
    sessionId: string,
    name: string,
  ): Promise<{ stream: NodeJS.ReadableStream; bytes: number } | null> {
    if (!isSpeechName(name)) return null;
    const file = path.join(this.speechDir(projectId, sessionId), name);
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) return null;
      return { stream: createReadStream(file), bytes: stat.size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async readPolish(projectId: string): Promise<PolishSettings> {
    try {
      const raw = JSON.parse(
        await fs.readFile(path.join(this.projectBase(projectId), "voice-polish.json"), "utf8"),
      ) as Partial<PolishSettings>;
      return {
        ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}),
        ...(typeof raw.prompt === "string" && raw.prompt.trim() !== ""
          ? { prompt: raw.prompt }
          : {}),
      };
    } catch (err) {
      // No file: nothing was ever set.
      if ((err as NodeJS.ErrnoException).code === "ENOENT" || err instanceof SyntaxError) return {};
      throw err;
    }
  }

  async writePolish(projectId: string, settings: PolishSettings): Promise<void> {
    const dir = this.projectBase(projectId);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await writeAtomic(path.join(dir, "voice-polish.json"), JSON.stringify(settings));
  }

  /**
   * Removes the folder of every Session that no longer exists in its Project (`exists` answers),
   * leaving `busy` ones — a run still in flight — for the next sweep. Answers how many it removed.
   */
  async sweep(
    exists: (projectId: string, sessionId: string) => boolean,
    busy: ReadonlySet<string>,
  ): Promise<number> {
    let removed = 0;
    let projects: string[];
    try {
      projects = await fs.readdir(this.root);
    } catch {
      return 0;
    }
    for (const projectId of projects) {
      if (!SEGMENT.test(projectId)) continue;
      const sessions = path.join(this.root, projectId, DIR, "sessions");
      let ids: string[];
      try {
        ids = await fs.readdir(sessions);
      } catch {
        continue;
      }
      for (const sessionId of ids) {
        if (busy.has(sessionId) || (SEGMENT.test(sessionId) && exists(projectId, sessionId)))
          continue;
        await fs.rm(path.join(sessions, sessionId), { recursive: true, force: true });
        removed += 1;
      }
    }
    return removed;
  }
}
