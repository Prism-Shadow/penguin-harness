/**
 * splitAttachments unit tests: splitting "[attached image: …]" / "[attached file: …]"
 * attachment lines out of user text — image scratchpad paths map to the session file
 * endpoint, http(s) URLs are quoted as-is, file lines yield their paths, and unrecognized
 * lines stay in the text.
 */
import { describe, expect, it } from "vitest";
import { attachmentFileName, splitAttachments } from "../src/lib/attachments";

describe("splitAttachments", () => {
  it("scratchpad path lines → session file endpoint, body kept", () => {
    const { text, images } = splitAttachments(
      "Look at this image\n\n[attached image: /home/u/.penguin/data/p1/agents/a1/scratchpad/session-20260712-abc/upload-1752300000000-0.png]",
    );
    expect(text).toBe("Look at this image");
    expect(images).toEqual([
      "/api/sessions/session-20260712-abc/scratchpad/upload-1752300000000-0.png",
    ]);
  });

  it("http(s) URLs quoted as-is; multiple attachments in order", () => {
    const { text, images } = splitAttachments(
      "[attached image: https://example.com/a.png]\n[attached image: /x/scratchpad/s1/b.png]",
    );
    expect(text).toBe("");
    expect(images).toEqual(["https://example.com/a.png", "/api/sessions/s1/scratchpad/b.png"]);
  });

  it("unrecognized lines stay in the text (notice lines / paths outside this system)", () => {
    const { text, images } = splitAttachments(
      "hi\n\n[an attached image could not be saved and was dropped]\n[attached image: /etc/passwd]",
    );
    expect(images).toEqual([]);
    expect(text).toContain("could not be saved");
    expect(text).toContain("[attached image: /etc/passwd]");
  });

  it("no attachment lines returns unchanged", () => {
    const { text, images, files } = splitAttachments("plain message");
    expect(text).toBe("plain message");
    expect(images).toEqual([]);
    expect(files).toEqual([]);
  });

  it("file lines yield their paths, body kept", () => {
    const { text, images, files } = splitAttachments(
      "Review these\n\n[attached file: /home/u/.penguin/data/p1/agents/a1/scratchpad/s1/report.pdf]\n[attached file: /home/u/.penguin/data/p1/agents/a1/scratchpad/s1/rows.csv]",
    );
    expect(text).toBe("Review these");
    expect(images).toEqual([]);
    expect(files).toEqual([
      "/home/u/.penguin/data/p1/agents/a1/scratchpad/s1/report.pdf",
      "/home/u/.penguin/data/p1/agents/a1/scratchpad/s1/rows.csv",
    ]);
  });

  it("a file path outside the scratchpad stays plain text (a typed marker must not become a notice)", () => {
    // Gated exactly like an image line: only the server writes real file attachments, and only
    // ever into a scratchpad directory. Anything else in the body is something a person typed —
    // rendering it inside the system-notice chrome would be spoofing.
    const { text, files } = splitAttachments("check\n\n[attached file: /etc/hosts]");
    expect(files).toEqual([]);
    expect(text).toBe("check\n\n[attached file: /etc/hosts]");
    const typed = splitAttachments("[attached file: reset your password at evil.example.com]");
    expect(typed.files).toEqual([]);
    expect(typed.text).toBe("[attached file: reset your password at evil.example.com]");
  });

  it("images and files mixed in one message: each kind collected in order", () => {
    const { text, images, files } = splitAttachments(
      "both\n\n[attached image: /x/scratchpad/s1/a.png]\n[attached file: /x/scratchpad/s1/b.csv]\n[attached image: https://example.com/c.png]",
    );
    expect(text).toBe("both");
    expect(images).toEqual(["/api/sessions/s1/scratchpad/a.png", "https://example.com/c.png"]);
    expect(files).toEqual(["/x/scratchpad/s1/b.csv"]);
  });
});

describe("attachmentFileName", () => {
  it("takes the last segment of POSIX and Windows paths", () => {
    expect(attachmentFileName("/x/scratchpad/s1/report.pdf")).toBe("report.pdf");
    expect(attachmentFileName("C:\\data\\scratchpad\\s1\\rows.csv")).toBe("rows.csv");
    expect(attachmentFileName("report.pdf")).toBe("report.pdf");
  });
});
