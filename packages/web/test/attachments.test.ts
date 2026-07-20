/**
 * splitImageAttachments unit tests: splitting "[attached image: …]" attachment
 * lines out of user text — scratchpad paths map to the session file endpoint,
 * http(s) URLs are quoted as-is, and unrecognized lines stay in the text.
 */
import { describe, expect, it } from "vitest";
import { splitImageAttachments } from "../src/lib/attachments";

describe("splitImageAttachments", () => {
  it("scratchpad path lines → session file endpoint, body kept", () => {
    const { text, images } = splitImageAttachments(
      "Look at this image\n\n[attached image: /home/u/.penguin/data/p1/agents/a1/scratchpad/session-20260712-abc/upload-1752300000000-0.png]",
    );
    expect(text).toBe("Look at this image");
    expect(images).toEqual([
      "/api/sessions/session-20260712-abc/scratchpad/upload-1752300000000-0.png",
    ]);
  });

  it("http(s) URLs quoted as-is; multiple attachments in order", () => {
    const { text, images } = splitImageAttachments(
      "[attached image: https://example.com/a.png]\n[attached image: /x/scratchpad/s1/b.png]",
    );
    expect(text).toBe("");
    expect(images).toEqual(["https://example.com/a.png", "/api/sessions/s1/scratchpad/b.png"]);
  });

  it("unrecognized lines stay in the text (notice lines / paths outside this system)", () => {
    const { text, images } = splitImageAttachments(
      "hi\n\n[an attached image could not be saved and was dropped]\n[attached image: /etc/passwd]",
    );
    expect(images).toEqual([]);
    expect(text).toContain("could not be saved");
    expect(text).toContain("[attached image: /etc/passwd]");
  });

  it("no attachment lines returns unchanged", () => {
    const { text, images } = splitImageAttachments("plain message");
    expect(text).toBe("plain message");
    expect(images).toEqual([]);
  });
});
