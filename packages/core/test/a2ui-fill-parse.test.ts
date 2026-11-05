/**
 * An answered block's answers, read back out of the message the reader sent (a2ui/fill-parse.ts):
 * the inverse of the fill texts, so a reply that is no longer the open question can show what
 * was answered after a reload.
 *
 * Form
 * - Given a form of every kind filled in either language, reading the message back gives the
 *   answers it was filled with: option values back to labels, the list split, the unit off a
 *   figure, a datetime's `T` back, a longer answer's lines with their own indent.
 * - Given a message in the other language than the one now on screen, it reads the same.
 * - Given a message the reader edited, a changed answer is read as changed, an answer the field
 *   would not accept is left out, lines that name no field are ignored and the order is free.
 * - Given a field with no line, it is left out.
 * - Given a multiple field whose option labels contain the list separator, each label reads as
 *   one option.
 * - Given a message that names no field, it is not this form's answer: null.
 *
 * Choice
 * - Given a pick, its value (or its label) reads back as the option, a value holding a separator
 *   included; a multiple choice's picks read back from either language's list.
 * - Given a written "Other…" answer, several picks on a single choice, or an empty message, it is
 *   not a pick of this choice: null.
 */
import { describe, expect, it } from "vitest";
import {
  choiceFillText,
  formFillText,
  parseChoicePick,
  parseFormFill,
  type A2uiChoice,
  type A2uiForm,
  type A2uiFormAnswers,
  type A2uiLang,
} from "../src/a2ui/index.js";

/** Every kind, with option values, a unit on each figure and a pattern on the text. */
const EVERY_KIND: A2uiForm = {
  type: "form",
  fields: [
    { id: "name", label: "Service name", kind: "text", pattern: "^[a-z][a-z0-9-]*$" },
    { id: "notes", label: "Notes", kind: "textarea" },
    { id: "pods", label: "Pods", kind: "number", min: 1, max: 10, unit: "pods" },
    { id: "cpu", label: "CPU target", kind: "slider", min: 50, max: 90, step: 5, unit: "%" },
    {
      id: "region",
      label: "Region",
      kind: "single",
      options: [{ label: "EU", value: "eu-west-1" }, { label: "US" }],
    },
    {
      id: "addons",
      label: "Add-ons",
      kind: "multiple",
      options: [{ label: "CDN" }, { label: "WAF", value: "web firewall" }, { label: "Backups" }],
    },
    {
      id: "size",
      label: "Size",
      kind: "select",
      options: [{ label: "Small" }, { label: "Large" }],
    },
    { id: "notify", label: "Notify me", kind: "switch" },
    { id: "day", label: "Day", kind: "date" },
    { id: "at", label: "Start at", kind: "time" },
    { id: "until", label: "Run until", kind: "datetime" },
  ],
};

const ANSWERS: A2uiFormAnswers = {
  name: "billing-api",
  notes: "Keep the old pods for a day\n\n  - then drop them",
  pods: "3",
  cpu: "70",
  region: "EU",
  addons: ["CDN", "WAF"],
  size: "Large",
  notify: false,
  day: "2026-10-20",
  at: "09:30",
  until: "2026-10-20T18:00",
};

const DATABASE: A2uiChoice = {
  type: "choice",
  question: "Which database should the service use?",
  options: [
    { label: "SQLite", value: "SQLite, one file beside the service" },
    { label: "PostgreSQL" },
    { label: "MongoDB" },
  ],
};

