/** The rung the settings card names for the DSH adaptor, read off the program a wrap starts, and its limits. */
import { describe, expect, it } from "vitest";
import { rungLimits, rungName } from "../src/index.js";

describe("the DSH rung", () => {
  it.each([
    ["linux", "bwrap", "bubblewrap"],
    ["linux", "/opt/penguin/node_modules/.bin/landlock-run", "Landlock"],
    ["darwin", "sandbox-exec", "Seatbelt"],
    ["win32", "C:\\node.exe", "the Windows ACL runner"],
  ] as const)("on %s, %s is %s", (platform, program, name) => {
    expect(rungName(platform, program)).toBe(name);
  });

  it("names the scratchpad on every rung, Landlock's shared /tmp, and a partial Landlock's ABI gaps", () => {
    expect(rungLimits("bubblewrap", "full").map((l) => l.text)).toEqual([
      expect.stringContaining("Session scratchpad is not writable"),
    ]);
    const [, tmp, ...rest] = rungLimits("Landlock", "full");
    const partial = rungLimits("Landlock", "partial")[2];
    expect(rest).toEqual([]);
    expect(tmp!.text).toContain("the host's shared /tmp");
    expect(tmp!.textZh).toContain("宿主共享的 /tmp");
    expect(partial!.text).toMatch(/older than 5 .*ioctl.*below ABI 3 .*truncating/);
  });
});
