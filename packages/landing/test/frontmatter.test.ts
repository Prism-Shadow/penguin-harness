import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/lib/frontmatter";

describe("parseFrontmatter", () => {
  it("splits meta and body, tolerating colons and quotes in values", () => {
    const { meta, body } = parseFrontmatter(
      `---\ntitle: "Hello: world"\ndate: 2026-07-17\ncategory: news\n---\n\n# Body\n`,
    );
    expect(meta).toEqual({ title: "Hello: world", date: "2026-07-17", category: "news" });
    expect(body).toBe("# Body");
  });

  it("returns the whole input as body when no frontmatter block exists", () => {
    const { meta, body } = parseFrontmatter("# Just markdown\n");
    expect(meta).toEqual({});
    expect(body).toBe("# Just markdown");
  });
});
