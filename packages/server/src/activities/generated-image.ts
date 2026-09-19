import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { contentRevision, type ActivityDetail } from "./domain.js";
import { HttpError } from "../http/errors.js";

export const IMAGE_MODEL = "gemini-3.1-flash-image";
export const GENERATED_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export interface ImageTarget {
  language: string;
  assetKey: string;
  prompt: string;
  model: string;
}
export interface ImageResult {
  runId: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  mimeType: "image/png";
}

export function imageTarget(
  activity: ActivityDetail,
  input: { language: string; assetKey: string },
): ImageTarget {
  const plan = activity.draft.mediaPlan;
  if (
    !plan ||
    activity.draft.status !== "valid" ||
    plan.specRevision !== contentRevision(activity.draft.spec)
  )
    throw new HttpError(409, "media_stale", "Rebuild the media plan before generating an image.");
  const asset = plan.manifest.assets[input.language]?.find((entry) => entry.key === input.assetKey);
  if (
    !asset ||
    asset.type !== "image" ||
    !asset.description.trim() ||
    asset.description.length > 5000
  )
    throw new HttpError(
      422,
      "image_invalid",
      "Select an image with a saved description of 1–5000 characters.",
    );
  return { ...input, prompt: asset.description, model: IMAGE_MODEL };
}

/** Validate bounded static PNG structure and checksums before a candidate can be published. */
export function inspectPng(input: Uint8Array, runId: string): ImageResult {
  const bytes = Buffer.from(input);
  const invalid = () =>
    new Error("Image output must be a complete PNG up to 8 MiB and 4096 × 4096 pixels.");
  if (
    bytes.length < 57 ||
    bytes.length > GENERATED_IMAGE_MAX_BYTES ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw invalid();
  let offset = 8,
    width = 0,
    height = 0,
    data = false,
    ended = false;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const end = offset + 12 + size;
    if (end > bytes.length) throw invalid();
    const kind = bytes.toString("ascii", offset + 4, offset + 8);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw invalid();
    if (offset === 8 && kind !== "IHDR") throw invalid();
    if (kind === "IHDR") {
      if (offset !== 8 || size !== 13) throw invalid();
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
      if (!width || !height || width > 4096 || height > 4096) throw invalid();
      const depths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !depths[bytes[offset + 17]!]?.includes(bytes[offset + 16]!) ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        bytes[offset + 20]! > 1
      )
        throw invalid();
    } else if (kind === "IDAT") {
      if (size) data = true;
    } else if (kind === "acTL") throw invalid();
    else if (kind === "IEND") {
      if (size || !data || end !== bytes.length) throw invalid();
      ended = true;
    }
    offset = end;
  }
  if (!ended || offset !== bytes.length) throw invalid();
  return {
    runId,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    width,
    height,
    mimeType: "image/png",
  };
}

export const imagePrompt = `Generate the single image candidate specified in image-input.json.
The supplied generate-image.mjs helper calls the configured image provider through AgentHub and reads GEMINI_API_KEY only from the Agent Vault-injected process environment.
Use normal Harness exec_command approval for npm install --ignore-scripts and node generate-image.mjs. Do not print credentials or read them into your context. Do not edit the supplied helper, package.json or input files. Do not delegate or write outside this workspace.
Run the helper once. It writes image.png. Never draw a substitute or change the provider, model or prompt. If credentials, installation or the provider fail, report the failure and stop; do not retry a billable provider request automatically.
Finish only after the helper succeeds. The user will inspect and explicitly accept the candidate; do not edit activity drafts or replace accepted media.`;
