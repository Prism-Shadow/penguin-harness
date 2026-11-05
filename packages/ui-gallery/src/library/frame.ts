/**
 * The framed component library's contract with the gallery — pure, so it is unit-tested.
 *
 * A library page is its own document (`lib.html`), seeded and booted exactly as a framed app is
 * (src/app/frame.ts): the same preference params under the same storage keys, the same
 * pre-paint boot script, so the components render under the page's theme, mode, size and fonts
 * with no flash. `topic` names the board. The frame reports its content height to the page
 * through a window message, so the page gives the frame exactly the room the board takes.
 */
import { SEEDED_KEYS } from "../app/frame";
import type { FramePrefs } from "../app/frame";
import { FIRST_TOPIC, isTopicId } from "./topics";
import type { TopicId } from "./topics";

/** The frame's document, relative to the gallery's base. */
export const LIBRARY_FRAME_PATH = "/lib.html";

/** The `type` of the message a library frame posts with its content height. */
export const LIBRARY_HEIGHT_MESSAGE = "penguin-gallery:library-height";

export function libraryFrameSrc(base: string, prefs: FramePrefs, topic: TopicId): string {
  const params = new URLSearchParams();
  params.set("topic", topic);
  for (const key of Object.keys(SEEDED_KEYS)) params.set(key, prefs[key as keyof FramePrefs]);
  return `${base}${LIBRARY_FRAME_PATH}?${params.toString()}`;
}

export interface LibraryParams {
  topic: TopicId;
  lang: "en" | "zh";
}

/** What a library frame reads back from its own URL; an unknown topic opens the first. */
export function parseLibraryParams(search: string): LibraryParams {
  const params = new URLSearchParams(search);
  const topic = params.get("topic") ?? "";
  return {
    topic: isTopicId(topic) ? topic : FIRST_TOPIC,
    lang: params.get("lang") === "zh" ? "zh" : "en",
  };
}
