/**
 * Scene compositions (experimental, behind `activityVideoExperiment`): an agent writes a
 * short animated HTML page for one scene from its description and images, and the author
 * watches it in the studio before anything is recorded.
 *
 * The page is agent-written, so everything here is about keeping it small and closed: it is
 * built from a Penguin template whose content policy forbids the network, it may use only the
 * files staged beside it (the scene's images, the vendored GSAP build and Penguin's bridge
 * script), and it is served only on the preview origin (see composition-service.ts). The
 * checks below are static; the content policy and the preview origin are what hold at runtime.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import type { Opaque } from "@prismshadow/penguin-core/kernel";
import { HttpError } from "../http/errors.js";
import { contentRevision, type ActivityDetail } from "./domain.js";
import type { MediaAsset } from "./media.js";
import type {
  CompositionFrame,
  CompositionProblemCode,
  CompositionTarget,
} from "./composition-types.js";

export const COMPOSITION_FILE = "composition.html";
export const COMPOSITION_FRAMES_FILE = "frames.json";
export const COMPOSITION_INPUT_FILE = "composition-input.json";
export const COMPOSITION_TEMPLATE_FILE = "composition-template.html";
export const COMPOSITION_GSAP_FILE = "gsap.min.js";
export const COMPOSITION_BRIDGE_FILE = "penguin-composition.js";
export const COMPOSITION_IMAGE_DIR = "images";
export const COMPOSITION_MAX_BYTES = 512 * 1024;
export const COMPOSITION_FRAMES_MAX_BYTES = 64 * 1024;

/** Seconds per storyboard frame the agent is asked for, and the bounds of the whole. */
export const FRAME_SECONDS = 3;
export const MIN_SECONDS = 6;
export const MAX_SECONDS = 60;
const MAX_FRAMES = 20;

/** The template's content policy: nothing but the page's own files and inline code. */
export const COMPOSITION_CSP = "default-src 'self' 'unsafe-inline'";

/** The canvas when the specification names no usable resolution. */
const DEFAULT_SIZE = { width: 640, height: 480 };

/** One file of a kept composition, as the preview origin serves it. */
export interface CompositionFileContent {
  contentType: string;
  body: Opaque<"Uint8Array", Uint8Array>;
}

/** A failed check of what the agent wrote, with the code the App words. */
export class CompositionProblem extends Error {
  constructor(
    readonly code: CompositionProblemCode,
    message: string,
  ) {
    super(message);
  }
}

/** The activity's `runtime.resolution` as a canvas, or 640 × 480. */
export function compositionSize(spec: Record<string, unknown> | null | undefined): {
  width: number;
  height: number;
} {
  const resolution = (spec?.runtime as { resolution?: unknown } | undefined)?.resolution;
  const match = typeof resolution === "string" ? /^(\d{2,4})x(\d{2,4})$/.exec(resolution) : null;
  if (!match) return { ...DEFAULT_SIZE };
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 64 || height < 64 || width > 3840 || height > 2160) return { ...DEFAULT_SIZE };
  return { width, height };
}

/** What a composition run needs from the draft, before any image is read. */
export interface CompositionScene {
  sceneId: string;
  description: string;
  assetDescription: string;
  width: number;
  height: number;
  /** The scene's images that have a file bound, in plan order. */
  images: MediaAsset[];
}

/**
 * The scene a video or animation asset belongs to, and its bound images. Refuses an asset of
 * another type, one no scene uses, and a stale media plan; the caller refuses a scene with no
 * bound image, once it knows none can be read.
 */
