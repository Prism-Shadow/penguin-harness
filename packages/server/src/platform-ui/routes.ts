/**
 * The platform UI bridge's routes: the page's own two calls (register, hold a poll, answer),
 * the listing a person or an Agent reads, and the answer a page's poll carries.
 *
 *   POST   /api/platform-ui/pages                    { pageId, route, title, projectId? }
 *   GET    /api/platform-ui/pages                    this user's live pages
 *   DELETE /api/platform-ui/pages/:pageId            the page is closing
 *   POST   /api/platform-ui/pages/:pageId/poll       { waitMs?, route?, title? } -> { commands }
 *   POST   /api/platform-ui/pages/:pageId/answers    { commandId, ok, value?, error? }
 *
 * Everything is the signed-in user's own: a page belongs to whoever registered it, and the
 * listing and the dispatch (through the plugin commands) never cross users. The poll is a
 * held request, not SSE: one connection per page, and a page's answer travels back on the
 * same conversation that delivered the command.
 */
import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../auth/middleware.js";
import { badRequest, optionalString, readJson, requireString } from "../http/validate.js";
import { HttpError } from "../http/errors.js";
import { MAX_POLL_WAIT_MS, PlatformUi } from "./service.js";
import type { UiCommandAnswer } from "./service.js";

/** The optional wait a poll asks for: absent means the longest the bridge allows. */
function waitOf(body: Record<string, unknown>): number {
  const raw = body["waitMs"];
  if (raw === undefined || raw === null) return MAX_POLL_WAIT_MS;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    throw badRequest("waitMs must be a non-negative number.");
  }
  return Math.min(raw, MAX_POLL_WAIT_MS);
}

/** The answer body a page posts back: `ok` decides which of `value` / `error` is read. */
function answerOf(body: Record<string, unknown>): UiCommandAnswer {
  const ok = body["ok"];
  if (typeof ok !== "boolean") throw badRequest("ok must be a boolean.");
  const error = optionalString(body, "error", { maxLen: 2000, label: "error" });
  return {
    ok,
    ...(body["value"] === undefined ? {} : { value: body["value"] }),
    ...(error === undefined ? {} : { error }),
  };
}

export function platformUiRoutes(ui: PlatformUi): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/pages", async (c) => {
    const body = await readJson(c);
    const pageId = requireString(body, "pageId", { minLen: 1, maxLen: 128, label: "pageId" });
    const route = requireString(body, "route", { minLen: 0, maxLen: 2048, label: "route" });
    const title = optionalString(body, "title", { maxLen: 512, label: "title" }) ?? "";
    const projectId = optionalString(body, "projectId", { maxLen: 128, label: "projectId" });
    const page = ui.register(c.var.user.userId, {
      pageId,
      route,
      title,
      projectId: projectId ?? null,
    });
    return c.json({ page });
  });

  app.get("/pages", (c) => c.json({ pages: ui.pages(c.var.user.userId) }));

  app.delete("/pages/:pageId", (c) => {
    ui.unregister(c.var.user.userId, c.req.param("pageId"));
    return c.body(null, 204);
  });

  app.post("/pages/:pageId/poll", async (c) => {
    const pageId = c.req.param("pageId");
    const body = await readJson(c);
    const waitMs = waitOf(body);
    const route = optionalString(body, "route", { maxLen: 2048, label: "route" });
    const title = optionalString(body, "title", { maxLen: 512, label: "title" });
    if (route !== undefined || title !== undefined) {
      const touched = ui.touch(c.var.user.userId, pageId, {
        ...(route === undefined ? {} : { route }),
        ...(title === undefined ? {} : { title }),
      });
      if (touched === null)
        throw new HttpError(404, "unknown_page", `Page ${pageId} is not registered.`);
    }
    try {
      const commands = await ui.poll(c.var.user.userId, pageId, waitMs);
      return c.json({ commands });
    } catch (err) {
      if (err instanceof Error && err.message === "unknown_page") {
        throw new HttpError(404, "unknown_page", `Page ${pageId} is not registered.`);
      }
      throw err;
    }
  });

  app.post("/pages/:pageId/answers", async (c) => {
    const pageId = c.req.param("pageId");
    const body = await readJson(c);
    const commandId = requireString(body, "commandId", {
      minLen: 1,
      maxLen: 128,
      label: "commandId",
    });
    const answer = answerOf(body);
    const accepted = ui.answer(c.var.user.userId, pageId, commandId, answer);
    if (!accepted) {
      throw new HttpError(
        404,
        "unknown_command",
        `No command ${commandId} is waiting for page ${pageId}.`,
      );
    }
    return c.body(null, 204);
  });

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "PlatformUiRoutes.routes",
        prefix: "/api/platform-ui",
        auth: "user",
        order: 64,
      },
    ],
  },
})
export class PlatformUiRoutes {
  @Use() private readonly ui!: PlatformUi;
  @Bind("PlatformUiRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = platformUiRoutes(this.ui);
  }
}
