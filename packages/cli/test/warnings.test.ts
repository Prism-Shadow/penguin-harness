/**
 * The node:sqlite warning filter: exactly one warning is dropped, every other one still
 * reaches the terminal. Importing the module installs the filter as a side effect (the
 * entry does nothing else), so the install is exercised here too.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { installWarningFilter, isSqliteExperimentalWarning } from "../src/warnings.js";

describe("isSqliteExperimentalWarning", () => {
  it("matches the builtin's notice, whichever shape emitWarning was called in", () => {
    const text = "SQLite is an experimental feature and might change at any time";
    expect(isSqliteExperimentalWarning(text, "ExperimentalWarning")).toBe(true);
    expect(isSqliteExperimentalWarning(text, { type: "ExperimentalWarning" })).toBe(true);
    const asError = Object.assign(new Error(text), { name: "ExperimentalWarning" });
    expect(isSqliteExperimentalWarning(asError)).toBe(true);
  });

  it("leaves every other warning alone", () => {
    expect(isSqliteExperimentalWarning("Something else", "ExperimentalWarning")).toBe(false);
    expect(
      isSqliteExperimentalWarning("SQLite is an experimental feature", "DeprecationWarning"),
    ).toBe(false);
    expect(isSqliteExperimentalWarning("a plain warning")).toBe(false);
  });
});

describe("installWarningFilter", () => {
  let uninstall: (() => void) | null = null;
  afterEach(() => {
    uninstall?.();
    uninstall = null;
    vi.restoreAllMocks();
  });

  it("swallows the sqlite notice and forwards the rest verbatim", () => {
    const emitted: unknown[][] = [];
    vi.spyOn(process, "emitWarning").mockImplementation(((...args: unknown[]) => {
      emitted.push(args);
    }) as typeof process.emitWarning);
    uninstall = installWarningFilter();

    process.emitWarning(
      "SQLite is an experimental feature and might change at any time",
      "ExperimentalWarning",
    );
    process.emitWarning("Type stripping is an experimental feature", "ExperimentalWarning");
    process.emitWarning("something deprecated", "DeprecationWarning", "DEP0001");

    expect(emitted).toEqual([
      ["Type stripping is an experimental feature", "ExperimentalWarning"],
      ["something deprecated", "DeprecationWarning", "DEP0001"],
    ]);
  });

  it("restores the original emitter", () => {
    const original = process.emitWarning;
    installWarningFilter()();
    expect(process.emitWarning).toBe(original);
  });
});
