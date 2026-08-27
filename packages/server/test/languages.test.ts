/**
 * The language floor: what a plugin contributes through the `LanguagesModule.grammars` slot,
 * what the two endpoints serve, and the two properties that keep a contributed grammar from
 * behaving unlike a bundled one — the listing carries no grammars, and an unknown id is a 404
 * rather than an empty document the Web App would hand to Shiki.
 */
import { describe, expect, it } from "vitest";
import { LanguageService } from "../src/languages/service.js";
import { languageRoutes } from "../src/http/routes/languages.js";
import type { LanguageIndexResponse } from "../src/api/types.js";

const GRAMMAR = { name: "typst", scopeName: "source.typst", patterns: [] };
const TYPST = {
  data: { language: "typst", displayName: "Typst", aliases: ["typ"], extensions: ["typ"] },
  grammar: GRAMMAR,
};

describe("LanguageService", () => {
  it("lists contributions by id, without their grammars", () => {
    const service = new LanguageService([
      { data: { ...TYPST.data, language: "zig", displayName: "Zig" }, grammar: GRAMMAR },
      TYPST,
    ]);
    const list = service.list();
    // Sorted by id, so the listing does not depend on plugin load order.
    expect(list.map((l) => l.id)).toEqual(["typst", "zig"]);
    // The grammar is the whole weight of a contribution; the listing must not carry it.
    expect(list.every((l) => !("grammar" in l))).toBe(true);
  });

  it("lets a later contribution replace an earlier one for the same language", () => {
    // Two plugins offering one language is an operator's configuration, not a reason to
    // refuse to boot.
    const service = new LanguageService([
      TYPST,
      { data: { ...TYPST.data, displayName: "Typst (fork)" }, grammar: GRAMMAR },
    ]);
    expect(service.list()).toHaveLength(1);
    expect(service.list()[0]!.displayName).toBe("Typst (fork)");
  });

  it("ignores a contribution with an empty language id", () => {
    expect(
      new LanguageService([{ data: { ...TYPST.data, language: "  " }, grammar: GRAMMAR }]).list(),
    ).toEqual([]);
  });

  it("has no grammar for a language nothing contributed", () => {
    expect(new LanguageService([]).grammar("typst")).toBeNull();
  });
});

describe("GET /api/languages", () => {
  const routesFor = (service: LanguageService) => languageRoutes(() => service);

  it("serves the listing and each grammar by id", async () => {
    const routes = routesFor(new LanguageService([TYPST]));

    const list = (await (await routes.request("/")).json()) as LanguageIndexResponse;
    expect(list.languages).toEqual([
      { id: "typst", displayName: "Typst", aliases: ["typ"], extensions: ["typ"] },
    ]);

    const grammar = await routes.request("/typst/grammar");
    expect(grammar.status).toBe(200);
    expect(await grammar.json()).toEqual(GRAMMAR);
  });

  it("answers 404 for a language nothing contributed rather than an empty grammar", async () => {
    // An empty document would reach Shiki's loadLanguage and fail there instead, one layer
    // away from the reason.
    const res = await routesFor(new LanguageService([])).request("/typst/grammar");
    expect(res.status).toBe(404);
  });

  it("reads the service through the getter, so a swap's contributions are the ones served", async () => {
    // The App is rebuilt on a hot push; a route holding the old service would keep serving a
    // language whose plugin the push removed.
    let service = new LanguageService([TYPST]);
    const routes = languageRoutes(() => service);
    expect(
      ((await (await routes.request("/")).json()) as LanguageIndexResponse).languages,
    ).toHaveLength(1);
    service = new LanguageService([]);
    expect(((await (await routes.request("/")).json()) as LanguageIndexResponse).languages).toEqual(
      [],
    );
  });
});