export function compositionScene(
  activity: ActivityDetail,
  input: { language: string; assetKey: string },
): CompositionScene {
  const plan = activity.draft.mediaPlan;
  if (
    !plan ||
    activity.draft.status !== "valid" ||
    plan.specRevision !== contentRevision(activity.draft.spec)
  )
    throw new HttpError(
      409,
      "media_stale",
      "Rebuild the media plan before composing a scene video.",
    );
  const group = plan.manifest.assets[input.language] ?? [];
  const asset = group.find((entry) => entry.key === input.assetKey);
  if (!asset || (asset.type !== "video" && asset.type !== "animation"))
    throw new HttpError(
      422,
      "composition_asset_invalid",
      "Select a video or animation asset to compose.",
    );
  const sceneId = asset.usages[0]?.sceneId;
  const spec = activity.draft.spec as Record<string, unknown>;
  const scenes = (spec.scenes ?? spec.stages) as Record<string, unknown>[];
  const scene = scenes.find((entry) => String(entry.id) === sceneId);
  if (!sceneId || !scene)
    throw new HttpError(
      422,
      "composition_asset_invalid",
      "This asset is not used by any scene, so there is nothing to compose.",
    );
  return {
    sceneId,
    description: String(scene.description ?? ""),
    assetDescription: asset.description,
    ...compositionSize(spec),
    images: group.filter(
      (entry) =>
        entry.type === "image" &&
        !!entry.path &&
        entry.usages.some((usage) => usage.sceneId === sceneId),
    ),
  };
}

/** The extension a staged image is given, by its content type. */
export function imageExtension(mimeType: string): string {
  return mimeType === "image/jpeg"
    ? "jpg"
    : mimeType === "image/gif"
      ? "gif"
      : mimeType === "image/webp"
        ? "webp"
        : "png";
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The input file the agent reads, as staged. */
export function compositionInput(scene: CompositionScene, target: CompositionTarget) {
  return {
    sceneId: scene.sceneId,
    description: scene.description,
    assetDescription: scene.assetDescription,
    width: target.width,
    height: target.height,
    frameSeconds: FRAME_SECONDS,
    minSeconds: MIN_SECONDS,
    maxSeconds: MAX_SECONDS,
    images: target.images.map((image) => ({ key: image.key, file: image.file })),
  };
}

/** The Penguin template the agent writes its page from, sized to the canvas. */
export function compositionTemplate(width: number, height: number): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${COMPOSITION_CSP}" />
    <title>Scene composition</title>
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        background: #000;
        overflow: hidden;
      }
      #stage {
        position: relative;
        overflow: hidden;
        width: ${width}px;
        height: ${height}px;
        background: #fff;
      }
    </style>
    <script src="${COMPOSITION_GSAP_FILE}"></script>
    <script src="${COMPOSITION_BRIDGE_FILE}"></script>
  </head>
  <body>
    <div id="stage" data-duration="0">
      <!-- The frames go here: elements positioned inside the stage, using images/ files. -->
    </div>
    <script>
      // One paused timeline drives everything the page shows. Penguin plays and records it.
      const timeline = gsap.timeline({ paused: true });
      // timeline.to(...), timeline.from(...), one section per frame of frames.json.
      window.__composition.timeline = timeline;
    </script>
  </body>
