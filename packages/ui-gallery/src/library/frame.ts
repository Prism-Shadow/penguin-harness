/**
 * The framed component library's contract with the gallery — pure, so it is unit-tested.
 *
 * A library page is its own document (`lib.html`), seeded and booted exactly as a framed app is
 * (src/app/frame.ts): the same preference params under the same storage keys, the same
 * pre-paint boot script, so the components render under the page's theme, mode, size and fonts
 * with no flash. `topic` names the board, and `part` one piece of it a board frames for itself.
 * The frame reports its content height to the page around it through a window message, so the
 * page gives the frame exactly the room the board takes.
 */
import { SEEDED_KEYS } from "../app/frame";
import type { FramePrefs } from "../app/frame";
import { FIRST_TOPIC, isTopicId } from "./topics";
import type { TopicId } from "./topics";

/** The frame's document, relative to the gallery's base. */
export const LIBRARY_FRAME_PATH = "/lib.html";

/** The `type` of the message a library frame posts with its content height. */
export const LIBRARY_HEIGHT_MESSAGE = "penguin-gallery:library-height";

/**
 * The pieces of a board a frame may open alone, in place of the whole board: `waiting`, the
 * Loading board's waiting samples, which that board frames once per theme so the themes' waits
 * compare side by side — a theme's recipes key on the document root, so a document shows one.
 */
export const LIBRARY_PARTS = ["waiting"] as const;
export type LibraryPart = (typeof LIBRARY_PARTS)[number];

const isLibraryPart = (value: string | null): value is LibraryPart =>
  (LIBRARY_PARTS as readonly (string | null)[]).includes(value);

export function libraryFrameSrc(
  base: string,
  prefs: FramePrefs,
  topic: TopicId,
  part?: LibraryPart,
): string {
  const params = new URLSearchParams();
  params.set("topic", topic);
  if (part !== undefined) params.set("part", part);
  for (const key of Object.keys(SEEDED_KEYS)) params.set(key, prefs[key as keyof FramePrefs]);
  return `${base}${LIBRARY_FRAME_PATH}?${params.toString()}`;
}

export interface LibraryParams {
  topic: TopicId;
  lang: "en" | "zh";
  /** The piece of the board the frame opens alone; the whole board when absent. */
  part?: LibraryPart;
}

/** What a library frame reads back from its own URL; an unknown topic opens the first. */
export function parseLibraryParams(search: string): LibraryParams {
  const params = new URLSearchParams(search);
  const topic = params.get("topic") ?? "";
  const part = params.get("part");
  return {
    topic: isTopicId(topic) ? topic : FIRST_TOPIC,
    lang: params.get("lang") === "zh" ? "zh" : "en",
    ...(isLibraryPart(part) ? { part } : {}),
  };
}
