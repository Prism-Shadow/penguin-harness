/**
 * linkSegments (src/lib/link-segments.ts): a description's web addresses become links, stopping
 * at brackets and trailing punctuation in either script, and the text around them is kept whole.
 */
import { describe, expect, it } from "vitest";
import { linkSegments } from "../src/lib/link-segments";

describe("linkSegments", () => {
  it("cuts the addresses out of English and Chinese prose, brackets and full stops left as text", () => {
    expect(
      linkSegments("OPRO (Yang et al., 2023, https://arxiv.org/abs/2309.03409), run."),
    ).toEqual([
      { kind: "text", text: "OPRO (Yang et al., 2023, " },
      { kind: "link", href: "https://arxiv.org/abs/2309.03409" },
      { kind: "text", text: "), run." },
    ]);
    expect(
      linkSegments("论文（2024，https://arxiv.org/abs/2409.07429）。见 http://a.b/c."),
    ).toEqual([
      { kind: "text", text: "论文（2024，" },
      { kind: "link", href: "https://arxiv.org/abs/2409.07429" },
      { kind: "text", text: "）。见 " },
      { kind: "link", href: "http://a.b/c" },
      { kind: "text", text: "." },
    ]);
    expect(linkSegments("no address here")).toEqual([{ kind: "text", text: "no address here" }]);
  });
});
