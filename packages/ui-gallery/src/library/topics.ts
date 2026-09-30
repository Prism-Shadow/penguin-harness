/**
 * The component library's pages, one per topic: the Web App's real components by kind, then the
 * boards of the token vocabulary. Value-import-free, so the screenshot script and the tests can
 * read it under Node; the titles live in the dictionaries, keyed by these ids.
 *
 * Each topic renders in its own framed document (`lib.html`, src/library/main.tsx) under the
 * page's theme, mode, size and fonts, in a frame sized to what the board paints, overlays
 * included (src/library/frame-height.ts).
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
  "streaming",
  "charts",
  "avatars",
  "files",
  "content",
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
}

const component = (id: TopicId): Topic => ({ id, group: "components" });
const foundation = (id: TopicId): Topic => ({ id, group: "foundations" });

export const TOPICS: readonly Topic[] = [
  component("buttons"),
  component("inputs"),
  component("pickers"),
  component("toasts"),
  component("notices"),
  component("dialogs"),
  component("tooltips"),
  component("tabs"),
  component("badges"),
  component("empty"),
  component("loading"),
  component("streaming"),
  component("charts"),
  component("avatars"),
  component("files"),
  component("content"),
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
