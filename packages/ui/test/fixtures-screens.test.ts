import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FIXTURE_LANGS, FIXTURES, en, fixturesFor, zh } from "../src/fixtures";
import { SCREEN_IDS, SCREENS, screenById } from "../src/screens";

/**
 * The dataset's shape with every string reduced to its type: two locales that differ only in
 * prose produce the same shape. Numbers and booleans stay, so a changed figure in one locale
 * shows up as a difference too.
 */
function shape(value: unknown): unknown {
  if (typeof value === "string") return "string";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return value.map(shape);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, shape(v)]),
    );
  }
  return value;
}

describe("fixtures", () => {
  it("hold the same structure in both locales", () => {
    // `lang` is the one field that must differ; the specimens are free prose of any length.
    expect(shape({ ...en, lang: "x" })).toEqual(shape({ ...zh, lang: "x" }));
  });

  it("share every identifier across locales", () => {
    const ids = (f: typeof en) => ({
      session: f.session.id,
      items: f.session.turns.flatMap((t) => t.items.map((i) => i.id)),
      tools: f.session.turns.flatMap((t) =>
        t.items.flatMap((i) => (i.kind === "tool_call" ? [`${i.toolCallId}:${i.name}`] : [])),
      ),
      sessions: f.sessionGroups.flatMap((g) => g.items.map((i) => i.id)),
      models: f.models.map((m) => `${m.provider}/${m.modelId}`),
      tickets: f.company.tickets.map((t) => t.ticketId),
      events: f.company.calendar.events.map((e) => `${e.agentId}/${e.name}`),
    });
    expect(ids(en)).toEqual(ids(zh));
  });

  it("carry prose in the language they claim", () => {
    const han = /[\u4e00-\u9fff]/;
    expect(han.test(zh.session.title)).toBe(true);
    expect(han.test(zh.copy.chat.running)).toBe(true);
    expect(han.test(en.session.title)).toBe(false);
    expect(han.test(en.copy.chat.running)).toBe(false);
    expect(fixturesFor("zh")).toBe(zh);
    expect(fixturesFor("fr")).toBe(en);
    expect(Object.keys(FIXTURES).sort()).toEqual([...FIXTURE_LANGS].sort());
  });

  it("exercise the tool calls, states and diffs the chat components need", () => {
    const items = en.session.turns.flatMap((t) => t.items);
    const tools = items.flatMap((i) => (i.kind === "tool_call" ? [i] : []));
    expect(new Set(tools.map((t) => t.name))).toEqual(
      new Set(["exec_command", "read_file", "edit_file", "write_file", "run_subagent"]),
    );
    expect(new Set(tools.map((t) => t.state))).toEqual(new Set(["done", "running", "waiting"]));
    expect(tools.some((t) => t.name === "exec_command" && t.output)).toBe(true);
    const edit = tools.find((t) => t.name === "edit_file")!;
    expect(edit.diff!.hunks[0]!.lines.filter((l) => l.kind === "add")).toHaveLength(
      edit.diff!.added,
    );
    expect(edit.diff!.hunks[0]!.lines.filter((l) => l.kind === "del")).toHaveLength(
      edit.diff!.removed,
    );
    const sub = tools.find((t) => t.name === "run_subagent")!.subagent!;
    expect(sub.transcript.some((i) => i.kind === "text" && i.streaming)).toBe(true);
    expect(items.some((i) => i.kind === "thinking")).toBe(true);
  });

  it("name models that exist in the built-in catalog", () => {
    const catalog = readFileSync(
      fileURLToPath(new URL("../../core/src/state/model-catalog.ts", import.meta.url)),
      "utf8",
    );
    const escape = (text: string) => text.replace(/[.*+?^$()|[\]\\/]/g, "\\$&");
    for (const m of en.models) {
      const row = new RegExp(
        [
          `modelId: "${escape(m.modelId)}",`,
          `displayName: "${escape(m.displayName)}",`,
          `provider: "${m.provider}",`,
          `contextWindow: ${m.contextWindow},`,
        ].join("\\s*"),
      );
      expect(row.test(catalog), `${m.provider}/${m.modelId}`).toBe(true);
    }
  });
});

describe("screens", () => {
  it("are listed once each, in the gallery's order", () => {
    expect(SCREENS.map((s) => s.id)).toEqual([...SCREEN_IDS]);
    expect(screenById("traces")?.title).toBe("Traces");
    expect(screenById("nope")).toBeUndefined();
  });

  for (const screen of SCREENS) {
    for (const lang of FIXTURE_LANGS) {
      it(`render ${screen.id} in ${lang} on the server`, () => {
        const html = renderToStaticMarkup(createElement(screen.Component, { lang }));
        const f = fixturesFor(lang);
        expect(html.length).toBeGreaterThan(1000);
        const expected = screen.id === "login" ? f.copy.auth.signIn : f.session.title;
        expect(html).toContain(expected);
      });
    }

    it(`${screen.id} reads colour only through tokens`, () => {
      const html = renderToStaticMarkup(createElement(screen.Component, { lang: "en" }));
      const classes = [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/));
      // A palette step (`gray-500`, `bg-red-50`) or a `dark:` pair would pin a theme's look
      // in the mock-up instead of letting the theme files decide it.
      const pinned = classes.filter((c) =>
        /(^|:)dark:|(^|[-:])(gray|slate|zinc|neutral|stone|red|amber|emerald|sky|blue|violet|rose|green|yellow|purple|brand)-\d/.test(
          c,
        ),
      );
      expect(pinned).toEqual([]);
    });
  }
});
