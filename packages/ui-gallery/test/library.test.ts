/**
 * The component library: every topic is registered once, sits in one of the two groups, has a
 * board and a title in both dictionaries, and reaches its frame through the same preference
 * params as the app frames; the sections' top-bar links open where the owner asked.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOME_SURFACE } from "../src/app/surfaces";
import { SEEDED_KEYS } from "../src/app/frame";
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

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

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

  it("cover the owner's list: the component kinds, then the token boards", () => {
    const components = TOPIC_GROUPS.find((group) => group.id === "components")!.topics;
    expect(components.map((topic) => topic.id)).toEqual([
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
    ]);
    const foundations = TOPIC_GROUPS.find((group) => group.id === "foundations")!.topics;
    expect(foundations.map((topic) => topic.id)).toEqual([
      "colour",
      "type",
      "shape",
      "density",
      "focus",
      "motion",
      "icons",
      "hooks",
    ]);
  });

  it("each have a board in the frame's registry", () => {
    const registry = read("../src/library/boards.tsx");
    for (const id of TOPIC_IDS) expect(registry).toMatch(new RegExp(`^  ${id}: \\w+Board,$`, "m"));
  });

  it("each have a title and a description in both dictionaries", () => {
    for (const id of TOPIC_IDS) {
      for (const S of [zh, en]) {
        expect(S.library.topics[id].title.trim()).not.toBe("");
        expect(S.library.topics[id].description.trim()).not.toBe("");
      }
    }
    for (const group of TOPIC_GROUP_IDS) {
      expect(zh.library.groups[group].trim()).not.toBe("");
      expect(en.library.groups[group].trim()).not.toBe("");
    }
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

  it("is booted like the app frame: both documents get the seed and boot scripts", () => {
    const config = read("../vite.config.ts");
    expect(config).toMatch(/FRAME_DOCUMENTS = \["app\.html", "lib\.html"\]/);
    expect(config).toMatch(/library: at\("\.\/lib\.html"\)/);
  });
});

describe("the sections", () => {
  it("open where the owner asked: 界面 on the chat surface, 基础 on the first topic, 字体 on the defaults", () => {
    const topbar = read("../src/chrome/topbar.tsx");
    expect(topbar).toMatch(
      /page: "surfaces", label: S\.site\.surfaces, href: surfaceHref\(BASE, state, HOME_SURFACE\)/,
    );
    expect(topbar).toMatch(
      /page: "foundations", label: S\.site\.foundations, href: topicHref\(BASE, state, FIRST_TOPIC\)/,
    );
    expect(topbar).toMatch(
      /page: "fonts", label: S\.site\.fonts, href: fontsHref\(BASE, state, "defaults"\)/,
    );
    expect(HOME_SURFACE).toBe("chat");
    expect(FIRST_TOPIC).toBe("buttons");
  });

  it("each carry their own list: surfaces alone, topics alone, fonts pages alone", () => {
    const nav = read("../src/chrome/sidenav.tsx");
    expect(nav).toMatch(/export function SurfaceNav/);
    expect(nav).toMatch(/export function TopicNav/);
    expect(nav).toMatch(/export function FontsNav/);
    // The surface list no longer appends Foundations and Fonts.
    expect(nav).not.toMatch(/MODULES|routeHref\(/);
    expect(read("../src/pages/surface.tsx")).toMatch(/<SurfaceNav activeId=\{id\}/);
    expect(read("../src/pages/library.tsx")).toMatch(/<TopicNav activeId=\{id\}/);
    expect(read("../src/pages/fonts.tsx")).toMatch(/<FontsNav activeId=\{page\}/);
  });
});

describe("the charts board", () => {
  it("mounts every chart kind the app draws, the Trace timeline included", () => {
    const board = read("../src/library/boards/charts.tsx");
    for (const chart of [
      "TokenDonut",
      "TrendChart",
      "TokenBarChart",
      "TokenLegend",
      "RequestsChart",
      "ActivitySparkline",
      "ScoreSparkline",
      "TimelineChart",
    ]) {
      expect(board).toMatch(new RegExp(`<${chart}[\\s/>]`));
    }
    expect(board).toMatch(
      /from "\.\.\/\.\.\/\.\.\/\.\.\/web\/src\/features\/traces\/timeline-chart"/,
    );
  });
});

describe("the library frame's sizing", () => {
  it("never shows a scrollbar: the framed document cannot scroll, the frame is hidden until sized and never animates", () => {
    expect(read("../src/library/main.tsx")).toMatch(
      /document\.documentElement\.dataset\.framed = "1";/,
    );
    expect(read("../src/library/library.css")).toMatch(
      /html\[data-framed\],\s*html\[data-framed\] body \{\s*overflow: hidden;/,
    );
    const css = read("../src/chrome.css");
    expect(css).toMatch(/\.g-lib:not\(\[data-loaded\]\) \.g-lib-frame \{\s*visibility: hidden;/);
    expect(css).not.toMatch(/\.g-lib-frame \{[^}]*transition/s);
    expect(read("../src/chrome/library-frame.tsx")).toMatch(
      /data-loaded=\{height !== null \|\| undefined\}/,
    );
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
