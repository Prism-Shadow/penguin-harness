/**
 * The A2UI blocks (src/components/content/a2ui): an ```a2ui fence parsed by the grammar and drawn
 * by its type's renderer — a choice, a form, steps, a callout — and a ```mermaid fence drawn as a
 * diagram; read-only unless a host hands them actions; the source and a notice for anything that
 * cannot be drawn; a placeholder while the reply streams; and Md routing both fences to them.
 *
 * Static markup only: a pick's fill and the diagram's drawing run in the browser. The pieces of
 * that logic which decide something — the form's gate, its answers and its draft, which options
 * fit one row, the textarea's Mod+Enter — are pure and called directly. A form's draft is read on
 * its first render, so a fake store shows what comes back.
 *
 * Choice
 * - Given a choice, its question, options, descriptions and the one recommended mark show.
 * - Given no host actions, every option is disabled and nothing fills.
 * - Given a live single-select, the group is one tab stop, resting on the recommended option, and
 *   "Other…" is its last entry, in the muted ink.
 * - Given a multi-select, the picks are real checkboxes behind a fill button that waits for one.
 * - Given a few short options, they are chips; longer ones are cards led by the radio's disc.
 *
 * Form
 * - Given a form of every kind, each field draws as its control inside the form.
 * - Given a default, its field starts answered; a slider and a switch always hold an answer, so a
 *   form of optional fields can be filled as first drawn.
 * - Given a bad date, a pattern mismatch, a too-long text or a slider out of range, the fill
 *   waits; given acceptable answers, only the answered fields are filled.
 * - Given an answer that breaks its rule, the line under the control becomes the error — the
 *   model's hint, else the rule in symbols — and a required field left empty shows none.
 * - Given a saved draft, each field takes back only what its kind holds and accepts; an untouched
 *   form writes no draft.
 * - Given Mod+Enter in a textarea the form submits; a bare Enter is a new line.
 * - Given no host actions, every control is disabled and there is no fill button.
 *
 * Answered (read-only, handed the message that answered the reply)
 * - Given the form's fill text, in either language, each field shows its answer over the
 *   model's defaults; a field with no line shows unanswered, and a slider or a switch with none
 *   stands at its starting answer.
 * - Given a message that is not the form's answer, the form shows as asked.
 * - Given the open question, the message is ignored: the form shows its own answers.
 * - Given a pick's text, a single choice shows that option pressed and a multiple choice its
 *   boxes ticked; an answer the reader wrote, or the open question, picks nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { fieldProblem } from "@prismshadow/penguin-core/a2ui";
import type { A2uiForm, A2uiFormAnswer, A2uiFormField } from "@prismshadow/penguin-core/a2ui";
import { A2uiActionsProvider } from "../src/components/content/a2ui/actions";
import type { A2uiActions, A2uiDrafts } from "../src/components/content/a2ui/actions";
import { A2uiBlock } from "../src/components/content/a2ui/a2ui-block";
import {
  draftAnswers,
  filledAnswers,
  formReady,
  initialAnswers,
} from "../src/components/content/a2ui/form-answers";
import { FormFieldControl, submitOnModEnter } from "../src/components/content/a2ui/form-fields";
import { MermaidBlock } from "../src/components/content/a2ui/mermaid-block";
import { shortOptions } from "../src/components/content/a2ui/parts";
import { a2uiRendererFor, registerA2uiRenderer } from "../src/components/content/a2ui/registry";
import { Md } from "../src/components/content/prose/prose";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import { renderStatic } from "../src/testing";
import { SRC_DIR } from "./helpers/paths";

const LIVE: A2uiActions = { interactive: true, fill: () => {}, lang: "en" };

const block = (spec: object, actions?: A2uiActions) => {
  const element = createElement(A2uiBlock, { source: JSON.stringify(spec) });
  return renderStatic(
    actions === undefined
      ? element
      : createElement(A2uiActionsProvider, { value: actions, children: element }),
  );
};

/**
 * The opening tags of the element `name` that carry every one of `attrs`, in any order and in any
 * case — React spells some attribute names as their props (`maxLength`), HTML reads them alike.
 */
