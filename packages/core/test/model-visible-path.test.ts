import { describe, expect, it } from "vitest";
import { modelVisiblePath } from "../src/internal/model-visible-path.js";

describe("modelVisiblePath", () => {
  it.skipIf(process.platform === "win32")(
    "passes POSIX paths through, including backslash filename characters",
    () => {
      expect(modelVisiblePath("/tmp/a path/report.log")).toBe("/tmp/a path/report.log");
      expect(modelVisiblePath("/tmp/we\\ird.log")).toBe("/tmp/we\\ird.log");
    },
  );

  it.skipIf(process.platform !== "win32")(
    "spells ordinary Windows and UNC paths with forward slashes",
    () => {
      expect(modelVisiblePath("C:\\Users\\x\\a path\\report.log")).toBe(
        "C:/Users/x/a path/report.log",
      );
      expect(modelVisiblePath("\\\\server\\share\\report.log")).toBe("//server/share/report.log");
    },
  );
});