</html>
`;
}

/**
 * Penguin's bridge, loaded by every composition: it provides the `window.__composition`
 * contract (`duration`, `ready`, `timeline`), stamps the stage's `data-duration` once the page
 * has loaded, and lets the studio play, pause and restart the timeline by message. It is
 * served from here, never from the run's workspace, so the agent cannot change it.
 */
export const COMPOSITION_BRIDGE = `(function () {
  "use strict";
  var settle;
  var ready = new Promise(function (resolve) {
    settle = resolve;
  });
  window.__composition = { duration: 0, ready: ready, timeline: null };
  function current() {
    var composition = window.__composition;
    if (!composition || typeof composition !== "object") return null;
    if (!composition.ready) composition.ready = ready;
    return composition;
  }
  function timelineOf(composition) {
    var timeline = composition && composition.timeline;
    return timeline && typeof timeline.play === "function" ? timeline : null;
  }
  function tell(state) {
    if (window.parent === window) return;
    var composition = current();
    var timeline = timelineOf(composition);
    window.parent.postMessage(
      {
        source: "penguin-composition",
        state: state,
        duration: composition ? composition.duration : 0,
        time: timeline ? timeline.time() : 0,
      },
      "*",
    );
  }
  window.addEventListener("load", function () {
    var composition = current();
    var timeline = timelineOf(composition);
    if (composition && timeline) {
      if (!composition.duration) composition.duration = timeline.duration();
      timeline.eventCallback("onComplete", function () {
        tell("ended");
      });
    }
    var stage = document.getElementById("stage");
    if (stage && composition) stage.setAttribute("data-duration", String(composition.duration));
    settle(composition ? composition.duration : 0);
    tell(timeline ? "ready" : "broken");
  });
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.source !== "penguin-studio") return;
    var timeline = timelineOf(current());
    if (!timeline) return;
    if (data.action === "play") {
      if (timeline.progress() >= 1) timeline.restart();
      else timeline.play();
      tell("playing");
    } else if (data.action === "pause") {
      timeline.pause();
      tell("paused");
    } else if (data.action === "restart") {
      timeline.restart();
      tell("playing");
    }
  });
})();
`;

let gsap: Promise<Buffer> | null = null;
/** GSAP's browser build, as the installed package ships it. */
export function gsapSource(): Promise<Buffer> {
  gsap ??= fs.readFile(createRequire(import.meta.url).resolve("gsap/dist/gsap.min.js"));
  return gsap;
}

export const compositionPrompt = `Compose a short animated scene for this activity. Work in this workspace.
Read ${COMPOSITION_INPUT_FILE}: the scene's description, the description of the video or animation asset, the canvas size, and the scene's images (each a file under ${COMPOSITION_IMAGE_DIR}/). description.md and input.json describe the whole activity.
Write two files:
1. ${COMPOSITION_FILE}: start from ${COMPOSITION_TEMPLATE_FILE} and keep its head as it is (the Content-Security-Policy meta tag, ${COMPOSITION_GSAP_FILE} and ${COMPOSITION_BRIDGE_FILE}) and the #stage element at the canvas size. Build the scene inside #stage from the staged images and plain HTML and CSS. Animate it with one GSAP timeline created paused, gsap.timeline({ paused: true }), and assign it to window.__composition.timeline; drive every change from that timeline, with no timers or event handlers of your own. It must be deterministic: no Math.random or other randomness. Use only the staged files, referenced by their relative paths (${COMPOSITION_IMAGE_DIR}/<file>, ${COMPOSITION_GSAP_FILE}, ${COMPOSITION_BRIDGE_FILE}); never load anything from the network (no http or https URLs, fonts, CDNs or fetch). Keep it under 512 KB.
2. ${COMPOSITION_FRAMES_FILE}: {"frames": [{"id": "frame-1", "description": "what this frame shows", "seconds": 3}]} describing each storyboard frame in order, about ${FRAME_SECONDS} seconds each, ${MIN_SECONDS} to ${MAX_SECONDS} seconds in total, matching the timeline.
Do not edit the staged files. Do not delegate this task.
Use Harness's normal approval flow for tool actions. Finish only after writing both files.`;

/**
 * The frames an agent described, checked: 1–20 frames with unique ids, a description and a
 * positive length each, 6–60 seconds in all.
 */
export function parseFrames(text: string): { frames: CompositionFrame[]; seconds: number } {
  const fail = (detail: string): never => {
    throw new CompositionProblem("composition_frames", `${COMPOSITION_FRAMES_FILE} ${detail}`);
  };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail("is not valid JSON.");
  }
  const list = (value as { frames?: unknown } | null)?.frames;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_FRAMES)
    return fail(`must list 1 to ${MAX_FRAMES} frames.`);
  const ids = new Set<string>();
  const frames = list.map((entry: unknown, index): CompositionFrame => {
    const frame = (entry ?? {}) as Record<string, unknown>;
    const { id, description, seconds } = frame;
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id) || ids.has(id))
      return fail(`frame ${index + 1} needs a unique id of letters, digits, _ or -.`);
    ids.add(id);
    if (typeof description !== "string" || !description.trim() || description.length > 1000)
      return fail(`frame ${id} needs a description of 1-1000 characters.`);
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0)
      return fail(`frame ${id} needs a positive number of seconds.`);
    return { id, description: description.trim(), seconds };
  });
  const seconds = Math.round(frames.reduce((sum, frame) => sum + frame.seconds, 0) * 1000) / 1000;
  if (seconds < MIN_SECONDS || seconds > MAX_SECONDS)
    return fail(
      `adds up to ${seconds} seconds; a composition runs ${MIN_SECONDS} to ${MAX_SECONDS}.`,
    );
  return { frames, seconds };
}

/**
 * Everything a page's markup and styles name as a file: tag attributes, `srcset`, stylesheet
 * `url(...)` and `@import`. Script bodies and comments are left out: a variable named `src`
 * is not a reference, and the content policy stops a script's own requests anyway.
 */
