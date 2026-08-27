/**
 * Extension-contributed languages in the composer's lookup tables (features/chat/code-languages).
 *
 * What is worth pinning here is the precedence: a contributed language must not be able to
 * shadow a bundled one, because the bundled grammar is the chunk that was built and tested
 * against this Shiki version, and replacing `typescript` with whatever an extension shipped
 * would be silent. Everything else is that the runtime table participates in the same three
 * lookups the bundled tables do — fence string, alias, file extension.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  isRuntimeLanguage,
  languageForExtension,
  registerRuntimeLanguages,
  resolveLanguage,
  runtimeLanguageGeneration,
  runtimeLanguages,
  subscribeToRuntimeLanguages,
} from "../src/features/chat/code-languages";

const TYPST = { id: "typst", displayName: "Typst", aliases: ["typ"], extensions: ["typ"] };

describe("registerRuntimeLanguages", () => {
  beforeEach(() => {
    registerRuntimeLanguages([]);
  });

  it("resolves a contributed language by id, alias and file extension", () => {
    registerRuntimeLanguages([TYPST]);
    expect(resolveLanguage("typst")).toBe("typst");
    expect(resolveLanguage("Typst")).toBe("typst");
    expect(resolveLanguage("typ")).toBe("typst");
    expect(languageForExtension("typ")).toBe("typst");
    expect(isRuntimeLanguage("typst")).toBe(true);
  });

  it("cannot shadow a bundled language, by id or by alias", () => {
    registerRuntimeLanguages([
      { id: "typescript", displayName: "Not TypeScript" },
      { id: "fake", displayName: "Fake", aliases: ["ts"], extensions: ["rs"] },
    ]);
    // The bundled grammar wins the id outright, and the entry is not registered at all.
    expect(isRuntimeLanguage("typescript")).toBe(false);
    // A bundled alias and a bundled extension both keep pointing where they did.
    expect(resolveLanguage("ts")).toBe("typescript");
    expect(languageForExtension("rs")).toBe("rust");
  });

  it("replaces the previous set rather than merging it", () => {
    // The listing is the whole truth about what this App offers: an extension a hot push
    // removed has to stop being offered.
    registerRuntimeLanguages([TYPST]);
    registerRuntimeLanguages([{ id: "zig", displayName: "Zig" }]);
    expect(runtimeLanguages().map((l) => l.id)).toEqual(["zig"]);
    expect(resolveLanguage("typst")).toBeUndefined();
  });

  it("leaves an unknown language unresolved, so the block renders unhighlighted", () => {
    expect(resolveLanguage("brainfuck")).toBeUndefined();
  });

  it("notifies subscribers so a block already on screen re-highlights", () => {
    // The grammars arrive after the first paint; without this a fence rendered before them
    // stays unhighlighted for the life of the page.
    let calls = 0;
    const before = runtimeLanguageGeneration();
    const unsubscribe = subscribeToRuntimeLanguages(() => {
      calls += 1;
    });
    registerRuntimeLanguages([TYPST]);
    expect(calls).toBe(1);
    expect(runtimeLanguageGeneration()).toBeGreaterThan(before);
    unsubscribe();
    registerRuntimeLanguages([]);
    expect(calls).toBe(1);
  });
});
