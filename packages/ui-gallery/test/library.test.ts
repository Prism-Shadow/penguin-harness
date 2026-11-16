/**
 * The component library: every topic is registered once and sits in one of the two groups; its
 * frame opens through the same preference params as the app frames; the charts board tables the
 * tokens as the frame's style reads them; the content board's answered A2UI copies read their
 * sample answers back in full; the demo file tree flattens as the file tree reads it.
 */
import { describe, expect, it } from "vitest";
import { choiceFillText, formFillText, parseChoicePick, parseFormFill } from "@prismshadow/a2ui";
import { SEEDED_KEYS } from "../src/app/frame";
import {
  CHART_GEOMETRY_TOKENS,
  CHART_PALETTE_TOKENS,
  readChartTokens,
} from "../src/library/chart-tokens";
import { DEMO_TREE, flattenTree } from "../src/library/demo-tree";
import { LIBRARY_FRAME_PATH, libraryFrameSrc, parseLibraryParams } from "../src/library/frame";
import {
  FIRST_TOPIC,
  isTopicId,
  TOPIC_GROUP_IDS,
  TOPIC_GROUPS,
  TOPIC_IDS,
  TOPICS,
  topicById,
} from "../src/library/topics";
import { DEFAULT_STATE } from "../src/lib/url-state";
import { zh } from "../src/strings";
import { en } from "../src/strings-en";

describe("the library's topics", () => {
  it("are each registered once, in a group, and the groups list them all", () => {
    expect(new Set(TOPIC_IDS).size).toBe(TOPIC_IDS.length);
    expect(TOPICS.map((topic) => topic.id)).toEqual([...TOPIC_IDS]);
    for (const topic of TOPICS) expect(TOPIC_GROUP_IDS).toContain(topic.group);
    expect(TOPIC_GROUPS.flatMap((group) => group.topics.map((topic) => topic.id))).toEqual(
      [...TOPIC_IDS].sort(
        (a, b) =>
          TOPIC_GROUP_IDS.indexOf(topicById(a).group) - TOPIC_GROUP_IDS.indexOf(topicById(b).group),
      ),
    );
    expect(isTopicId(FIRST_TOPIC)).toBe(true);
    expect(isTopicId("foundations")).toBe(false);
  });
});

describe("the library frame", () => {
  const prefs = { ...DEFAULT_STATE, theme: "geek" as const, lang: "zh" as const };

  it("opens lib.html on a topic with the same preference params as an app frame", () => {
    const src = libraryFrameSrc("/base", prefs, "pickers");
    expect(src.startsWith(`/base${LIBRARY_FRAME_PATH}?topic=pickers&`)).toBe(true);
    const params = new URLSearchParams(src.slice(src.indexOf("?")));
    for (const key of Object.keys(SEEDED_KEYS))
      expect(params.get(key)).toBe(prefs[key as keyof typeof prefs]);
    expect(parseLibraryParams(src.slice(src.indexOf("?")))).toEqual({
      topic: "pickers",
      lang: "zh",
    });
  });

  it("falls back to the first topic and English for anything unknown", () => {
    expect(parseLibraryParams("?topic=nope&lang=fr")).toEqual({ topic: FIRST_TOPIC, lang: "en" });
    expect(parseLibraryParams("")).toEqual({ topic: FIRST_TOPIC, lang: "en" });
  });
});

describe("the charts board", () => {
  it("tables the current theme's chart tokens as the style reads them, trimmed, blank when unset", () => {
    const tokens = readChartTokens((name) => (name === "--ui-chart-2" ? " #f59e0b " : ""));
    expect(tokens.palette[1]).toEqual({ name: "--ui-chart-2", value: "#f59e0b" });
    expect(tokens.palette.map((row) => row.name)).toEqual([...CHART_PALETTE_TOKENS]);
    expect(tokens.geometry.map((row) => row.name)).toEqual([...CHART_GEOMETRY_TOKENS]);
    expect(tokens.geometry.every((row) => row.value === "")).toBe(true);
  });
});

describe("the content board", () => {
  it("answers a choice and a form in both dictionaries with exactly what each would fill", () => {
    // An answer the block cannot read back in full would show its answered copy half asked.
    for (const [lang, S] of [
      ["zh", zh],
      ["en", en],
    ] as const) {
      const answered = S.library.content.a2uiReply.flatMap(({ spec, answer }) =>
        answer === undefined ? [] : [{ spec, answer }],
      );
      expect(new Set(answered.map(({ spec }) => spec.type))).toEqual(new Set(["choice", "form"]));
      for (const { spec, answer } of answered) {
        if (spec.type === "form") {
          expect(formFillText(spec, parseFormFill(spec, answer) ?? {}, lang)).toBe(answer);
        } else if (spec.type === "choice") {
          expect(choiceFillText(spec, parseChoicePick(spec, answer) ?? [], lang)).toBe(answer);
        }
      }
    }
  });
});

describe("the demo file tree", () => {
  it("flattens open directories in order, with each row's place in its set", () => {
    const rows = flattenTree(DEMO_TREE, new Set(["src"]));
    expect(rows.map((row) => row.path)).toEqual([
      "corpus",
      "src",
      "src/rag.ts",
      "src/embed.ts",
      "src/empty",
      "test",
      "README.md",
      "package.json",
    ]);
    expect(rows[1]).toMatchObject({
      kind: "dir",
      depth: 0,
      posInSet: 2,
      setSize: 5,
      expanded: true,
    });
    expect(rows[2]).toMatchObject({ kind: "file", depth: 1, posInSet: 1, setSize: 3 });
    expect(rows[4]).toMatchObject({ kind: "dir", expanded: false, loaded: true, empty: true });
    expect(flattenTree(DEMO_TREE, new Set()).map((row) => row.path)).toEqual([
      "corpus",
      "src",
      "test",
      "README.md",
      "package.json",
    ]);
  });
});