const tags = (html: string, name: string, ...attrs: string[]) =>
  (html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? []).filter((tag) =>
    attrs.every((attr) => tag.toLowerCase().includes(attr.toLowerCase())),
  );

/** Every `<button>` opening tag. */
const buttons = (html: string) => tags(html, "button");

/**
 * The options that open on a decorative lead — a card's radio disc, or the pen of its "Other…" —
 * with what each lead holds: a chip opens straight on its label.
 */
const leads = (html: string) =>
  [...html.matchAll(/<button\b[^>]*><span aria-hidden="true"[^>]*><(span|svg)\b/g)].map((m) =>
    m[1] === "span" ? "disc" : "pen",
  );

const CHOICE = {
  type: "choice",
  question: "Which database should the service use?",
  options: [
    { label: "SQLite", value: "SQLite, one file beside the service" },
    {
      label: "PostgreSQL",
      description: "Relational, the team runs it already",
      recommended: true,
    },
    { label: "MongoDB" },
  ],
};

/** The free-text and figure kinds, as a model writes them. */
const DEPLOY: A2uiForm = {
  type: "form",
  title: "Deployment",
  fields: [
    {
      id: "name",
      label: "Service name",
      kind: "text",
      required: true,
      placeholder: "billing-api",
      pattern: "^[a-z][a-z0-9-]*$",
      hint: "Lowercase letters, digits and hyphens",
    },
    { id: "notes", label: "Notes", kind: "textarea", maxLength: 200 },
    {
      id: "replicas",
      label: "Replicas",
      kind: "number",
      min: 1,
      max: 10,
      unit: "pods",
      default: 3,
    },
    { id: "temperature", label: "Temperature", kind: "slider", min: 0, max: 1, step: 0.1 },
    {
      id: "region",
      label: "Region",
      kind: "single",
      required: true,
      options: [{ label: "eu-west" }, { label: "us-east" }, { label: "ap-south" }],
    },
    {
      id: "addons",
      label: "Add-ons",
      kind: "multiple",
      options: [{ label: "CDN" }, { label: "WAF" }, { label: "Backups" }],
    },
  ],
};

/** The pick and calendar kinds. */
const SCHEDULE: A2uiForm = {
  type: "form",
  title: "Schedule",
  fields: [
    {
      id: "size",
      label: "Machine size",
      kind: "select",
      options: [{ label: "Small" }, { label: "Medium" }, { label: "Large" }],
    },
    { id: "notify", label: "Notify me", kind: "switch", default: true },
    { id: "day", label: "Day", kind: "date", required: true },
    { id: "at", label: "Time", kind: "time", default: "09:30" },
    { id: "until", label: "Run until", kind: "datetime" },
  ],
};

