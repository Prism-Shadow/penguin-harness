/**
 * Session creation helpers (used by `agent.createSession` for assembly, not exported
 * via the barrel): Session id generation, runtime environment fields, and temp
 * Workspace creation.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

import { formatLocalDate } from "./dates.js";
import type { SessionEnvironmentValues } from "../state/agent-state.js";
import { workspacesDir } from "../state/index.js";
import { userText } from "../omnimessage/index.js";
import type { OmniMessage } from "../omnimessage/index.js";

/** Session runtime environment fields: the placeholder substitution values for `assembleSystemPrompt`; producer and consumer share the same type. */
export type SessionEnvironment = SessionEnvironmentValues;

/** Generate a Session id of the form `session-YYYY-MM-DD-HH-mm-ss-<8-hex>` (local timezone, zero-padded: 4-digit year, 2 digits for the rest; hex from randomUUID). */
export function formatSessionId(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const ts =
    `${formatLocalDate(date)}` +
    `-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  const hex = randomUUID().replace(/-/g, "").slice(0, 8);
  return `session-${ts}-${hex}`;
}

/**
 * Generate this Session's runtime environment fields (injected via specific
 * placeholders in the system prompt).
 * This is system-generated runtime context, not sourced from Agent State / Workspace files.
 */
export function sessionEnvironment(
  workspaceDir: string,
  sessionId: string,
  ids: { agentId: string; projectDir: string; provider: string; modelId: string },
  date = new Date(),
): SessionEnvironment {
  return {
    sessionId,
    cwd: workspaceDir,
    agentId: ids.agentId,
    projectDir: ids.projectDir,
    provider: ids.provider,
    modelId: ids.modelId,
    platform: process.platform,
    osVersion: getOsVersion(),
    date: formatLocalDate(date),
  };
}

function getOsVersion(): string {
  // os.* is a stable built-in API that normally doesn't throw; but this function only
  // builds a single line of environment info for the system prompt, so it's not worth
  // letting an exception take down createSession — fall back to "unknown" instead.
  try {
    if (process.platform === "win32") {
      return `${os.version()} ${os.release()}`;
    }
    return `${os.type()} ${os.release()}`;
  } catch {
    return "unknown";
  }
}

/** The 8-hex space is 2^32, so the odds of consecutive collisions are negligible; the cap only guards against an infinite loop caused by an abnormal filesystem. */
const MAX_TMP_ID_ATTEMPTS = 16;

/**
 * Create a temporary Workspace under `<agent>/workspaces/<workspace_id>`, where the
 * directory name is the workspace_id, shaped like `tmp-<8hex>`; if it collides with
 * an existing directory, regenerate the id. No symlinks are created inside the Workspace:
 * the model composes absolute paths (to Agent State, scratchpad, etc.) directly from the
 * Environment placeholders (Agents Dir / Agent ID) in the system prompt.
 */
export async function createTempWorkspace(
  root: string,
  projectId: string,
  agentId: string,
): Promise<string> {
  const base = workspacesDir(root, projectId, agentId);
  await fs.mkdir(base, { recursive: true });
  // The final directory must use a non-recursive mkdir: recursive mkdir succeeds
  // silently when the directory already exists, which would put a new Session into
  // an existing temp Workspace; EEXIST means an id collision, so retry with a new id.
  for (let attempt = 0; attempt < MAX_TMP_ID_ATTEMPTS; attempt++) {
    const dir = path.join(base, `tmp-${randomUUID().slice(0, 8)}`);
    try {
      await fs.mkdir(dir);
      return dir;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new Error(
    `failed to allocate a unique temp workspace id under ${base} after ${MAX_TMP_ID_ATTEMPTS} attempts`,
  );
}

/** Maps a data URL's mime type to a file extension on disk; unknown mimes use bin (the image-reading tool sniffs the magic bytes and doesn't rely on the extension). */
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * Input conversion for when the session model doesn't support images: image messages
 * in the `run` input are written to disk as files (base64 data URLs are saved to the
 * session scratchpad; http(s) URLs are referenced
 * as-is), and the path/URL is appended to the user text (an `[attached image: …]`
 * line); the image message itself is removed from the input — the model views it by
 * path via describe_image (read on its behalf by a vision model), and images never
 * enter that session's history directly.
 * Returns the input unchanged when there are no images; an image that can't be
 * parsed is replaced with an explanatory line rather than silently dropped.
 */
export async function imagesToScratchpadPaths(
  input: OmniMessage[],
  dir: string,
): Promise<OmniMessage[]> {
  const isImage = (m: OmniMessage): boolean =>
    (m.payload as { type?: string }).type === "image_url";
  if (!input.some(isImage)) return input;

  const lines: string[] = [];
  for (const msg of input) {
    if (!isImage(msg)) continue;
    const url = (msg.payload as { image_url?: string }).image_url ?? "";
    if (/^https?:\/\//i.test(url)) {
      lines.push(`[attached image: ${url}]`);
      continue;
    }
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(url);
    if (!match) {
      lines.push("[an attached image could not be saved and was dropped]");
      continue;
    }
    await fs.mkdir(dir, { recursive: true });
    const ext = MIME_TO_EXT[match[1]!.toLowerCase()] ?? "bin";
    // Filename = upload-<8 random hex chars> (same convention as project-<8hex>; the
    // prefix distinguishes model-generated temp files).
    // "wx" flag does exclusive creation to avoid name collisions: on the rare chance of a collision, retry with a new random value.
    let file: string;
    for (;;) {
      file = path.join(dir, `upload-${randomBytes(4).toString("hex")}.${ext}`);
      try {
        await fs.writeFile(file, Buffer.from(match[2]!, "base64"), { flag: "wx" });
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    }
    lines.push(`[attached image: ${file}]`);
  }

  // Concatenation: the path lines are appended after the last user text message; if the input is images only, add a plain path-only text message.
  const rest = input.filter((m) => !isImage(m));
  const suffix = lines.join("\n");
  const lastTextIdx = rest.findLastIndex((m) => {
    const p = m.payload as { type?: string; role?: string };
    return p.type === "text" && p.role === "user";
  });
  if (lastTextIdx === -1) return [...rest, userText(suffix)];
  return rest.map((m, i) => {
    if (i !== lastTextIdx) return m;
    const p = m.payload as { type: string; role: string; text: string };
    return { ...m, payload: { ...p, text: `${p.text}\n\n${suffix}` } } as OmniMessage;
  });
}
