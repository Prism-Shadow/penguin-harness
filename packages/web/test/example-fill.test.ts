/**
 * Clicking a draft-screen example FILLS the composer and sends nothing.
 *
 * Two halves. buildExampleFill decides what the composer becomes — the plain prompt (never a
 * `[use_skills]` block, which the send path builds and a user cannot sensibly edit), appended
 * behind a typed draft rather than over it, with the example's installed skills joining the
 * selection so that pressing Send produces exactly the message the card used to submit itself.
 * And the click path in draft-view.tsx, checked with the TypeScript parser the way
 * test/command-policy-add-rule.test.ts checks JSX structure: a regex cannot tell which handler
 * an onClick names, and "the card no longer submits" is precisely a claim about that handler.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { buildExampleFill } from "../src/features/chat/example-fill";
import { buildSkillsMessage } from "../src/features/chat/skill-use";
import { zh } from "../src/lib/strings";

const PROMPT = "Build a cute penguin sledding game.";

const fill = (over: Partial<Parameters<typeof buildExampleFill>[0]> = {}) =>
  buildExampleFill({
    prompt: PROMPT,
    currentText: "",
    exampleSkills: [],
    installedSkills: [],
    selectedSkills: [],
    ...over,
  });

describe("buildExampleFill — what lands in the text body", () => {
  it("puts the plain prompt in an empty composer", () => {
    const f = fill();
    expect(f.text).toBe(PROMPT);
    expect(f.insertAt).toBe(0);
  });

  it("never writes the [use_skills] block into the textarea", () => {
    // The composer wraps the selection at send time; wrapping here would both double it up and
    // leave a marker block in a box the user is meant to edit.
    const f = fill({ exampleSkills: ["web-design"], installedSkills: ["web-design"] });
    expect(f.text).toBe(PROMPT);
    expect(f.text).not.toContain("use_skills");
    expect(f.text).not.toBe(buildSkillsMessage(["web-design"], PROMPT));
  });

  it("keeps a typed draft, appending the prompt behind it after a blank line", () => {
    const f = fill({ currentText: "already typed" });
    expect(f.text).toBe(`already typed\n\n${PROMPT}`);
    // insertAt is where the prompt begins, so the caller can park the caret and the scroll there.
    expect(f.text.slice(f.insertAt)).toBe(PROMPT);
  });

  it("does not stack blank lines on a draft that already ends in newlines", () => {
    expect(fill({ currentText: "already typed\n\n\n" }).text).toBe(`already typed\n\n${PROMPT}`);
  });

  it("treats a whitespace-only draft as empty", () => {
    const f = fill({ currentText: "  \n\t " });
    expect(f.text).toBe(PROMPT);
    expect(f.insertAt).toBe(0);
  });

  it("carries the dictionary prompt through verbatim, newlines and all", () => {
    const prompt = zh.chat.exampleTasks.gamecenter.prompt;
    expect(fill({ prompt }).text).toBe(prompt);
  });
});

describe("buildExampleFill — what lands in the skills dropdown", () => {
  it("preselects the example's skills", () => {
    expect(fill({ exampleSkills: ["web-design"], installedSkills: ["web-design"] }).skills).toEqual(
      ["web-design"],
    );
  });

  it("drops skills the selected Agent has not installed", () => {
    // Pinning a Skill that isn't there is what the old auto-submit filtered out too.
    const f = fill({
      exampleSkills: ["penguin-sdk", "web-design"],
      installedSkills: ["web-design"],
    });
    expect(f.skills).toEqual(["web-design"]);
  });

  it("joins the existing selection instead of replacing it, without duplicating", () => {
    const f = fill({
      exampleSkills: ["penguin-sdk", "web-design"],
      installedSkills: ["penguin-sdk", "web-design", "memory"],
      selectedSkills: ["memory", "web-design"],
    });
    expect(f.skills).toEqual(["memory", "web-design", "penguin-sdk"]);
  });

  it("leaves the selection untouched for an example that pins nothing", () => {
    const selectedSkills = ["memory"];
    expect(fill({ selectedSkills, installedSkills: selectedSkills }).skills).toEqual(["memory"]);
  });
});

const SOURCE = fileURLToPath(new URL("../src/features/chat/draft-view.tsx", import.meta.url));
const source = ts.createSourceFile(
  SOURCE,
  readFileSync(SOURCE, "utf8"),
  ts.ScriptTarget.Latest,
  /* setParentNodes */ true,
  ts.ScriptKind.TSX,
);

/** Attribute text of the first JSX element carrying `marker` among its attributes. */
function attributes(marker: string): string | null {
  let found: string | null = null;
  const visit = (node: ts.Node): void => {
    if (found !== null) return;
    const tag = ts.isJsxSelfClosingElement(node)
      ? node
      : ts.isJsxElement(node)
        ? node.openingElement
        : null;
    if (tag) {
      const text = tag.attributes.getText(source);
      if (text.includes(marker)) {
        found = text;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Body of a top-level-ish `const <name> = …` declaration (the click handler). */
function declaration(name: string): string | null {
  let found: string | null = null;
  const visit = (node: ts.Node): void => {
    if (found === null && ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      found = node.getText(source);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("the example row's click path", () => {
  it("routes the click to the fill handler", () => {
    const attrs = attributes("copy.desc");
    expect(attrs, "the example row button").not.toBeNull();
    expect(attrs).toContain("fillExample(task)");
  });

  it("cannot send: the handler neither posts a task nor creates a Session", () => {
    const handler = declaration("fillExample");
    expect(handler, "the fillExample handler").not.toBeNull();
    expect(handler).toContain("composerRef.current?.fillExample");
    expect(handler).not.toContain("onSend");
    expect(handler).not.toContain("api.");
  });

  it("hands the composer handle to ChatInput, or the click would land nowhere", () => {
    expect(attributes('status="idle"')).toContain("controlRef={composerRef}");
  });

  it("keeps no submit-time machinery on the rows", () => {
    const text = source.getFullText();
    // The spinner and the shared in-flight guard were the auto-submit's; filling is instant.
    expect(text).not.toContain("exampleBusy");
    expect(text).not.toContain("keepDraft");
  });
});
