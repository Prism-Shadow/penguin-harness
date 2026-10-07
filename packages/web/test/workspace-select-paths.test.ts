import { describe, expect, it } from "vitest";
import { dirName, isAbsoluteDir } from "../src/features/chat/workspace-select";

describe("folder picker paths", () => {
  it("starts from a filled absolute path on either kind of server", () => {
    expect(isAbsoluteDir("/home/me/waf")).toBe(true);
    expect(isAbsoluteDir("C:\\Users\\me\\waf")).toBe(true);
    expect(isAbsoluteDir("c:/Users/me")).toBe(true);
    expect(isAbsoluteDir("\\\\server\\share")).toBe(true);
    expect(isAbsoluteDir("waf")).toBe(false);
    expect(isAbsoluteDir("")).toBe(false);
  });

  it("names a folder by its last segment", () => {
    expect(dirName("/home/me/waf")).toBe("waf");
    expect(dirName("C:\\Users\\me\\waf\\")).toBe("waf");
    expect(dirName("/")).toBe("/");
    expect(dirName("C:\\")).toBe("C:");
  });
});
