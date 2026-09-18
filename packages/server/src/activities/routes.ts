import { userText } from "@prismshadow/penguin-core";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Hono } from "hono";
import { Hono as HonoApp } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import type { Access } from "../mechanisms/projects.js";
import type { ActivityAuthoring } from "../mechanisms/activities.js";
import type { Sessions, SessionServiceIface } from "../runtime/session-manager.js";
import {
  badRequest,
  optionalString,
  pathParam,
  readJson,
  requireString,
  requireValidId,
} from "../http/validate.js";
import { HttpError } from "../http/errors.js";

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
  @Use() private readonly sessions!: Sessions;
  @Use() private readonly sessionService!: SessionServiceIface;
  @Bind("activities") routes!: Hono<AppEnv>;

  setup() {
    const app = new HonoApp<AppEnv>();
    app.get("/", async (c) => {
      const projectId = requireValidId(c, "projectId");
      this.access.requireProjectAccess(c.var.user.userId, projectId);
      const collectionId = c.req.query("collectionId");
      const manifest = await this.activities.ensureCollection(projectId, collectionId);
      return c.json({
        collectionId: manifest.collectionId,
        activities: await this.activities.listActivities(projectId, manifest.collectionId),
      });
    });
    app.post("/", async (c) => {
      const projectId = requireValidId(c, "projectId");
      this.access.requireProjectOwner(c.var.user.userId, projectId);
      const body = await readJson(c);
      const title = requireString(body, "title", { minLen: 1, maxLen: 200 });
      try {
        return c.json(
          await this.activities.createActivity(projectId, {
            collectionId: typeof body.collectionId === "string" ? body.collectionId : undefined,
            productCode: body.productCode,
            refNum: body.refNum,
            title,
            activityType: body.activityType === "book" ? "book" : "standard",
          }),
          201,
        );
      } catch (error) {
        throw new HttpError(
          400,
          "activity_create_failed",
          error instanceof Error ? error.message : String(error),
        );
      }
    });
    app.get("/:activityId", async (c) => {
      const projectId = requireValidId(c, "projectId");
      this.access.requireProjectAccess(c.var.user.userId, projectId);
      try {
        return c.json(await this.activities.getActivity(projectId, pathParam(c, "activityId")));
      } catch (error) {
        throw new HttpError(
          404,
          "activity_not_found",
          error instanceof Error ? error.message : String(error),
        );
      }
    });
    app.patch("/:activityId/description", async (c) => {
      const projectId = requireValidId(c, "projectId");
      this.access.requireProjectOwner(c.var.user.userId, projectId);
      const body = await readJson(c);
      const description = requireString(body, "description", { maxLen: 100_000 });
      try {
        return c.json(
          await this.activities.updateDescription(
            projectId,
            pathParam(c, "activityId"),
            description,
            optionalString(body, "expectedRevision", { maxLen: 128 }),
          ),
        );
      } catch (error) {
        throw new HttpError(
          409,
          "draft_conflict",
          error instanceof Error ? error.message : String(error),
        );
      }
    });
    app.post("/:activityId/generate-spec", async (c) => {
      const projectId = requireValidId(c, "projectId");
      this.access.requireProjectOwner(c.var.user.userId, projectId);
      const activityId = pathParam(c, "activityId");
      const activity = await this.activities.getActivity(projectId, activityId);
      const body = await readJson(c);
      const agentId = typeof body.agentId === "string" ? body.agentId : "default_agent";
      const session = await this.sessionService.createSession({
        projectId,
        agentId,
        workspace: this.activities.draftWorkspace(
          projectId,
          activity.collectionId,
          activity.id,
          activity.draft.draftId,
        ),
        approvalMode: "always-ask",
      });
      const prompt = [
        "Generate a WAF activity specification from the activity description below.",
        "Use the existing Loom activity-spec contract. Write only valid JSON to activity-spec.json in the workspace.",
        "Required fields: id, moduleFolder, title, runtime, activityDescription, and at least one scene.",
        "Do not edit any other file.",
        `Description:\n${activity.draft.description}`,
      ].join("\n\n");
      await this.sessions.startTask(session.sessionId, [userText(prompt)], { queueIfBusy: false });
      return c.json(
        {
          sessionId: session.sessionId,
          activityId,
          draftId: activity.draft.draftId,
          expectedRevision: activity.draft.contentRevision,
        },
        202,
      );
    });
    app.post("/:activityId/apply-generated-spec", async (c) => {
      const projectId = requireValidId(c, "projectId");
      this.access.requireProjectOwner(c.var.user.userId, projectId);
      const activityId = pathParam(c, "activityId");
      const body = await readJson(c);
      const spec = body.spec;
      if (spec === undefined) throw badRequest("spec is required.");
      try {
        return c.json(
          await this.activities.applySpec(
            projectId,
            activityId,
            spec,
            optionalString(body, "expectedRevision", { maxLen: 128 }),
          ),
        );
      } catch (error) {
        throw new HttpError(
          409,
          "spec_apply_failed",
          error instanceof Error ? error.message : String(error),
        );
      }
    });
    this.routes = app;
  }
}
