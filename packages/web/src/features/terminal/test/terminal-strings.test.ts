/**
 * The terminal module's copy (strings.ts). That the app dictionaries mount these fragments is
 * checked on the app side (test/module-boundaries.test.ts); this project imports nothing
 * outside the module, so it runs without the app dictionaries.
 */
import { describe, expect, it } from "vitest";
import { terminalEn, terminalZh } from "../strings";

/**
 * Every leaf path of a fragment, with a function's arity standing in for its value — the type
 * annotation alone accepts an en function that takes fewer parameters than its zh twin.
 */
function shape(value: unknown, path = ""): string[] {
  if (typeof value === "function") return [`${path}()/${value.length}`];
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .flatMap((key) =>
        shape((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key),
      );
  }
  return [path];
}

describe("terminal strings", () => {
  it("zh and en have the same keys at every depth and the same function arity", () => {
    expect(shape(terminalEn)).toEqual(shape(terminalZh));
  });

  it("the kill confirmation and the exit code name their argument in both locales", () => {
    for (const dict of [terminalZh, terminalEn]) {
      expect(dict.killConfirmBody("build-watch")).toContain("build-watch");
      expect(dict.exitedWithCode("137")).toContain("137");
    }
  });
});
