/**
 * The phonemes admin setting (admin only, 403 for everyone else, as the server settings are):
 * GET /api/admin/activity-phonemes reads where espeak-ng is and whether it answers, and PUT
 * names it with `{ espeakPath: string | null }` (null or empty runs `espeak-ng` from PATH).
 * The program runs on the server, which is why only an admin may name it.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";
import { readJson } from "../http/validate.js";
import type { ActivityPhonemes } from "./phonemes.js";
import type { PhonemesSettingsResponse } from "./book-word-types.js";

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "admin-api.activity-phonemes",
        prefix: "/api/admin/activity-phonemes",
        auth: "user",
        order: 47,
      },
    ],
  },
})
export class PhonemesAdminRoutes {
  @Use() private readonly phonemes!: ActivityPhonemes;
  @Bind("admin-api.activity-phonemes") routes!: Hono<AppEnv>;

  setup() {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      if (!c.var.user.isAdmin) {
        throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
      }
      await next();
    });
    const settings = async (): Promise<PhonemesSettingsResponse> => ({
      espeakPath: this.phonemes.espeakPath(),
      espeak: await this.phonemes.status(),
    });
    app.get("/", async (c) => c.json(await settings()));
    app.put("/", async (c) => {
      const body = await readJson(c);
      this.phonemes.setEspeakPath(body.espeakPath ?? null);
      return c.json(await settings());
    });
    this.routes = app;
  }
}