describe("parseFormFill", () => {
  it.each<[A2uiLang, A2uiFormAnswers]>([
    ["en", ANSWERS],
    ["zh", { ...ANSWERS, notify: true, addons: ["Backups"], region: "US" }],
  ])("reads back every kind a form filled in %s", (lang, answers) => {
    const message = formFillText(EVERY_KIND, answers, lang);
    expect(parseFormFill(EVERY_KIND, message)).toEqual(answers);
  });

  it("reads a message the same whichever language is on screen now", () => {
    // The parse takes no language: a zh message under an en interface reads like an en one.
    const zh = formFillText(EVERY_KIND, ANSWERS, "zh");
    expect(zh).toContain("Add-ons：CDN、web firewall");
    expect(zh).toContain("Notify me：否");
    expect(parseFormFill(EVERY_KIND, zh)).toEqual(
      parseFormFill(EVERY_KIND, formFillText(EVERY_KIND, ANSWERS, "en")),
    );
  });

  it("keeps an edited answer, leaves out one the field refuses, and ignores lines that name no field", () => {
    const message = [
      "Here you go:",
      "Pods: 4",
      "Region: Mars",
      "CPU target: 95%",
      "Service name: Billing API",
      "Notify me: yes",
      "Size: Huge",
      "Day: 2026-10-21",
      "Add-ons: CDN and WAF",
      "Thanks!",
      // A field's first line is its answer.
      "Pods: 9 pods",
    ].join("\n");
    expect(parseFormFill(EVERY_KIND, message)).toEqual({
      pods: "4",
      notify: true,
      day: "2026-10-21",
    });
  });

  it("leaves out a field that has no line, a switch included", () => {
    expect(parseFormFill(EVERY_KIND, "Size：Small\nStart at: 10:15")).toEqual({
      size: "Small",
      at: "10:15",
    });
  });

  it("ends a longer answer at the first line that is not indented", () => {
    const message = "Notes:\n  first\n\n  second\n\tthird\nP.S. not a note\n  nor this\nPods: 2";
    expect(parseFormFill(EVERY_KIND, message)).toEqual({
      notes: "first\n\nsecond\nthird",
      pods: "2",
    });
  });

  it("reads an option label that contains the list separator as one option", () => {
    const signals: A2uiForm = {
      type: "form",
      fields: [
        {
          id: "signals",
          label: "Signals",
          kind: "multiple",
          options: [{ label: "Logs, metrics" }, { label: "日志、指标" }, { label: "Traces" }],
        },
      ],
    };
    const answers = { signals: ["Logs, metrics", "日志、指标", "Traces"] };
    for (const lang of ["en", "zh"] as const) {
      expect(parseFormFill(signals, formFillText(signals, answers, lang))).toEqual(answers);
    }
  });

  it("is null for a message that names no field", () => {
    expect(parseFormFill(EVERY_KIND, "Sounds good, go ahead.")).toBeNull();
    // A label without its colon is prose, not a field's line.
    expect(parseFormFill(EVERY_KIND, "Pods are fine as they are")).toBeNull();
    expect(parseFormFill(EVERY_KIND, "")).toBeNull();
  });
});

describe("parseChoicePick", () => {
  it("reads a pick back by its value or its label, a value holding a separator included", () => {
    expect(parseChoicePick(DATABASE, choiceFillText(DATABASE, ["SQLite"], "en"))).toEqual([
      "SQLite",
    ]);
    expect(parseChoicePick(DATABASE, "SQLite")).toEqual(["SQLite"]);
    expect(parseChoicePick(DATABASE, " PostgreSQL\n")).toEqual(["PostgreSQL"]);
  });

  it("reads a multiple choice's picks from either language's list, in the options' order", () => {
    const several = { ...DATABASE, multiple: true };
    for (const lang of ["en", "zh"] as const) {
      const message = choiceFillText(several, ["MongoDB", "SQLite"], lang);
      expect(parseChoicePick(several, message)).toEqual(["SQLite", "MongoDB"]);
    }
  });

  it("is null for an answer of the reader's own, several picks on a single choice, or nothing", () => {
    expect(parseChoicePick(DATABASE, "Redis, please")).toBeNull();
    expect(parseChoicePick(DATABASE, "PostgreSQL, MongoDB")).toBeNull();
    expect(parseChoicePick({ ...DATABASE, multiple: true }, "PostgreSQL, Redis")).toBeNull();
    expect(parseChoicePick(DATABASE, "  ")).toBeNull();
  });
});
