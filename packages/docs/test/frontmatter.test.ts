import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/lib/frontmatter";

describe("parseFrontmatter", () => {
  it("parses a leading key/value block and trims the body", () => {
    const { meta, body } = parseFrontmatter(
      '---\ntitle: "OmniMessage"\ndescription: one protocol: three jobs\n---\n\nBody text\n',
    );
    expect(meta.title).toBe("OmniMessage");
    expect(meta.description).toBe("one protocol: three jobs");
    expect(body).toBe("Body text");
  });

  it("returns the whole input as body when there is no frontmatter", () => {
    const { meta, body } = parseFrontmatter("# Just markdown\n");
    expect(meta).toEqual({});
    expect(body).toBe("# Just markdown");
  });

  it("normalizes CRLF line endings", () => {
    const { meta, body } = parseFrontmatter("---\r\ntitle: X\r\n---\r\nbody\r\n");
    expect(meta.title).toBe("X");
    expect(body).toBe("body");
  });
});
