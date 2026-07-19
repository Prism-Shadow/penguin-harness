/**
 * splitImageAttachments unit tests: splitting "[attached image: …]" attachment
 * lines out of user text — scratchpad paths map to the session file endpoint,
 * http(s) URLs are quoted as-is, and unrecognized lines stay in the text.
 */
import { describe, expect, it } from "vitest";
import { splitImageAttachments } from "../src/lib/attachments";

describe("splitImageAttachments", () => {
  it("scratchpad 路径行 → 会话文件端点，正文保留", () => {
    const { text, images } = splitImageAttachments(
      "看看这张图\n\n[attached image: /home/u/.penguin/data/p1/a1/scratchpad/session-20260712-abc/upload-1752300000000-0.png]",
    );
    expect(text).toBe("看看这张图");
    expect(images).toEqual([
      "/api/sessions/session-20260712-abc/scratchpad/upload-1752300000000-0.png",
    ]);
  });

  it("http(s) URL 直引；多附件按顺序", () => {
    const { text, images } = splitImageAttachments(
      "[attached image: https://example.com/a.png]\n[attached image: /x/scratchpad/s1/b.png]",
    );
    expect(text).toBe("");
    expect(images).toEqual(["https://example.com/a.png", "/api/sessions/s1/scratchpad/b.png"]);
  });

  it("识别不出的行保留在文本（说明行 / 非本系统路径）", () => {
    const { text, images } = splitImageAttachments(
      "hi\n\n[an attached image could not be saved and was dropped]\n[attached image: /etc/passwd]",
    );
    expect(images).toEqual([]);
    expect(text).toContain("could not be saved");
    expect(text).toContain("[attached image: /etc/passwd]");
  });

  it("无附件行原样返回", () => {
    const { text, images } = splitImageAttachments("普通消息");
    expect(text).toBe("普通消息");
    expect(images).toEqual([]);
  });
});
