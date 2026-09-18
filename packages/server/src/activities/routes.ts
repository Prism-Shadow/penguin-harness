import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Hono } from "hono";
import { Hono as HonoApp } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import type { Access } from "../mechanisms/projects.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import {
  badRequest,
  optionalString,
  pathParam,
  readJson,
  requireString,
  requireValidId,
} from "../http/validate.js";

@Component({
  contributes: {
    "HttpModule.routes": [
      { id: "activities", prefix: "/api/projects/:projectId/activities", auth: "user", order: 170 },
    ],
  },
})
export class ActivityRoutes {
  @Use() private readonly access!: Access;
  @Use() private readonly activities!: ActivityAuthoring;
  @Use() private readonly generation!: ActivityGeneration;
  @Bind("activities") routes!: Hono<AppEnv>;

  setup() {
    const app = new HonoApp<AppEnv>();
    app.use("*", async (c, next) => {
      const projectId = requireValidId(c, "projectId");
      // Collections created by this slice are project-local. No implicit cross-project
      // attachment; collection sharing needs its own explicit grants in a later slice.
      if (c.req.method === "GET") this.access.requireProjectAccess(c.var.user.userId, projectId);
      else this.access.requireProjectOwner(c.var.user.userId, projectId);
      await next();
    });
    app.get("/", async (c) => {
      const activities = await this.activities.listActivities(
        requireValidId(c, "projectId"),
        c.req.query("collectionId"),
      );
      return c.json({ collectionId: activities[0]?.collectionId ?? null, activities });
    });
    app.post("/", async (c) => {
      const body = await readJson(c);
      if (
        body.activityType !== undefined &&
        !["standard", "book"].includes(body.activityType as string)
      )
        throw badRequest("activityType must be standard or book.");
      return c.json(
        await this.activities.createActivity(requireValidId(c, "projectId"), {
          collectionId: optionalString(body, "collectionId", { maxLen: 128 }),
          productCode: body.productCode,
          refNum: body.refNum,
          title: requireString(body, "title", { minLen: 1, maxLen: 200 }),
          activityType: body.activityType as "standard" | "book" | undefined,
        }),
        201,
      );
    });
    app.get("/:activityId", async (c) =>
      c.json(
        await this.activities.getActivity(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
        ),
      ),
    );
    app.patch("/:activityId/description", async (c) => {
      const body = await readJson(c);
      return c.json(
        await this.activities.updateDescription(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          requireString(body, "description", { maxLen: 100_000 }),
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
        ),
      );
    });
    app.post("/:activityId/generate-spec", async (c) => {
      const body = await readJson(c);
      return c.json(
        await this.generation.start(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          requireString(body, "agentId", { minLen: 1, maxLen: 128 }),
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
        ),
        202,
      );
    });
    app.get("/:activityId/runs", async (c) =>
      c.json({
        runs: await this.generation.list(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
        ),
      }),
    );
    app.post("/:activityId/runs/:runId/cancel", async (c) =>
      c.json(
        await this.generation.cancel(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          pathParam(c, "runId"),
        ),
      ),
    );
    app.post("/:activityId/apply-generated-spec", async (c) => {
      const body = await readJson(c);
      if (body.spec === undefined) throw badRequest("spec is required.");
      return c.json(
        await this.activities.applySpec(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          body.spec,
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
        ),
      );
    });
    this.routes = app;
  }
}
