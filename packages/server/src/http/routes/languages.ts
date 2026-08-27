/**
 * GET /api/languages: the languages plugins have contributed (any logged-in user; like the
 * Skill library and the plugin index, this is deployment-global rather than Project data).
 * The listing carries no grammars — a grammar is tens to hundreds of kilobytes and only the
 * languages a conversation actually shows are worth fetching.
 *
 * GET /api/languages/:id/grammar: one language's TextMate grammar, in the shape Shiki's
 * `loadLanguage` takes. Immutable for the life of the process — the contributions are read once
 * per App — so it carries a long cache header and the App fetches each grammar at most once.
 */
import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../../auth/middleware.js";
import type { LanguageIndexResponse } from "../../api/types.js";
import type { Languages } from "../../languages/service.js";

export function languageRoutes(languages: () => Languages): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) => {
    const body: LanguageIndexResponse = { languages: languages().list() };
    return c.json(body);
  });

  app.get("/:id/grammar", (c) => {
    const grammar = languages().grammar(c.req.param("id"));
    if (grammar === null) {
      return c.json({ error: { code: "not_found", message: "no such language" } }, 404);
    }
    // A grammar cannot change without a new App, and a new App is a new page load: the App
    // re-reads the listing before it asks for any grammar, so a stale one is never used.
    c.header("cache-control", "private, max-age=3600");
    return c.json(grammar);
  });

  return app;
}

/** The languages listing and grammars: deployment-global, like the plugin index. */
@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "LanguageRoutes.routes",
        prefix: "/api/languages",
        auth: "user",
        order: 70,
      },
    ],
  },
})
export class LanguageRoutes {
  @Use() private readonly languages!: Languages;
  @Bind("LanguageRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = languageRoutes(() => this.languages);
  }
}
