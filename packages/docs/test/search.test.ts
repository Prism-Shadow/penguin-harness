import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DocPage } from "../src/lib/docs";
import { parseFrontmatter } from "../src/lib/frontmatter";
import { DOC_SLUGS } from "../src/lib/nav";
import {
  buildSearchRecords,
  createSearchSnippet,
  findSearchMatchRanges,
  markdownToSearchText,
  normalizeSearchText,
  searchRecords,
} from "../src/lib/search";
import { getSearchShortcutLabel } from "../src/lib/shortcut";

const docs: DocPage[] = [
  {
    slug: "introduction",
    lang: "zh",
    title: "产品介绍",
    description: "",
    body: [
      "PenguinHarness 是一个开源的 AI Agent Harness。",
      "",
      "## 产品组成",
      "",
      "Web App 提供多 Session 对话和 Trace 观测。",
      "",
      "### 模型网关",
      "",
      "统一接入在线与本地模型。",
    ].join("\n"),
  },
  {
    slug: "server-api",
    lang: "en",
    title: "Server API",
    description: "",
    body: ["## Predict", "", "Call `client.predict` to stream an agent response."].join("\n"),
  },
  {
    slug: "configuration",
    lang: "en",
    title: "Configuration",
    description: "Environment variables and configuration files.",
    body: ["## Vault", "", "Store secrets outside the project."].join("\n"),
  },
];
const contentDir = join(__dirname, "..", "content");
const contentFiles = ["zh", "en"].flatMap((lang) => DOC_SLUGS.map((slug) => `${slug}.${lang}.md`));