const field = (spec: A2uiForm, id: string): A2uiFormField => {
  const found = spec.fields.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no field ${id}`);
  return found;
};

/** One field's control holding `answer`, with the problem the grammar finds in it. */
const control = (target: A2uiFormField, answer: A2uiFormAnswer) =>
  renderStatic(
    createElement(FormFieldControl, {
      field: target,
      answer,
      onChange: () => {},
      disabled: false,
      strings: DEFAULT_UI_STRINGS.a2ui,
      problem: fieldProblem(target, answer),
    }),
  );

/** A store that hands back `saved` and records the keys it is asked for. */
const store = (saved: unknown, keys: string[] = []): A2uiDrafts => ({
  load: (key) => {
    keys.push(key);
    return saved;
  },
  save: () => {},
  clear: () => {},
});

describe("ChoiceBlock", () => {
  it("shows the question, every option, its description and the recommended mark", () => {
    const html = block(CHOICE);
    expect(html).toContain('data-a2ui="choice"');
    expect(html).toContain("Which database should the service use?");
    for (const label of ["PostgreSQL", "SQLite", "MongoDB"]) expect(html).toContain(label);
    expect(html).toContain("Relational, the team runs it already");
    expect(html.match(/Recommended/g)).toHaveLength(1);
  });

  it("is read-only by default: every option disabled, nothing to fill", () => {
    const options = buttons(block({ ...CHOICE, allowOther: true }));
    expect(options).toHaveLength(4);
    for (const tag of options) expect(tag).toContain('disabled=""');
  });

  it("live, makes a single choice one tab stop on the recommended option, Other… last", () => {
    const html = block({ ...CHOICE, allowOther: true }, LIVE);
    const options = buttons(html);
    expect(options).toHaveLength(4);
    expect(options.filter((tag) => tag.includes('tabindex="0"'))).toHaveLength(1);
    // PostgreSQL, the second option, is the one the model recommends.
    expect(options[1]).toContain('tabindex="0"');
    for (const tag of options) expect(tag).not.toContain('disabled=""');
    // "Other…" closes the group, led by a pen where the options have the disc.
    expect(html.lastIndexOf("Other…")).toBeGreaterThan(html.lastIndexOf("MongoDB"));
    expect(leads(html)).toEqual(["disc", "disc", "disc", "pen"]);
  });

  it("collects a multi-select in checkboxes behind a fill button that waits for a pick", () => {
    const html = block({ ...CHOICE, multiple: true }, LIVE);
    expect(tags(html, "input", 'type="checkbox"')).toHaveLength(3);
    const [fill] = buttons(html);
    expect(html).toContain("Fill in");
    expect(fill).toContain('disabled=""');
    expect(block({ ...CHOICE, multiple: true })).not.toContain("Fill in");
  });

  it("fills nothing from either Other…, which empties the composer", () => {
    // A static render cannot press a button: the two controls' handlers are read from source.
    const source = readFileSync(join(SRC_DIR, "components/content/a2ui/choice-block.tsx"), "utf8");
    expect(source.match(/actions\.fill\(""\)/g)).toHaveLength(2);
    expect(source).not.toContain("actions.focus");
  });

  it("sets a few short options as a row of chips, and longer ones as cards led by a disc", () => {
    const short = {
      type: "choice",
      question: "Merge it now?",
      options: [
        { label: "Now", recommended: true },
        { label: "After review" },
        { label: "Not yet" },
      ],
    };
    const chips = block(short, LIVE);
    expect(buttons(chips)).toHaveLength(3);
    expect(leads(chips)).toEqual([]);
    expect(leads(block(CHOICE, LIVE))).toEqual(["disc", "disc", "disc"]);
  });
});

describe("shortOptions", () => {
  it("fits a row only with few options, no description, and labels counted in code points", () => {
    const labels = (...names: string[]) => names.map((label) => ({ label }));
    expect(shortOptions(labels("Yes", "No"), 4, 20)).toBe(true);
    expect(shortOptions(labels("a", "b", "c", "d", "e"), 4, 20)).toBe(false);
    expect(shortOptions([{ label: "Yes", description: "Ship it" }, { label: "No" }], 4, 20)).toBe(
      false,
    );
    // Twenty CJK characters are twenty code points: the limit counts characters, not width.
    const twenty = "现在合并并且发布到生产环境里去吧今天下午";
    expect(shortOptions(labels(twenty, "No"), 4, 20)).toBe(true);
    expect(shortOptions(labels(`${twenty}吗`, "No"), 4, 20)).toBe(false);
  });
});

describe("FormBlock", () => {
  it("draws every kind as its control inside the form", () => {
    const deploy = block(DEPLOY, LIVE);
    expect(deploy).toContain('data-a2ui="form"');
    expect(tags(deploy, "input", 'placeholder="billing-api"', 'maxlength="500"')).toHaveLength(1);
    expect(tags(deploy, "textarea", 'rows="3"', 'maxlength="200"')).toHaveLength(1);
    expect(deploy).toContain('data-control="number-input"');
    expect(deploy).toContain("pods");
    expect(deploy).toContain('data-control="slider"');
    expect(tags(deploy, "input", 'type="range"', 'min="0"', 'max="1"', 'step="0.1"')).toHaveLength(
      1,
    );
    // Three short options each: a segmented control for the single, toggle chips for the multiple.
    expect(deploy).not.toMatch(/<input type="(?:radio|checkbox)"/);
    expect(deploy.match(/data-control="choice-group"/g)).toHaveLength(1);
    expect(tags(deploy, "button", 'aria-pressed="false"')).toHaveLength(6);
    // The two required fields carry the mark, and the fill waits for them.
    expect(deploy.match(/aria-hidden="true">\*<\/span>/g)).toHaveLength(2);
    expect(tags(deploy, "button", 'type="submit"', 'disabled=""')).toHaveLength(1);

    const schedule = block(SCHEDULE, LIVE);
    expect(tags(schedule, "button", 'aria-haspopup="listbox"')).toHaveLength(1);
    expect(schedule).toContain(DEFAULT_UI_STRINGS.a2ui.choose);
    // The switch's title is a field label like the others, naming the switch it sits beside.
    const [toggle] = tags(schedule, "button", 'role="switch"');
    const switchId = /id="([^"]+)"/.exec(toggle ?? "")?.[1];
    expect(schedule).toMatch(new RegExp(`<label for="${switchId}"[^>]*>Notify me</label>`));
    expect(tags(schedule, "input", 'type="date"')).toHaveLength(1);
    expect(tags(schedule, "input", 'type="time"')).toHaveLength(1);
    expect(tags(schedule, "input", 'type="datetime-local"')).toHaveLength(1);
  });

  it("keeps radios and checkboxes for options that carry a description", () => {
    const described = {
      ...DEPLOY,
      fields: DEPLOY.fields.map((each) =>
        each.options === undefined
          ? each
          : { ...each, options: each.options.map((o) => ({ ...o, description: "Details" })) },
      ),
    };
    const html = block(described, LIVE);
    expect(tags(html, "input", 'type="radio"')).toHaveLength(3);
    expect(tags(html, "input", 'type="checkbox"')).toHaveLength(3);
  });

  it("starts a field at its default, and counts a slider and a switch as answered", () => {
    const deploy = block(DEPLOY, LIVE);
    expect(tags(deploy, "input", 'value="3"')).toHaveLength(1);
    const schedule = block(SCHEDULE, LIVE);
    expect(tags(schedule, "button", 'role="switch"', 'aria-checked="true"')).toHaveLength(1);
    expect(tags(schedule, "input", 'type="time"', 'value="09:30"')).toHaveLength(1);
    // Defaults alone do not answer a required day...
    expect(formReady(SCHEDULE, initialAnswers(SCHEDULE))).toBe(false);
    expect(formReady(SCHEDULE, { ...initialAnswers(SCHEDULE), day: "2026-10-20" })).toBe(true);
    // ...but a form of optional fields can be filled as first drawn: the slider and the switch
    // already hold answers, and they are what fills.
    const optional: A2uiForm = {
      type: "form",
      fields: [
        { id: "level", label: "Level", kind: "slider", min: 0, max: 5 },
        { id: "dark", label: "Dark mode", kind: "switch" },
        { id: "note", label: "Note", kind: "text" },
      ],
    };
    expect(formReady(optional, initialAnswers(optional))).toBe(true);
    expect(filledAnswers(optional, initialAnswers(optional))).toEqual({ level: "0", dark: false });
    const html = block(optional, LIVE);
    expect(tags(html, "button", 'type="submit"')).toHaveLength(1);
    expect(tags(html, "button", 'type="submit"', 'disabled=""')).toHaveLength(0);
  });

  it("holds the fill on a bad date, a pattern mismatch, a too-long text or a slider out of range", () => {
    const deploy = { ...initialAnswers(DEPLOY), name: "billing-api", region: "eu-west" };
    expect(formReady(DEPLOY, deploy)).toBe(true);
    expect(formReady(DEPLOY, { ...deploy, name: "Billing API" })).toBe(false);
    expect(formReady(DEPLOY, { ...deploy, notes: "x".repeat(201) })).toBe(false);
    expect(formReady(DEPLOY, { ...deploy, temperature: "1.5" })).toBe(false);
    expect(formReady(DEPLOY, { ...deploy, replicas: "two" })).toBe(false);
    const schedule = { ...initialAnswers(SCHEDULE), day: "2026-10-20" };
    expect(formReady(SCHEDULE, { ...schedule, day: "2026-02-30" })).toBe(false);
    expect(formReady(SCHEDULE, { ...schedule, size: "Huge" })).toBe(false);
    // What fills is what was answered, text trimmed; an empty multiple and a blank text are left out.
    expect(
      filledAnswers(DEPLOY, { ...deploy, name: "  billing-api  ", notes: " ", addons: [] }),
    ).toEqual({ name: "billing-api", replicas: "3", temperature: "0", region: "eu-west" });
  });

  it("turns the line under a control into the error: the model's hint, else the rule", () => {
    const name = field(DEPLOY, "name");
    const wrong = control(name, "Billing API");
    expect(wrong).toMatch(/role="alert"[^>]*>Lowercase letters, digits and hyphens</);
    expect(tags(wrong, "input", 'aria-invalid="true"')).toHaveLength(1);
    // While the answer fits, the hint is only a hint.
    const right = control(name, "billing-api");
    expect(right).toContain("Lowercase letters, digits and hyphens");
    expect(right).not.toContain('role="alert"');
    expect(right).not.toContain('aria-invalid="true"');
    // No hint from the model: the rule in symbols.
    expect(control(field(SCHEDULE, "day"), "2026-02-30")).toMatch(/role="alert"[^>]*>YYYY-MM-DD</);
    expect(control(field(DEPLOY, "replicas"), "12")).toMatch(/role="alert"[^>]*>1–10</);
    // A required field still empty: no error, the asterisk and the waiting fill say it.
    expect(control(field(SCHEDULE, "day"), "")).not.toContain('role="alert"');
  });

  it("brings back from a draft only what each field's kind holds and accepts", () => {
    const keys: string[] = [];
    const saved = {
      notify: false,
      day: true,
      size: "Huge",
      at: "10:15",
      until: "2026-10-20T18:00",
      retired: "x",
    };
    const html = block(SCHEDULE, { ...LIVE, drafts: store(saved, keys), draftScope: "s1" });
    expect(keys).toEqual([expect.stringMatching(/^s1:[0-9a-z]+$/)]);
    // A boolean comes back on the switch, never on the date; a label only among the options.
    expect(tags(html, "button", 'role="switch"', 'aria-checked="false"')).toHaveLength(1);
    expect(tags(html, "input", 'type="date"', 'value=""')).toHaveLength(1);
    expect(html).toContain(DEFAULT_UI_STRINGS.a2ui.choose);
    expect(tags(html, "input", 'type="time"', 'value="10:15"')).toHaveLength(1);
    expect(tags(html, "input", 'type="datetime-local"', 'value="2026-10-20T18:00"')).toHaveLength(
      1,
    );
    // A text on the switch is refused, and the switch keeps its default.
    const kept = block(SCHEDULE, { ...LIVE, drafts: store({ notify: "no" }), draftScope: "s1" });
    expect(tags(kept, "button", 'role="switch"', 'aria-checked="true"')).toHaveLength(1);
    // Twelve replicas is past the maximum of ten, and a retired add-on is not an option.
    const deploy = block(DEPLOY, {
      ...LIVE,
      drafts: store({ region: "us-east", replicas: "12", addons: ["WAF", "Gone"] }),
      draftScope: "s1",
    });
    expect(tags(deploy, "button", 'aria-pressed="true"')).toHaveLength(1);
    expect(tags(deploy, "input", 'value="3"')).toHaveLength(1);
    // A read-only reply reads no draft.
    block(SCHEDULE, { ...LIVE, interactive: false, drafts: store(saved, keys), draftScope: "s1" });
    expect(keys).toHaveLength(1);
    // An untouched form writes nothing; a field emptied again is untouched.
    expect(draftAnswers(SCHEDULE, initialAnswers(SCHEDULE))).toBeNull();
    expect(
      draftAnswers(SCHEDULE, { ...initialAnswers(SCHEDULE), notify: false, until: "" }),
    ).toEqual({ notify: false });
  });

  it("submits on Mod+Enter in a textarea, and leaves a bare Enter as a new line", () => {
    const press = (mods: { metaKey?: boolean; ctrlKey?: boolean }, isComposing = false) => {
      const seen = { submitted: 0, prevented: false };
      submitOnModEnter({
        key: "Enter",
        metaKey: false,
        ctrlKey: false,
        ...mods,
        nativeEvent: { isComposing },
        preventDefault: () => {
          seen.prevented = true;
        },
        currentTarget: { form: { requestSubmit: () => (seen.submitted += 1) } },
      } as unknown as KeyboardEvent<HTMLTextAreaElement>);
      return seen;
    };
    expect(press({ metaKey: true })).toEqual({ submitted: 1, prevented: true });
    expect(press({ ctrlKey: true })).toEqual({ submitted: 1, prevented: true });
    expect(press({})).toEqual({ submitted: 0, prevented: false });
    // Mid-composition the Enter belongs to the input method.
    expect(press({ ctrlKey: true }, true)).toEqual({ submitted: 0, prevented: false });
  });

  it("read-only, disables every control and offers no fill button", () => {
    for (const spec of [DEPLOY, SCHEDULE]) {
      const html = block(spec);
      expect(html).not.toContain('type="submit"');
      // A disabled fieldset disables what it holds; everything outside one says so itself.
      const loose = html.replace(/<fieldset[^>]*disabled=""[^>]*>[\s\S]*?<\/fieldset>/g, "");
      const controls = loose.match(/<(?:input|textarea|button)\b[^>]*>/g) ?? [];
      expect(controls.length).toBeGreaterThan(0);
      for (const tag of controls) expect(tag).toContain('disabled=""');
    }
  });
});

describe("answered blocks", () => {
  const answered = (answeredWith: string): A2uiActions => ({
    interactive: false,
    fill: () => {},
    lang: "en",
    answeredWith,
  });

  it("show a form's answers from its fill text, over the model's defaults", () => {
    const deploy = block(
      DEPLOY,
      answered(
        [
          "Service name: billing-api",
          "Notes:",
          "  Keep the old pods",
          "  for a day",
          "Replicas: 5 pods",
          "Region: us-east",
          "Add-ons: WAF, Backups",
        ].join("\n"),
      ),
    );
    expect(tags(deploy, "input", 'value="billing-api"')).toHaveLength(1);
    expect(deploy).toContain(">Keep the old pods\nfor a day</textarea>");
    expect(tags(deploy, "input", 'value="5"')).toHaveLength(1);
    expect(tags(deploy, "input", 'value="3"')).toHaveLength(0);
    // us-east among the segments, WAF and Backups among the chips.
    expect(tags(deploy, "button", 'aria-pressed="true"')).toHaveLength(3);
    // No line for the slider: it stands at its starting answer, its minimum.
    expect(tags(deploy, "input", 'type="range"', 'value="0"')).toHaveLength(1);
    expect(deploy).not.toContain('type="submit"');

    const schedule = block(
      SCHEDULE,
      answered("Machine size：Large\nNotify me：否\nDay：2026-10-21\nRun until：2026-10-21 18:00"),
    );
    expect(schedule).not.toContain(DEFAULT_UI_STRINGS.a2ui.choose);
    expect(tags(schedule, "button", 'role="switch"', 'aria-checked="false"')).toHaveLength(1);
    expect(tags(schedule, "input", 'type="date"', 'value="2026-10-21"')).toHaveLength(1);
    expect(
      tags(schedule, "input", 'type="datetime-local"', 'value="2026-10-21T18:00"'),
    ).toHaveLength(1);
    // The time has a default, but the message has no line for it: it was not answered.
    expect(tags(schedule, "input", 'type="time"', 'value=""')).toHaveLength(1);
    // A switch with no line cannot show no answer: it stands at its starting answer, on.
    const edited = block(SCHEDULE, answered("Day: 2026-10-21"));
    expect(tags(edited, "button", 'role="switch"', 'aria-checked="true"')).toHaveLength(1);
    expect(tags(edited, "input", 'type="time"', 'value=""')).toHaveLength(1);
  });

  it("show the form as asked for a message that is not its answer", () => {
    const html = block(SCHEDULE, answered("Sounds good, go ahead."));
    expect(tags(html, "button", 'role="switch"', 'aria-checked="true"')).toHaveLength(1);
    expect(tags(html, "input", 'type="time"', 'value="09:30"')).toHaveLength(1);
    expect(html).toContain(DEFAULT_UI_STRINGS.a2ui.choose);
  });

  it("leave the open question to its own answers", () => {
    const html = block(SCHEDULE, { ...LIVE, answeredWith: "Notify me: No\nTime: 10:15" });
    expect(tags(html, "button", 'role="switch"', 'aria-checked="true"')).toHaveLength(1);
    expect(tags(html, "input", 'type="time"', 'value="09:30"')).toHaveLength(1);
    expect(tags(html, "button", 'type="submit"')).toHaveLength(1);
  });

  it("pick a choice's options from its fill text, and nothing for an answer of the reader's own", () => {
    const single = buttons(block(CHOICE, answered("SQLite, one file beside the service")));
    expect(single.map((tag) => tag.includes('aria-pressed="true"'))).toEqual([true, false, false]);
    const several = block(
      { ...CHOICE, multiple: true },
      answered("SQLite, one file beside the service、MongoDB"),
    );
    expect(tags(several, "input", 'type="checkbox"', 'checked=""')).toHaveLength(2);
    for (const html of [
      block(CHOICE, answered("Redis, please")),
      block(CHOICE, { ...LIVE, answeredWith: "PostgreSQL" }),
      block({ ...CHOICE, multiple: true }, { ...LIVE, answeredWith: "PostgreSQL" }),
    ]) {
      expect(html).not.toContain('aria-pressed="true"');
      expect(tags(html, "input", 'checked=""')).toHaveLength(0);
    }
  });
});

describe("StepsBlock", () => {
  it("puts a step's warning and caution before its instruction and its note after", () => {
    const html = block({
      type: "steps",
      title: "Rotate the key",
      steps: [
        { text: "Open the settings." },
        {
          text: "Delete the old key.",
          warning: "Deleted keys cannot be restored.",
          caution: "Running jobs fail until they restart.",
          note: "The new key works at once.",
          code: "penguin keys rotate",
          lang: "bash",
        },
      ],
    });
    const at = (text: string) => html.indexOf(text);
    expect(at("Deleted keys")).toBeLessThan(at("Delete the old key."));
    expect(at("Running jobs")).toBeLessThan(at("Delete the old key."));
    expect(at("The new key works")).toBeGreaterThan(at("Delete the old key."));
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('data-tone="caution"');
    expect(html).toContain('data-tone="note"');
    expect(html).toContain("code-block");
    expect(html).toContain("penguin keys rotate");
    expect(html).toMatch(/<ol role="list"/);
    // A timeline: one rule from the first disc to the second, none after the last.
    expect(html.match(/after:w-px/g)).toHaveLength(1);
  });
});

describe("CalloutBlock", () => {
  const callout = (spec: Record<string, unknown>) =>
    renderStatic(
      createElement(UiStringsProvider, {
        strings: { ...DEFAULT_UI_STRINGS, a2ui: { ...DEFAULT_UI_STRINGS.a2ui, tip: "Hint" } },
        children: createElement(A2uiBlock, {
          source: JSON.stringify({ type: "callout", ...spec }),
        }),
      }),
    );

  it("is one row: the tone's mark says the tone, no title line names it", () => {
    const html = callout({ tone: "tip", text: "Run `pnpm test` first." });
    expect(html).toContain('data-tone="tip"');
    expect(html).toContain('data-tooltip="Hint"');
    expect(html).toContain('<span class="sr-only">Hint: </span>');
    expect(html).toContain("<code>pnpm test</code>");
    expect(html).not.toContain("ui-notice");
    expect(html).not.toContain('data-slot="title"');
  });

  it("leads the text with the model's title in the same line", () => {
    const html = callout({ tone: "tip", title: "Faster", text: "Cache the build." });
    expect(html).toMatch(/<span class="font-semibold">Faster <\/span>Cache the build\./);
  });
});

describe("A2uiBlock", () => {
  it("shows the source and a notice for a block the grammar rejects, never an empty box", () => {
    for (const source of ['{"type": "choice", "question": ', '{"type": "slider", "min": 0}']) {
      const html = renderStatic(createElement(A2uiBlock, { source }));
      expect(html).toContain('data-a2ui="invalid"');
      expect(html).toContain("be shown:");
      expect(html).toContain("code-block");
      expect(html).toContain(source.replace(/"/g, "&quot;"));
      expect(html).not.toContain("data-reveal");
    }
  });

  it("brings a block that draws in under the theme's reveal", () => {
    expect(block(CHOICE)).toMatch(/^<div data-reveal="true"><div class="a2ui-block/);
  });

  it("is a placeholder while the reply streams, and parses nothing", () => {
    const source = '{"type": "cho';
    const html = renderStatic(createElement(A2uiBlock, { source, streaming: true }));
    expect(html).toContain("Composing…");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("cho");
  });
});

describe("registerA2uiRenderer", () => {
  const Plain = ({ spec }: { spec: { text: string } }): ReactElement =>
    createElement("aside", null, spec.text);

  it("draws a type with the registered renderer until it is unregistered", () => {
    const callout = { type: "callout", tone: "note", text: "Plain words." };
    const builtIn = a2uiRendererFor("callout");
    const unregister = registerA2uiRenderer("callout", Plain);
    expect(block(callout)).toContain("<aside>Plain words.</aside>");
    unregister();
    expect(a2uiRendererFor("callout")).toBe(builtIn);
    expect(block(callout)).toContain('data-a2ui="callout"');
  });

  it("ignores a stale unregister once the type was registered again", () => {
    const first = registerA2uiRenderer("callout", Plain);
    const Other = () => createElement("aside", null, "other");
    const second = registerA2uiRenderer("callout", Other);
    first();
    expect(a2uiRendererFor("callout")).toBe(Other);
    second();
  });
});

describe("MermaidBlock", () => {
  const FLOW = "flowchart TD\n  A[Start] --> B{Ready?}\n  B -->|yes| C[Ship]";

  it("waits for the renderer before drawing a valid diagram, without showing its source", () => {
    const html = renderStatic(createElement(MermaidBlock, { source: FLOW }));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Diagram");
    expect(html).not.toContain("code-block");
  });

  it("shows the source and a notice for a diagram the grammar rejects", () => {
    const source = 'flowchart TD\n  A --> B\n  click A "https://example.com"';
    const html = renderStatic(createElement(MermaidBlock, { source }));
    expect(html).toContain('data-a2ui="invalid"');
    expect(html).toContain("be shown:");
    expect(html).toContain("click A");
  });
});

describe("Md fences", () => {
  const fence = (language: string, body: string) =>
    `Pick one:\n\n\`\`\`${language}\n${body}\n\`\`\`\n`;

  it("draws an a2ui fence as its block and a mermaid fence as a diagram, not as code", () => {
    const a2ui = renderStatic(createElement(Md, { text: fence("a2ui", JSON.stringify(CHOICE)) }));
    expect(a2ui).toContain('data-a2ui="choice"');
    expect(a2ui).not.toContain("code-block");
    const mermaid = renderStatic(
      createElement(Md, { text: fence("mermaid", "sequenceDiagram\n  A->>B: hi") }),
    );
    expect(mermaid).toContain("Diagram");
    expect(mermaid).not.toContain("code-block");
  });

  it("holds both behind the placeholder while the reply streams", () => {
    for (const language of ["a2ui", "mermaid"]) {
      const html = renderStatic(
        createElement(Md, { text: fence(language, '{"type": "choice"'), streaming: true }),
      );
      expect(html, language).toContain("Composing…");
      expect(html, language).not.toContain("code-block");
    }
  });
});
