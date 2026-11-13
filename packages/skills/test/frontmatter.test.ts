import { describe, expect, it } from "vitest";
import { formatFrontmatter, parseFrontmatter } from "../src/index.js";

describe("parseFrontmatter", () => {
  it("reads the block as YAML and returns the rest as content", () => {
    expect(
      parseFrontmatter('---\nname: x\ndescription: "Use it when: asked"\n---\n# Body\n'),
    ).toEqual({ data: { name: "x", description: "Use it when: asked" }, content: "# Body\n" });
  });

  it("reads no block as empty data and throws on invalid YAML", () => {
    expect(parseFrontmatter("# Body\n")).toEqual({ data: {}, content: "# Body\n" });
    expect(() => parseFrontmatter("---\nname: x\ndescription: a: b\n---\n")).toThrow();
  });
});

describe("formatFrontmatter", () => {
  it("writes the fields in order, one line each, leaving out undefined values", () => {
    expect(
      formatFrontmatter([
        ["name", "x"],
        ["description", "d"],
        ["short_description", undefined],
        ["version", "2026.08.29.3"],
      ]),
    ).toBe("---\nname: x\ndescription: d\nversion: 2026.08.29.3\n---");
    expect(formatFrontmatter({ name: "x", description: "d", extra: undefined })).toBe(
      "---\nname: x\ndescription: d\n---",
    );
  });

  it("quotes where YAML needs it, so the block reads back to the same values", () => {
    const fields = {
      name: "x",
      description: `Use it when: the user says "go" — ${"a long description ".repeat(12)}`,
      short_description: "- starts with a dash",
      version: "9",
    };
    const front = formatFrontmatter(fields);
    expect(front.split("\n")).toHaveLength(6);
    expect(parseFrontmatter(`${front}\n# Body\n`)).toEqual({ data: fields, content: "# Body\n" });
  });
});