describe("docs search", () => {
  it("normalizes width, case, and whitespace", () => {
    expect(normalizeSearchText("  ＰＥＮＧＵＩＮ   Harness ")).toBe("penguin harness");
  });

  it("maps normalized matches back to their original display text", () => {
    const text = "使用 Ｃｌｉｅｎｔ.Predict 调用本地模型";
    const ranges = findSearchMatchRanges(text, "client.predict 模型");
    expect(ranges.map(({ start, end }) => text.slice(start, end))).toEqual([
      "Ｃｌｉｅｎｔ.Predict",
      "模型",
    ]);
  });

  it("uses locale-independent case folding for English documentation", () => {
    expect(normalizeSearchText("INTERFACES INPUT")).toBe("interfaces input");
  });

  it("maps composed queries to decomposed source graphemes", () => {
    const text = "Cafe\u0301 configuration";
    const ranges = findSearchMatchRanges(text, "café");
    expect(ranges.map(({ start, end }) => text.slice(start, end))).toEqual(["Cafe\u0301"]);
  });

  it("merges overlapping highlight terms", () => {
    expect(findSearchMatchRanges("PenguinHarness", "penguin penguinharness")).toEqual([
      { start: 0, end: 14 },
    ]);
  });

  it("keeps link labels and inline code while removing Markdown syntax", () => {
    expect(markdownToSearchText("Use [`client.predict`](/api) with **streaming**.")).toBe(
      "Use client.predict with streaming.",
    );
  });

  it("preserves identifiers and angle-bracket placeholders inside code", () => {
    const markdown = [
      "Use `event_msg`, `PENGUIN_HOME`, and `agent_state/skills/<name>/`.",
      "",
      "```ts",
      "listTools(): Promise<ToolDefinition[]>;",
      'const type = "partial_tool_call_output";',
      "```",
    ].join("\n");

    expect(markdownToSearchText(markdown)).toBe(
      'Use event_msg, PENGUIN_HOME, and agent_state/skills/<name>/. listTools(): Promise<ToolDefinition[]>; const type = "partial_tool_call_output";',
    );
  });

  it("keeps a fence inside a callout out of the index, grammar name and quote markers included", () => {
    const markdown = [
      "> [!INFO]- The system blocked the first launch?",
      ">",
      "> Grant it once and the app starts normally:",
      ">",
      "> ```bash",
      "> chmod +x penguin-desktop-linux-x86_64.AppImage",
      "> ```",
    ].join("\n");

    expect(markdownToSearchText(markdown)).toBe(
      "The system blocked the first launch? Grant it once and the app starts normally: chmod +x penguin-desktop-linux-x86_64.AppImage",
    );
  });

  it("leaves an unquoted fence's blockquote lines verbatim", () => {
    const markdown = ["```markdown", "> a quoted line", "```"].join("\n");

    expect(markdownToSearchText(markdown)).toBe("> a quoted line");
  });

  it("removes paired formatting without changing literal identifier punctuation", () => {
    expect(
      markdownToSearchText(
        "**Bold** __strong__ _italic_ ~~old~~ context_engine foo__bar__baz partial_* model.* ~/.penguin <name> <https://example.com>",
      ),
    ).toBe(
      "Bold strong italic old context_engine foo__bar__baz partial_* model.* ~/.penguin <name> https://example.com",
    );
  });

  it("flattens Markdown tables without changing literal pipes in prose", () => {
    expect(
      markdownToSearchText(
        ["Keep A|B searchable.", "", "| Name | Value |", "| --- | --- |", "| alpha | beta |"].join(
          "\n",
        ),
      ),
    ).toBe("Keep A|B searchable. Name Value alpha beta");
  });

  it("finds documented identifiers by their exact spelling", () => {
    const codeDocs: DocPage[] = [
      {
        slug: "interfaces",
        lang: "en",
        title: "Interfaces",
        description: "",
        body: [
          "## Environment",
          "",
          "Returns `Promise<ToolDefinition[]>` and emits `partial_tool_call_output`.",
        ].join("\n"),
      },
    ];
    const records = buildSearchRecords(codeDocs);

    expect(searchRecords(records, "Promise<ToolDefinition[]>")).toHaveLength(1);
    expect(searchRecords(records, "partial_tool_call_output")).toHaveLength(1);
  });

  it("finds identifier headings from the real OmniMessage documentation", () => {
    for (const lang of ["en", "zh"] as const) {
      const { meta, body } = parseFrontmatter(
        readFileSync(join(contentDir, `omni-message.${lang}.md`), "utf8"),
      );
      const records = buildSearchRecords([
        {
          slug: "omni-message",
          lang,
          title: meta.title ?? "OmniMessage",
          description: meta.description ?? "",
          body,
        },
      ]);

      for (const heading of ["session_meta", "model_msg", "event_msg", "stop_reason"]) {
        expect(
          searchRecords(records, heading, 50).some((result) =>
            result.record.heading.startsWith(heading),
          ),
          `${heading} should resolve to its real ${lang} heading`,
        ).toBe(true);
      }
    }
  });

  it("preserves visible underscore identifiers across every documentation file", () => {
    for (const file of contentFiles) {
      const { body } = parseFrontmatter(readFileSync(join(contentDir, file), "utf8"));
      const visibleMarkdown = body
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
      const identifiers = new Set(
        visibleMarkdown.match(/[\p{L}\p{N}]+(?:_[\p{L}\p{N}*]+)+/gu) ?? [],
      );
      const searchText = markdownToSearchText(body);

      for (const identifier of identifiers) {
        expect(searchText, `${file} should preserve ${identifier}`).toContain(identifier);
      }
    }
  });

  it("maps normalized snippet offsets back to grapheme-safe source boundaries", () => {
    const text = `${"e\u0301".repeat(100)} TARGET value`;
    const snippet = createSearchSnippet(text, "target");
    const visibleSnippet = snippet.replace(/^…/, "");

    expect(snippet).toContain("TARGET");
    expect(visibleSnippet).not.toMatch(/^\u0301/u);
    expect(findSearchMatchRanges(snippet, "target")).not.toHaveLength(0);
  });

  it("builds page and heading records with deep-link anchors", () => {
    const records = buildSearchRecords(docs);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "introduction",
          anchor: "",
          pageTitle: "产品介绍",
        }),
        expect.objectContaining({
          slug: "introduction",
          anchor: "产品组成",
          heading: "产品组成",
        }),
        expect.objectContaining({
          slug: "introduction",
          anchor: "模型网关",
          heading: "模型网关",
        }),
      ]),
    );
  });

  it("finds Chinese section content and ranks the matching section first", () => {
    const results = searchRecords(buildSearchRecords(docs), "本地模型");
    expect(results[0]?.record).toMatchObject({
      slug: "introduction",
      anchor: "模型网关",
    });
  });

  it("finds punctuation-bearing API names inside inline code", () => {
    const results = searchRecords(buildSearchRecords(docs), "client.predict");
    expect(results[0]?.record).toMatchObject({
      slug: "server-api",
      anchor: "predict",
    });
  });

  it("returns only the page record for a page-title-only query", () => {
    const results = searchRecords(buildSearchRecords(docs), "产品介绍");
    expect(results).toHaveLength(1);
    expect(results[0]?.record.anchor).toBe("");
  });

  it("keeps a searchable page result when a document starts with a heading", () => {
    const results = searchRecords(buildSearchRecords(docs), "Configuration");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      record: {
        slug: "configuration",
        anchor: "",
      },
    });
  });

  it("returns no results for a blank or unmatched query", () => {
    const records = buildSearchRecords(docs);
    expect(searchRecords(records, "  ")).toEqual([]);
    expect(searchRecords(records, "does-not-exist")).toEqual([]);
  });
});

describe("docs search shortcut", () => {
  it("uses the Command key label on Apple platforms", () => {
    expect(getSearchShortcutLabel("MacIntel")).toBe("⌘ K");
    expect(getSearchShortcutLabel("iPad")).toBe("⌘ K");
  });

  it("uses the Control key label on non-Apple platforms", () => {
    expect(getSearchShortcutLabel("Win32")).toBe("Ctrl K");
    expect(getSearchShortcutLabel("Linux x86_64")).toBe("Ctrl K");
  });
});
