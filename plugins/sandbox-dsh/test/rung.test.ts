/**
 * The rung the settings card names for the DSH adaptor: what its chain selected, read off the
 * program a wrap starts, and what that rung leaves open.
 */
import { describe, expect, it } from "vitest";
import { rungLimits, rungName } from "../src/index.js";

describe("rungName", () => {
  it("names bubblewrap when the Linux chain kept it, and Landlock when it fell through", () => {
    expect(rungName("linux", "bwrap")).toBe("bubblewrap");
    expect(rungName("linux", "/opt/penguin/node_modules/.bin/landlock-run")).toBe("Landlock");
  });

  it("names the one rung macOS and Windows have", () => {
    expect(rungName("darwin", "sandbox-exec")).toBe("Seatbelt");
    expect(rungName("win32", "C:\\node.exe")).toBe("the Windows ACL runner");
  });
});

describe("rungLimits", () => {
  it("names the scratchpad on every rung, and Landlock's shared /tmp", () => {
    expect(rungLimits("bubblewrap", "full").map((l) => l.text)).toEqual([
      expect.stringContaining("Session scratchpad is not writable"),
    ]);
    const landlock = rungLimits("Landlock", "full");
    expect(landlock).toHaveLength(2);
    expect(landlock[1]!.text).toContain("the host's shared /tmp");
    expect(landlock[1]!.textZh).toContain("宿主共享的 /tmp");
  });

  it("explains a partial Landlock: ioctl below ABI 5, truncate below ABI 3", () => {
    const partial = rungLimits("Landlock", "partial");
    expect(partial).toHaveLength(3);
    expect(partial[2]!.text).toMatch(/older than 5 .*ioctl.*below ABI 3 .*truncating/);
  });
});
