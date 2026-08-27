/**
 * What this package contributes, asserted against the grammars it actually ships, and against
 * the manifest that declares them — the two halves have to agree or the App is told about a
 * language whose grammar never arrives.
 *
 * The checks that matter are the two a wrong one would break silently: a grammar whose own
 * `name` is not the id the App asks for loads and then highlights nothing, and a fence info
 * string with no alias row resolves to no language at all — Shiki registers a grammar's aliases
 * only once it is LOADED, and the fence string is what decides whether to load it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { languageContributions } from "../src/index.js";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  penguin: {
    modules: Array<{
      contributes: Record<string, Array<{ id: string; language: string; displayName: string }>>;
    }>;
  };
};

describe("languageContributions", () => {
  const byLanguage = new Map(languageContributions().map((c) => [c.data.language, c]));

  it("contributes exactly the five languages this package is for", () => {
    expect([...byLanguage.keys()].sort()).toEqual(["csharp", "dart", "kotlin", "swift", "typst"]);
  });

  it("gives every grammar the same name as the id it is served under", () => {
    for (const [language, contribution] of byLanguage) {
      expect((contribution.grammar as { name: string }).name).toBe(language);
      expect((contribution.grammar as { scopeName?: string }).scopeName).toBeTruthy();
    }
  });

  it("carries the fence aliases the grammars declare", () => {
    // ```kt and ```cs are what a person actually types; without these rows they resolve to
    // nothing, because the alias is only known after the grammar loads.
    expect(byLanguage.get("kotlin")!.data.aliases).toContain("kt");
    expect(byLanguage.get("csharp")!.data.aliases).toContain("cs");
    expect(byLanguage.get("typst")!.data.aliases).toContain("typ");
  });

  it("carries file extensions for the Workspace file viewer", () => {
    expect(byLanguage.get("swift")!.data.extensions).toContain("swift");
    expect(byLanguage.get("kotlin")!.data.extensions).toContain("kt");
    expect(byLanguage.get("dart")!.data.extensions).toContain("dart");
    // Typst's grammar declares no fileTypes, so this one is stated by the package.
    expect(byLanguage.get("typst")!.data.extensions).toContain("typ");
  });

  it("binds a grammar for every language the manifest declares", () => {
    // The static half is what the server reads without executing this package; a language it
    // announces with nothing bound under its contribution id is a 404 at load time.
    const declared = manifest.penguin.modules[0]!.contributes["LanguagesModule.grammars"]!;
    const bound = new Map(languageContributions().map((c) => [c.id, c.grammar]));
    expect(declared.map((d) => d.language).sort()).toEqual([...byLanguage.keys()].sort());
    for (const entry of declared) {
      expect(bound.get(entry.id), entry.id).toBeTruthy();
    }
  });
});
