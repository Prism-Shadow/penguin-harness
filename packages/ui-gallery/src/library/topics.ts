/**
 * The component library's pages, one per topic: the Web App's real components by kind, then the
 * boards of the token vocabulary. Value-import-free, so the screenshot script and the tests can
 * read it under Node; the titles live in the dictionaries, keyed by these ids.
 *
 * Each topic renders in its own framed document (`lib.html`, src/library/main.tsx) under the
 * page's theme, mode, size and fonts; `room` is the height a frame keeps under a short board
 * whose controls open panels or dialogs inside it, so nothing is cut off at the frame's edge.
 */

export const TOPIC_GROUP_IDS = ["components", "foundations"] as const;
export type TopicGroupId = (typeof TOPIC_GROUP_IDS)[number];

export const TOPIC_IDS = [
  "buttons",
  "inputs",
  "pickers",
  "toasts",
  "notices",
  "dialogs",
  "tooltips",
  "tabs",
  "badges",
  "empty",
  "loading",
  "charts",
  "avatars",
  "files",
  "colour",
  "type",
  "shape",
  "density",
  "focus",
  "motion",
  "icons",
  "hooks",
] as const;
export type TopicId = (typeof TOPIC_IDS)[number];

export interface Topic {
  id: TopicId;
  group: TopicGroupId;
  /** The frame's minimum height in px, for a board whose panels open inside it. */
  room?: number;
}

const component = (id: TopicId, room?: number): Topic => ({
  id,
  group: "components",
  ...(room === undefined ? {} : { room }),
});
const foundation = (id: TopicId): Topic => ({ id, group: "foundations" });

export const TOPICS: readonly Topic[] = [
  component("buttons"),
  component("inputs"),
  component("pickers", 560),
  component("toasts", 360),
  component("notices"),
  component("dialogs", 560),
  component("tooltips", 320),
  component("tabs"),
  component("badges"),
  component("empty"),
  component("loading"),
  component("charts"),
  component("avatars"),
  component("files"),
  foundation("colour"),
  foundation("type"),
  foundation("shape"),
  foundation("density"),
  foundation("focus"),
  foundation("motion"),
  foundation("icons"),
  foundation("hooks"),
];

/** The page the 基础 link opens. */
export const FIRST_TOPIC: TopicId = "buttons";

export const TOPIC_GROUPS: readonly { id: TopicGroupId; topics: readonly Topic[] }[] =
  TOPIC_GROUP_IDS.map((id) => ({ id, topics: TOPICS.filter((topic) => topic.group === id) }));

export function isTopicId(value: string): value is TopicId {
  return (TOPIC_IDS as readonly string[]).includes(value);
}

export function topicById(id: TopicId): Topic {
  return TOPICS.find((topic) => topic.id === id)!;
}
