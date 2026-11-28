/**
 * QQ rich-media upload: turns bytes into the `file_info` handle a `msg_type: 7` message
 * carries. Nothing here sends a message — registering a file costs no reply slot, which is
 * why the connector can upload first and decide about the slot afterwards (qq-connector.ts).
 *
 * The platform offers three ways in and this product uses two of them:
 *
 *   - `url`: the platform downloads a PUBLIC https address. Unusable here — this server has
 *     no public address, and a file the Agent wrote lives on its disk. (It is the same
 *     requirement that once made this channel refuse files outright.)
 *   - `file_data`: the bytes inline, base64, in the `files` call itself. The platform caps it
 *     at 5MB; the cutoff below sits under that after base64's one-third growth.
 *   - chunked: `upload_prepare` answers an `upload_id`, a `block_size` and one presigned
 *     storage URL per part; each part is PUT there and acknowledged with `upload_part_finish`;
 *     a final `files` call carrying the `upload_id` merges them into the `file_info`.
 *
 * The scene matters twice: a file registered under `/v2/users/…` can only be sent to a
 * single chat and one under `/v2/groups/…` only to a group, and the prepare / part-finish
 * endpoints name their path parameter differently from `files` (`{user_id}`, `{group_id}`
 * vs `{user_openid}`, `{group_openid}`) while taking the same openid.
 *
 * The HTTP itself (token, timeouts, error typing) belongs to the production client in
 * qq-api.ts, which hands this module the two verbs it needs as a {@link QQUploadWire} — so
 * the request shapes here are exactly what a fake HTTP server sees.
 */
import { createHash } from "node:crypto";
import type { QQChatKind } from "./qq-api.js";

/** `file_type` on the wire: 1 image, 2 video, 3 voice, 4 any other file. */
export type QQFileType = 1 | 2 | 3 | 4;

/**
 * Largest file sent inline as `file_data`. The platform's cap is 5MB; base64 grows the
 * payload by a third, and the documentation does not say which side of the encoding the cap
 * counts, so this stays under it on the pessimistic reading.
 */
export const QQ_DIRECT_UPLOAD_MAX_BYTES = 3_500_000;

/**
 * The bytes of the file's first `md5_10m` window — a fixed 10002432 bytes (the platform's
 * own constant, a little under 10MiB) that its instant-upload check hashes.
 */
const MD5_WINDOW_BYTES = 10_002_432;

/** The two requests an upload makes, supplied by whoever owns the credentials. */
export interface QQUploadWire {
  /** An authenticated OpenAPI POST; resolves the parsed JSON body, throws on a refusal. */
  post(path: string, payload: Record<string, unknown>, timeoutMs: number): Promise<unknown>;
  /** A presigned-URL PUT of one part; no QQ credentials ride it. Throws on a failure. */
  put(url: string, bytes: Buffer): Promise<void>;
}

export interface QQUploadArgs {
  kind: QQChatKind;
  openid: string;
  fileType: QQFileType;
  fileName: string;
  data: Buffer;
}

export interface QQUploadTuning {
  /** Attempts per part PUT (default 3). */
  partAttempts?: number;
  /** Pause between attempts in ms (default: the platform's `retry_delay`, capped at 5s). */
  retryDelayMs?: number;
}

interface PrepareResponse {
  upload_id?: string;
  block_size?: string | number;
  parts?: Array<{ index?: number; presigned_url?: string; block_size?: string | number }>;
  upload_config?: { retry_delay?: number };
}

const QUICK_CALL_MS = 15_000;
// The merge call and an inline upload carry or wait on real bytes.
const SLOW_CALL_MS = 60_000;

const digest = (algo: "md5" | "sha1", bytes: Buffer): string =>
  createHash(algo).update(bytes).digest("hex");

function sceneRoot(kind: QQChatKind, openid: string): string {
  const id = encodeURIComponent(openid);
  return kind === "group" ? `/v2/groups/${id}` : `/v2/users/${id}`;
}

function fileInfoOf(body: unknown): string {
  const info = (body as { file_info?: unknown } | null)?.file_info;
  if (typeof info !== "string" || info === "") {
    throw new Error("QQ accepted the upload but returned no file_info");
  }
  return info;
}

/** Registers the bytes with QQ and returns the `file_info` handle for a media message. */
export async function uploadQQMedia(
  wire: QQUploadWire,
  args: QQUploadArgs,
  tuning: QQUploadTuning = {},
): Promise<string> {
  const root = sceneRoot(args.kind, args.openid);
  const filesPath = `${root}/files`;
  if (args.data.length <= QQ_DIRECT_UPLOAD_MAX_BYTES) {
    const body = await wire.post(
      filesPath,
      {
        file_type: args.fileType,
        file_name: args.fileName,
        file_data: args.data.toString("base64"),
        srv_send_msg: false,
      },
      SLOW_CALL_MS,
    );
    return fileInfoOf(body);
  }

  const prepared = (await wire.post(
    `${root}/upload_prepare`,
    {
      file_type: args.fileType,
      file_size: String(args.data.length),
      file_name: args.fileName,
      md5: digest("md5", args.data),
      sha1: digest("sha1", args.data),
      md5_10m: digest("md5", args.data.subarray(0, MD5_WINDOW_BYTES)),
    },
    QUICK_CALL_MS,
  )) as PrepareResponse;
  const uploadId = prepared.upload_id;
  const blockSize = Number(prepared.block_size);
  const parts = prepared.parts ?? [];
  if (typeof uploadId !== "string" || uploadId === "" || !(blockSize > 0) || parts.length === 0) {
    throw new Error("QQ answered the upload preparation without an upload id or parts");
  }
  const attempts = tuning.partAttempts ?? 3;
  const delayMs =
    tuning.retryDelayMs ??
    Math.min(Math.max(prepared.upload_config?.retry_delay ?? 1, 0), 5) * 1000;
  for (const part of [...parts].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
    const index = part.index ?? 0;
    const url = part.presigned_url;
    if (typeof url !== "string" || url === "") throw new Error(`QQ gave no URL for part ${index}`);
    const chunk = args.data.subarray(index * blockSize, (index + 1) * blockSize);
    for (let attempt = 1; ; attempt++) {
      try {
        await wire.put(url, chunk);
        break;
      } catch (err) {
        if (attempt >= attempts) throw err;
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    await wire.post(
      `${root}/upload_part_finish`,
      {
        upload_id: uploadId,
        part_index: index,
        block_size: String(chunk.length),
        md5: digest("md5", chunk),
      },
      QUICK_CALL_MS,
    );
  }
  const merged = await wire.post(
    filesPath,
    {
      file_type: args.fileType,
      file_name: args.fileName,
      upload_id: uploadId,
      srv_send_msg: false,
    },
    SLOW_CALL_MS,
  );
  return fileInfoOf(merged);
}
