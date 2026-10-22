/**
 * ChoiceGroup (src/components/forms/choice-group/): pressable options as chips or cards, single
 * or multiple, with a radio group's keyboard for a single choice.
 *
 * Static markup only, the package's convention: a press runs in the browser, so the rules a press
 * follows — where an arrow key moves the tab stop, which values a toggle leaves on — are pure
 * functions called directly, and the markup shows what each state draws.
 *
 * - Given a single group, every option is a button that says whether it is pressed, exactly one
 *   is pressed, and only one option is a tab stop: the one the caller names, else the pressed
 *   one, else the first — never a disabled one.
 * - Given the tab stop, an arrow key on either axis walks to the next option and wraps at the
 *   ends, Home and End jump to the ends, a disabled option is passed over, and any other key (or
 *   a group with nothing to focus) leaves the stop alone.
 * - Given cards, each leads with the radio's disc, filled only on the pressed option, unless the
 *   caller gives a lead of its own; a description sits under its label, and a muted option is in
 *   the muted ink.
 * - Given a multiple group of chips, every option is a toggle with a tab stop of its own, led by
 *   the checkbox's box, ticked only while pressed — so a multiple choice never reads as a single
 *   one, whose chips carry no box and whose cards carry a disc; given cards, every option is a
 *   real checkbox whose description describes it.
 * - When an option of a multiple group is pressed, it turns over and the group reports every
 *   option that is on, in the options' order, whatever order they were pressed in.
 * - Disabled, every option of every shape takes no press; one option's own flag closes only it.
 * - The group is a named `role="group"` that tests and screenshots find by `data-control`.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ChoiceGroup, toggledValues } from "../src/components/forms/choice-group/choice-group";
import type {
  ChoiceGroupOption,
  ChoiceGroupProps,
} from "../src/components/forms/choice-group/choice-group";
import { restingStop, rovingStop, rovingTarget } from "../src/components/forms/choice-group/roving";
import { classTokens, renderStatic } from "../src/testing";

const OPTIONS: readonly ChoiceGroupOption[] = [
  { value: "pg", label: "PostgreSQL", description: "Relational, the team runs it already" },
  { value: "sqlite", label: "SQLite" },
  { value: "mongo", label: "MongoDB" },
];

const render = (props: Partial<ChoiceGroupProps> & Pick<ChoiceGroupProps, "shape">) =>
  renderStatic(
    createElement(ChoiceGroup, {
      options: OPTIONS,
      value: null,
      onChange: () => {},
      "aria-label": "Database",
      ...props,
    } as ChoiceGroupProps),
  );

/** Every `<button>` opening tag. */
const buttons = (html: string): string[] => html.match(/<button\b[^>]*>/g) ?? [];
/** The opening tags that hold the one tab stop. */
const stops = (html: string) => buttons(html).filter((tag) => tag.includes('tabindex="0"'));
/** A drawn disc, and the dot of a selected disc in it. */
const DISC =
  /<span aria-hidden="true" class="relative inline-block size-3\.5 shrink-0 rounded-full/g;
const DOT = /bg-accent-fg/g;
/** A drawn checkbox box, and the tick of a ticked one. */
const BOX =
  /<span aria-hidden="true" class="relative inline-block size-3\.5 shrink-0 rounded-\[min/g;
const TICK = /d="M2\.6 6\.2l2\.2 2\.2 4\.6-4\.8"/g;