function references(html: string): string[] {
  const markup = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi, "$1$2");
  const found: string[] = [];
  for (const [tag] of markup.matchAll(/<[A-Za-z][^>]*>/g)) {
    for (const match of tag.matchAll(
      /\s(?:src|href|poster|data|action|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi,
    ))
      found.push(match[1] ?? match[2] ?? match[3] ?? "");
    for (const match of tag.matchAll(/\ssrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi))
      for (const candidate of (match[1] ?? match[2] ?? "").split(","))
        found.push(candidate.trim().split(/\s+/)[0] ?? "");
  }
  for (const match of markup.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi))
    found.push(match[1] ?? match[2] ?? match[3] ?? "");
  for (const match of markup.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi))
    found.push(match[1]!);
  return found.map((value) => value.trim()).filter((value) => value && !value.startsWith("#"));
}

/**
 * The first problem with a page the agent wrote, or null. `staged` is every file the page may
 * name, by its relative path.
 */
export function compositionProblem(
  html: string,
  staged: ReadonlySet<string>,
): CompositionProblem | null {
  if (Buffer.byteLength(html, "utf8") > COMPOSITION_MAX_BYTES)
    return new CompositionProblem("composition_size", `${COMPOSITION_FILE} is larger than 512 KB.`);
  const csp = /<meta\s[^>]*http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/i.exec(html);
  if (!csp || !csp[0].includes(`content="${COMPOSITION_CSP}"`))
    return new CompositionProblem(
      "composition_template",
      `${COMPOSITION_FILE} dropped the template's Content-Security-Policy meta tag.`,
    );
  if (!new RegExp(`<script\\s+src\\s*=\\s*["']${COMPOSITION_BRIDGE_FILE}["']`, "i").test(html))
    return new CompositionProblem(
      "composition_template",
      `${COMPOSITION_FILE} no longer loads ${COMPOSITION_BRIDGE_FILE}.`,
    );
  if (!/\bid\s*=\s*["']?stage\b/i.test(html))
    return new CompositionProblem(
      "composition_template",
      `${COMPOSITION_FILE} has no #stage element.`,
    );
  const network =
    /\b(?:https?|wss?|ftp):\/\//i.exec(html) ??
    /\bfetch\s*\(|\bnew\s+(?:XMLHttpRequest|WebSocket|EventSource)\b|\b(?:importScripts|sendBeacon)\s*\(/.exec(
      html,
    );
  if (network) {
    // The whole address, not just its scheme, so the author can see what it was.
    const reached = html.slice(network.index, network.index + 80).split(/[\s"'<>)]/)[0];
    return new CompositionProblem(
      "composition_network",
      `${COMPOSITION_FILE} reaches the network (${reached}); it may use only its staged files.`,
    );
  }
  for (const reference of references(html)) {
    if (reference.startsWith("//"))
      return new CompositionProblem(
        "composition_network",
        `${COMPOSITION_FILE} reaches the network (${reference.slice(0, 60)}); it may use only its staged files.`,
      );
    const file = reference.replace(/^\.\//, "").replace(/[?#].*$/, "");
    if (!staged.has(file))
      return new CompositionProblem(
        "composition_reference",
        `${COMPOSITION_FILE} refers to ${reference.slice(0, 80)}, which was not staged for it.`,
      );
  }
  if (/\bMath\s*\.\s*random\b|\bgetRandomValues\b|\brandomUUID\b/.test(html))
    return new CompositionProblem(
      "composition_random",
      `${COMPOSITION_FILE} uses randomness; a composition must play the same way every time.`,
    );
  if (!/\bgsap\s*\.\s*timeline\s*\(/.test(html) || !/__composition\s*\.\s*timeline\s*=/.test(html))
    return new CompositionProblem(
      "composition_timeline",
      `${COMPOSITION_FILE} must create one paused GSAP timeline and assign it to window.__composition.timeline.`,
    );
  return null;
}

/** The files a composition may name: the vendored scripts and its staged images. */
export function stagedFiles(target: CompositionTarget): Set<string> {
  return new Set([
    COMPOSITION_GSAP_FILE,
    COMPOSITION_BRIDGE_FILE,
    ...target.images.map((image) => image.file),
  ]);
}
