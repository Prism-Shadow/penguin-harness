/**
 * The rung the settings card names for the DSH adaptor: what its chain selected, read off the
 * program a wrap starts.
 */
import { describe, expect, it } from "vitest";
import { rungName } from "../src/index.js";

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