describe("a single choice group", () => {
  it("presses exactly the chosen option, and makes it the one tab stop", () => {
    const html = render({ shape: "chip", value: "sqlite" });
    const tags = buttons(html);
    expect(tags).toHaveLength(3);
    expect(tags.map((tag) => /aria-pressed="(true|false)"/.exec(tag)?.[1])).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(stops(html)).toHaveLength(1);
    expect(stops(html)[0]).toContain('aria-pressed="true"');
    expect(tags.filter((tag) => tag.includes('tabindex="-1"'))).toHaveLength(2);
  });

  it("rests the tab stop where the caller names, else on the first option", () => {
    const named = render({ shape: "card", initialStop: "mongo" });
    expect(buttons(named).indexOf(stops(named)[0]!)).toBe(2);
    const fresh = render({ shape: "card" });
    expect(buttons(fresh).indexOf(stops(fresh)[0]!)).toBe(0);
  });

  it("never rests the tab stop on an option that cannot take focus", () => {
    const html = render({
      shape: "chip",
      options: [{ ...OPTIONS[0]!, disabled: true }, ...OPTIONS.slice(1)],
      value: "pg",
    });
    const tags = buttons(html);
    expect(tags[0]).toContain('disabled=""');
    expect(stops(html)).toEqual([tags[1]]);
  });

  it("leads each card with the radio's disc, filled only on the pressed option", () => {
    const html = render({ shape: "card", value: "pg" });
    expect(html.match(DISC)).toHaveLength(3);
    expect(html.match(DOT)).toHaveLength(1);
    expect(classTokens(html)).toEqual(expect.arrayContaining(["rounded-md", "text-left"]));
    expect(html).toContain("Relational, the team runs it already");
  });

  it("leads a card with the caller's mark instead, and draws a muted option in the muted ink", () => {
    const html = render({
      shape: "card",
      options: [
        ...OPTIONS,
        { value: "other", label: "Other…", muted: true, lead: createElement("i", null, "pen") },
      ],
    });
    expect(html.match(DISC)).toHaveLength(3);
    const other = buttons(html)[3]!;
    expect(other.split(/[" ]/)).toContain("text-fg-muted");
    expect(html).toMatch(/<i>pen<\/i>/);
  });

  it("draws chips in the control's shape, on the rung the caller asks for", () => {
    expect(classTokens(render({ shape: "chip" }))).toEqual(
      expect.arrayContaining(["rounded-control", "text-sm", "whitespace-nowrap"]),
    );
    expect(classTokens(render({ shape: "chip", size: "sm" }))).toContain("text-xs");
    expect(render({ shape: "chip" })).not.toMatch(DISC);
    expect(render({ shape: "chip" })).not.toMatch(BOX);
    expect(render({ shape: "card" })).not.toMatch(BOX);
  });
});

describe("the tab stop's walk", () => {
  it("walks on either axis, wraps at the ends, jumps to the ends, and ignores other keys", () => {
    expect(rovingTarget(0, "ArrowDown", 3)).toBe(1);
    expect(rovingTarget(2, "ArrowRight", 3)).toBe(0);
    expect(rovingTarget(0, "ArrowUp", 3)).toBe(2);
    expect(rovingTarget(1, "ArrowLeft", 3)).toBe(0);
    expect(rovingTarget(1, "Home", 3)).toBe(0);
    expect(rovingTarget(0, "End", 3)).toBe(2);
    expect(rovingTarget(0, "Enter", 3)).toBeNull();
    expect(rovingTarget(0, "ArrowDown", 0)).toBeNull();
  });

  it("passes over options that cannot take focus, in the key's direction", () => {
    const enabled = [false, true, false, true];
    expect(rovingStop(1, "ArrowRight", enabled)).toBe(3);
    expect(rovingStop(3, "ArrowDown", enabled)).toBe(1);
    expect(rovingStop(1, "ArrowLeft", enabled)).toBe(3);
    expect(rovingStop(3, "Home", enabled)).toBe(1);
    expect(rovingStop(1, "End", enabled)).toBe(3);
    expect(rovingStop(1, "Tab", enabled)).toBeNull();
    expect(rovingStop(0, "ArrowRight", [false, false])).toBeNull();
  });

  it("rests on the first preferred option that can take focus", () => {
    expect(restingStop([true, true, true], [2, 1])).toBe(2);
    expect(restingStop([true, true, false], [2, 1])).toBe(1);
    expect(restingStop([false, true, true], [-1, -1])).toBe(1);
    expect(restingStop([false, false], [1])).toBe(0);
  });
});

describe("a multiple choice group", () => {
  it("as chips, makes every option a toggle with a tab stop of its own", () => {
    const html = render({ shape: "chip", multiple: true, value: ["pg", "mongo"] });
    const tags = buttons(html);
    expect(tags).toHaveLength(3);
    expect(tags.map((tag) => /aria-pressed="(true|false)"/.exec(tag)?.[1])).toEqual([
      "true",
      "false",
      "true",
    ]);
    for (const tag of tags) expect(tag).not.toContain("tabindex");
  });

  it("as chips, leads every option with the checkbox's box, ticked only while pressed", () => {
    const html = render({ shape: "chip", multiple: true, value: ["pg", "mongo"] });
    expect(html.match(BOX)).toHaveLength(3);
    expect(html.match(TICK)).toHaveLength(2);
    expect(html).not.toMatch(DISC);
    const none = render({ shape: "chip", multiple: true, value: [] });
    expect(none.match(BOX)).toHaveLength(3);
    expect(none).not.toMatch(TICK);
  });

  it("as cards, makes every option a real checkbox that its description describes", () => {
    const html = render({ shape: "card", multiple: true, value: ["sqlite"] });
    expect(buttons(html)).toHaveLength(0);
    const boxes = html.match(/<input type="checkbox"[^>]*>/g) ?? [];
    expect(boxes).toHaveLength(3);
    expect(boxes.map((box) => box.includes('checked=""'))).toEqual([false, true, false]);
    const described = /aria-describedby="([^"]+)"/.exec(boxes[0]!)?.[1] ?? "";
    const hint = html.slice(html.indexOf(`id="${described}"`));
    expect(described).not.toBe("");
    expect(hint).toMatch(/^id="[^"]+"[^>]*><span[^>]*>Relational, the team runs it already</);
  });

  it("reports every option that is on, in the options' order, after a press", () => {
    expect(toggledValues(OPTIONS, ["mongo"], "pg")).toEqual(["pg", "mongo"]);
    expect(toggledValues(OPTIONS, ["pg", "mongo"], "pg")).toEqual(["mongo"]);
    expect(toggledValues(OPTIONS, [], "sqlite")).toEqual(["sqlite"]);
    // A held value that no option offers any more is not reported back.
    expect(toggledValues(OPTIONS, ["gone", "pg"], "mongo")).toEqual(["pg", "mongo"]);
  });
});

describe("the closed state and the group", () => {
  it.each([
    ["single chips", { shape: "chip" }],
    ["single cards", { shape: "card" }],
    ["multiple chips", { shape: "chip", multiple: true, value: [] }],
  ] as const)("%s: disabled, every option takes no press", (_, props) => {
    const tags = buttons(render({ ...props, disabled: true }));
    expect(tags).toHaveLength(3);
    for (const tag of tags) expect(tag).toContain('disabled=""');
  });

  it("multiple cards: disabled, every checkbox takes no press and its card dims", () => {
    const html = render({ shape: "card", multiple: true, value: [], disabled: true });
    expect(html.match(/<input type="checkbox"[^>]*disabled=""/g)).toHaveLength(3);
    expect(classTokens(html)).toContain("opacity-60");
  });

  it("closes only the option whose own flag says so", () => {
    const html = render({
      shape: "chip",
      multiple: true,
      value: [],
      options: [OPTIONS[0]!, { ...OPTIONS[1]!, disabled: true }, OPTIONS[2]!],
    });
    expect(buttons(html).map((tag) => tag.includes('disabled=""'))).toEqual([false, true, false]);
  });

  it("is a group named by its caller, marked for tests and screenshots", () => {
    const labelled = render({ shape: "chip", "aria-label": undefined, "aria-labelledby": "q" });
    expect(labelled).toMatch(/^<div role="group" aria-labelledby="q" data-control="choice-group"/);
    expect(render({ shape: "card" })).toMatch(/^<div role="group" aria-label="Database"/);
  });
});
