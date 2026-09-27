import { ASSIST_MESSAGE_MAX, parseAssistFocus } from "./assist.js";
import { ACTIVITY_LANGUAGES, DEFAULT_LANGUAGE_CODE } from "./languages.js";
import { HttpError } from "../http/errors.js";
import { isValidId } from "@prismshadow/penguin-core";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Hono } from "hono";
import { Hono as HonoApp } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import type { Access } from "../mechanisms/projects.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import type { ActivitySandbox } from "./sandbox-service.js";
import type { Config } from "../hmr/capabilities.js";
import { hostOnly, requestAuthority, resolvePreviewTarget } from "../services/preview-token.js";
import { playBase } from "./play-routes.js";
import { requestOrigin } from "../http/routes/model-oauth.js";
import { findWafRoot } from "./waf-module.js";
import { IMAGE_MODEL } from "./generated-image.js";
import { audioMimeType } from "./sound.js";
import { UPLOAD_MAX_BYTES } from "./upload.js";
import { BUNDLE_FILE_NAME, BUNDLE_MAX_ITEMS } from "./media-bundle.js";
import type { BundleItem } from "./media-library-types.js";
import { ActivityPipelines, parseSelection } from "./pipeline-run.js";
import type { SoundProviderId } from "./sound-types.js";
import { ActivityVersions, VERSION_LABEL_MAX } from "./version-service.js";
import type { ActivityQuality } from "./quality-check.js";
import type { QualityStateResponse } from "./quality-types.js";
import type { ActivityAcceptance } from "./acceptance-service.js";
import type { AcceptanceStateResponse } from "./acceptance-types.js";
import { parseRefDecisions } from "./ref-template.js";
import type { ActivityPhonemes } from "./phonemes.js";
import type { BookWordsRefresh, BookWordsSetup, BookWordsState } from "./book-word-types.js";
import type { ActivityDeploys } from "./deploy-service.js";
import type {
  DeployContextResponse,
  DeployLogResponse,
  DeployRunResponse,
  DeployStateResponse,
} from "./deploy-types.js";
import { isModuleVersion, isStageSelection } from "./deploy-stages.js";
import {
  badRequest,
  optionalString,
  pathParam,
  readJson,
  requireString,
  requireValidId,
} from "../http/validate.js";

/**
 * Who runs an agent-driven stage: a Penguin agent's own model (`agentId`), or an external
 * coding agent (`codingAgentId`, one of the ACP runtimes in /api/coding-agents) as the model
 * of a Session that `agentId`, when given, owns. One of the two is required.
 */
function stageRunner(body: Record<string, unknown>): {
  agentId: string;
  runtime?: { codingAgentId: string };
} {
  const codingAgentId = optionalString(body, "codingAgentId", { maxLen: 64 }) || undefined;
  if (codingAgentId) {
    const owner = optionalString(body, "agentId", { maxLen: 128 }) ?? "";
    return { agentId: owner, runtime: { codingAgentId } };
  }
  return { agentId: requireString(body, "agentId", { minLen: 1, maxLen: 128 }) };
}

/** Which module document a path names; anything else is a bad request. */
function moduleDocumentKind(value: string | undefined): "configuration" | "assessment" {
  if (value === "configuration" || value === "assessment") return value;
  throw badRequest("kind must be configuration or assessment.");
}

/** A version id as the version store makes them. */
const VERSION_ID = /^ver_[a-f0-9]{32}$/;
/** The one write-method path that only reads: a zip of files any member may already fetch. */
const BUNDLE_PATH = /^\/api\/projects\/[^/]+\/activities\/media-library\/bundle$/;

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
  @Use() private readonly sandbox!: ActivitySandbox;
  @Use() private readonly pipelines!: ActivityPipelines;
  @Use() private readonly versions!: ActivityVersions;
  @Use() private readonly quality!: ActivityQuality;
  @Use() private readonly acceptance!: ActivityAcceptance;
  @Use() private readonly phonemes!: ActivityPhonemes;
  @Use() private readonly deploys!: ActivityDeploys;
  @Use() private readonly config!: Config;
  @Bind("activities") routes!: Hono<AppEnv>;

  /** The assessment in effect for a ref (an author's edit, else the module's own), or null. */
  private async currentAssessment(
    projectId: string,
    activityId: string,
  ): Promise<Record<string, unknown> | null> {
    const value = (await this.sandbox.moduleDocuments(projectId, activityId)).assessment?.value;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  setup() {
    const app = new HonoApp<AppEnv>();
    app.use("*", async (c, next) => {
      const projectId = requireValidId(c, "projectId");
      // Collections created by this slice are project-local. No implicit cross-project
      // attachment; collection sharing needs its own explicit grants in a later slice.
      // Downloading a bundle of the project's media is a read, even though the list of
      // files travels as a POST body: any project member may do it, as they may GET each file.
      if (c.req.method === "GET" || (c.req.method === "POST" && BUNDLE_PATH.test(c.req.path)))
        this.access.requireProjectAccess(c.var.user.userId, projectId);
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
    app.get("/import-sources", async (c) => {
      this.access.requireProjectOwner(c.var.user.userId, requireValidId(c, "projectId"));
      return c.json(await this.activities.availableImports());
    });
    app.post("/import", async (c) => {
      const body = await readJson(c);
      return c.json(
        await this.activities.importFromLoom(
          requireValidId(c, "projectId"),
          requireString(body, "moduleFolder"),
          requireString(body, "productCode"),
          optionalString(body, "collectionId"),
        ),
      );
    });
    // The project's media library: every activity's uploads, read across the project.
    app.get("/media-library", async (c) =>
      c.json(await this.activities.projectMedia(requireValidId(c, "projectId"))),
    );
    app.post("/media-library/bundle", async (c) => {
      const body = await readJson(c);
      if (
        !Array.isArray(body.items) ||
        body.items.length < 1 ||
        body.items.length > BUNDLE_MAX_ITEMS ||
        body.items.some(
          (item: unknown) =>
            !item ||
            typeof item !== "object" ||
            typeof (item as BundleItem).activityId !== "string" ||
            typeof (item as BundleItem).path !== "string" ||
            !(item as BundleItem).activityId ||
            (item as BundleItem).activityId.length > 128 ||
            !(item as BundleItem).path ||
            (item as BundleItem).path.length > 1024,
        )
      )
        throw badRequest(
          `items must be 1 to ${BUNDLE_MAX_ITEMS} files, each an activityId and a path.`,
        );
      const items = (body.items as BundleItem[]).map(({ activityId, path }) => ({
        activityId,
        path,
      }));
      const zip = await this.activities.mediaBundle(requireValidId(c, "projectId"), items);
      // Sent as is: copying a zip of up to 200 MiB would double the peak memory.
      return new Response(zip as Uint8Array<ArrayBuffer>, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Length": String(zip.byteLength),
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(BUNDLE_FILE_NAME)}`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    });
    // The language table: what an activity may be authored and translated in.
    app.get("/language-setup", (c) =>
      c.json({ defaultLanguage: DEFAULT_LANGUAGE_CODE, languages: ACTIVITY_LANGUAGES }),
    );
    app.get("/:activityId/implementation-features", async (c) =>
      c.json(
        await this.activities.implementationFeatures(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
        ),
      ),
    );
    app.put("/:activityId/implementation-features", async (c) => {
      const body = await readJson(c);
      if (
        !Array.isArray(body.selectedIds) ||
        body.selectedIds.length > 100 ||
        body.selectedIds.some((id) => typeof id !== "string" || id.length > 128)
      )
        throw badRequest("selectedIds must be a list of feature ids.");
      return c.json(
        await this.activities.setImplementationFeatures(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          body.selectedIds as string[],
        ),
      );
    });
    app.post("/:activityId/languages", async (c) => {
      const body = await readJson(c);
      return c.json(
        await this.activities.addLanguage(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          requireString(body, "language", { minLen: 5, maxLen: 5 }),
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
        ),
      );
    });
    app.get("/module-setup", async (c) => {
      this.access.requireProjectOwner(c.var.user.userId, requireValidId(c, "projectId"));
      return c.json({ wafRoot: await findWafRoot() });
    });
    app.post("/:activityId/assemble-module", async (c) => {
      const body = await readJson(c);
      const runner = stageRunner(body);
      return c.json(
        await this.generation.start(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          runner.agentId,
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
          {
            wafRoot: optionalString(body, "wafRoot", { maxLen: 4096 }) || undefined,
            bookMode: optionalString(body, "bookMode", { maxLen: 32 }) || undefined,
          },
          runner.runtime,
        ),
        202,
      );
    });
    // With an agent, also which speech providers its Vault has keys for.
    app.get("/speech-setup", async (c) => {
      const agentId = c.req.query("agentId");
      // An id, checked before it names a path, like every other agent id.
      if (agentId !== undefined && (!agentId || agentId.length > 128 || !isValidId(agentId)))
        throw badRequest("agentId must be an id of 1-128 letters, digits, _ or -.");
      return c.json(await this.generation.speechSetup(requireValidId(c, "projectId"), agentId));
    });
    app.get("/sound-setup", async (c) => {
      const agentId = c.req.query("agentId") ?? "";
      if (!agentId || agentId.length > 128 || !isValidId(agentId))
        throw badRequest("agentId must be an id of 1-128 letters, digits, _ or -.");
      return c.json(await this.generation.soundSetup(requireValidId(c, "projectId"), agentId));
    });
    // Whether espeak-ng can sound out a decodable book's words on this server.
    app.get("/book-words/setup", async (c) =>
      c.json({ espeak: await this.phonemes.status() } satisfies BookWordsSetup),
    );
    app.get("/:activityId/book-words", async (c) =>
      c.json(
        (await this.activities.bookWordsState(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
        )) satisfies BookWordsState,
      ),
    );
    // A decodable book's words brought in line with its story, with sounds from espeak-ng.
    app.post("/:activityId/book-words/refresh", async (c) => {
      const body = await readJson(c);
      const bookMode = optionalString(body, "bookMode", { maxLen: 16 });
      if (bookMode && bookMode !== "readAlong" && bookMode !== "decodable")
        throw badRequest("bookMode must be readAlong or decodable.");
      return c.json(
        (await this.activities.refreshBookWords(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          requireString(body, "language", { minLen: 5, maxLen: 5 }),
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
          bookMode ? (bookMode as "decodable" | "readAlong") : undefined,
        )) satisfies BookWordsRefresh,
      );
    });
    // The author's sounds for one word; the word is theirs from then on.
    app.put("/:activityId/book-words/:assetKey/phonemes", async (c) => {
      const body = await readJson(c);
      return c.json(
        await this.activities.setWordPhonemes(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          optionalString(body, "language", { maxLen: 5 }) || DEFAULT_LANGUAGE_CODE,
          pathParam(c, "assetKey"),
          body.phonemes,
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
        ),
      );
    });
    // Sounds proposed by a model for the words espeak-ng could not sound out.
    app.post("/:activityId/generate-phonemes", async (c) => {
      const body = await readJson(c);
      const runner = stageRunner(body);
      return c.json(
        await this.generation.start(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          runner.agentId,
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
          {
            phonemes: {
              language: requireString(body, "language", { minLen: 5, maxLen: 5 }),
              words: body.words,
            },
          },
          runner.runtime,
        ),
        202,
      );
    });
    app.post("/:activityId/runs/:runId/accept-phonemes", async (c) => {
      const body = await readJson(c);
      return c.json(
        await this.generation.acceptPhonemes(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          pathParam(c, "runId"),
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
        ),
      );
    });
    app.get("/image-setup", (c) =>
      c.json({ provider: "Gemini", model: IMAGE_MODEL, vaultKey: "GEMINI_API_KEY" }),
    );
    app.post("/:activityId/generate-image", async (c) => {
      const body = await readJson(c);
      return c.json(
        await this.generation.start(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          requireString(body, "agentId", { minLen: 1, maxLen: 128 }),
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
          {
            image: {
              language: requireString(body, "language", { minLen: 5, maxLen: 5 }),
              assetKey: requireString(body, "assetKey", { minLen: 1, maxLen: 128 }),
            },
          },
        ),
        202,
      );
    });
    app.post("/:activityId/generate-media-text", async (c) => {
      const body = await readJson(c);
      const runner = stageRunner(body);
      return c.json(
        await this.generation.start(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          runner.agentId,
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
          {
            mediaText: {
              language: requireString(body, "language", { minLen: 5, maxLen: 5 }),
              assetKey: requireString(body, "assetKey", { minLen: 1, maxLen: 128 }),
              ...(body.translate === true ? { translate: true } : {}),
            },
          },
          runner.runtime,
        ),
        202,
      );
    });
    // The questions the activity's screens imply, written by an agent and checked for
    // coverage; the candidate waits for the author to accept it.
    app.post("/:activityId/generate-assessment", async (c) => {
      const body = await readJson(c);
      const runner = stageRunner(body);
      const projectId = requireValidId(c, "projectId");
      const activityId = pathParam(c, "activityId");
      const expectedRevision = requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 });
      return c.json(
        await this.generation.start(
          projectId,
          activityId,
          runner.agentId,
          expectedRevision,
          { assessment: { current: await this.currentAssessment(projectId, activityId) } },
          runner.runtime,
        ),
        202,
      );
    });
    app.post("/:activityId/runs/:runId/accept-assessment", async (c) => {
      const body = await readJson(c);
      return c.json(
        await this.generation.acceptAssessment(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          pathParam(c, "runId"),
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
        ),
      );
    });
    app.get("/:activityId/runs/:runId/image", async (c) => {
      const bytes = await this.generation.imageCandidateContent(
        requireValidId(c, "projectId"),
        pathParam(c, "activityId"),
        pathParam(c, "runId"),
      );
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(bytes.byteLength),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      });
    });
    app.post("/:activityId/runs/:runId/accept-image", async (c) => {
      const body = await readJson(c);
      return c.json(
        await this.generation.acceptImage(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          pathParam(c, "runId"),
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
        ),
      );
    });
    app.post("/:activityId/runs/:runId/accept-media-text", async (c) => {
      const body = await readJson(c);
      return c.json(
        await this.generation.acceptMediaText(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          pathParam(c, "runId"),
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
        ),
      );
    });
    // Plays the activity. The page itself is served on the preview origin behind a signed,
    // short-lived link (see play-routes.ts), so the module's code never runs with the
    // author's session; this route is where an authorised author is handed that link.
    app.get("/:activityId/sandbox/play", async (c) => {
      const projectId = requireValidId(c, "projectId");
      const target = resolvePreviewTarget(
        c.req.url,
        c.req.header("host"),
        this.config.previewOrigin,
        this.config,
      );
      // No separate preview origin: the page is served on the App's host, sandboxed.
      const host = target?.host ?? hostOnly(requestAuthority(c.req.url, c.req.header("host")));
      // The origin this author reached the App on: the only one the page may report its
      // state to. Proxy headers count only where the deployment says a proxy sets them.
      const parentOrigin = requestOrigin(
        c.req.url,
        {
          ...(c.req.header("x-forwarded-proto") !== undefined
            ? { proto: c.req.header("x-forwarded-proto")! }
            : {}),
          ...(c.req.header("x-forwarded-host") !== undefined
            ? { host: c.req.header("x-forwarded-host")! }
            : {}),
        },
        this.config.trustProxy,
      );
      const { token } = await this.sandbox.play(
        projectId,
        pathParam(c, "activityId"),
        host,
        target === null,
        parentOrigin,
      );
      const query = new URLSearchParams();
      const language = c.req.query("language");
      const scene = c.req.query("scene");
      if (language) query.set("language", language);
      if (scene) query.set("scene", scene);
      const search = query.toString();
      return c.redirect(
        `${target?.origin ?? ""}${playBase(token)}play${search ? `?${search}` : ""}`,
        302,
      );
    });
    app.get("/:activityId/sandbox/status", async (c) => {
      return c.json(
        await this.sandbox.status(requireValidId(c, "projectId"), pathParam(c, "activityId")),
      );
    });
    // A wildcard, because a media path is nested: images/en-US/cat.png. The path is
    // validated by shape and then by where it lands, never trusted as a path.
    app.post("/:activityId/sandbox/build", async (c) => {
      const body = await readJson(c);
      return c.json(
        await this.sandbox.build(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          body.force === true,
        ),
      );
    });
    app.get("/:activityId/media-stats", async (c) =>
      c.json({
        media: await this.sandbox.mediaStats(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
        ),
      }),
    );
    app.get("/:activityId/module-documents", async (c) => {
      const projectId = requireValidId(c, "projectId");
      return c.json(
        await this.sandbox.moduleDocuments(
          projectId,
          pathParam(c, "activityId"),
          this.access.find(c.var.user.userId, projectId)?.role === "owner",
        ),
      );
    });
    // An author's edit of the configuration or the shared assessment, kept in the draft.
    app.put("/:activityId/module-documents/:kind", async (c) => {
      const kind = moduleDocumentKind(c.req.param("kind"));
      const body = await readJson(c);
      if (body.value === null || typeof body.value !== "object" || Array.isArray(body.value))
        throw badRequest("value must be a JSON object.");
      const projectId = requireValidId(c, "projectId");
      const activityId = pathParam(c, "activityId");
      const expectedRevision = requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 });
      // The assessment the author was editing: a problem it already had does not refuse the save.
      const baseline =
        kind === "assessment"
          ? (await this.sandbox.moduleDocuments(projectId, activityId)).assessment?.value
          : undefined;
      return c.json(
        await this.activities.setModuleDocument(
          projectId,
          activityId,
          kind,
          body.value,
          expectedRevision,
          baseline,
        ),
      );
    });
    app.post("/:activityId/module-documents/:kind/discard", async (c) => {
      const kind = moduleDocumentKind(c.req.param("kind"));
      const body = await readJson(c);
      return c.json(
        await this.activities.discardModuleDocument(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          kind,
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
        ),
      );
    });
    app.get("/:activityId/sandbox/payload", async (c) => {
      return c.json(
        await this.sandbox.payload(requireValidId(c, "projectId"), pathParam(c, "activityId"), {
          languageCode: c.req.query("language") ?? null,
          startSceneId: c.req.query("scene") ?? null,
        }),
      );
    });
    app.get("/:activityId/sandbox/module/*", async (c) => {
      const prefix = `/${pathParam(c, "activityId")}/sandbox/module/`;
      const url = new URL(c.req.url);
      const at = url.pathname.indexOf(prefix);
      const raw = at < 0 ? "" : url.pathname.slice(at + prefix.length);
      const served = await this.sandbox.moduleFile(
        requireValidId(c, "projectId"),
        pathParam(c, "activityId"),
        raw,
      );
      return new Response(served.body ?? null, { status: served.status, headers: served.headers });
    });
    app.get("/:activityId/sandbox/media/*", async (c) => {
      const prefix = `/${pathParam(c, "activityId")}/sandbox/media/`;
      const url = new URL(c.req.url);
      const at = url.pathname.indexOf(prefix);
      const raw = at < 0 ? "" : url.pathname.slice(at + prefix.length);
      const result = await this.sandbox.media(
        requireValidId(c, "projectId"),
        pathParam(c, "activityId"),
        raw,
        {
          range: c.req.header("range") ?? null,
          ifRange: c.req.header("if-range") ?? null,
          ifNoneMatch: c.req.header("if-none-match") ?? null,
        },
      );
      return new Response(result.body ?? null, {
        status: result.status,
        headers: result.headers,
      });
    });
    app.get("/:activityId/media-image", async (c) => {
      const projectId = requireValidId(c, "projectId");
      // Choosing a server-side checkout is an owner capability, like module assembly.
      this.access.requireProjectOwner(c.var.user.userId, projectId);
      const query = c.req.query();
      const result = await this.activities.imageContent(projectId, pathParam(c, "activityId"), {
        language: requireString(query, "language", { minLen: 5, maxLen: 5 }),
        assetKey: requireString(query, "assetKey", { minLen: 1, maxLen: 128 }),
        expectedRevision: requireString(query, "expectedRevision", { minLen: 1, maxLen: 128 }),
        wafRoot: optionalString(query, "wafRoot", { maxLen: 4096 }) || undefined,
      });
      return new Response(new Uint8Array(result.bytes), {
        headers: {
          "Content-Type": result.mimeType,
          "Content-Length": String(result.bytes.byteLength),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      });
    });
    // Uploads and their listing stay inside this activity's own workspace under
    // PENGUIN_HOME. The shared WAF checkout is never written to.
    app.post("/:activityId/media-uploads", async (c) => {
      const body = await readJson(c);
      const name = requireString(body, "name", { minLen: 1, maxLen: 255 });
      const dataBase64 = requireString(body, "dataBase64", {
        minLen: 1,
        // Base64 is four characters per three bytes; cap the text before decoding it.
        maxLen: Math.ceil(UPLOAD_MAX_BYTES / 3) * 4 + 8,
      });
      let bytes: Buffer;
      try {
        bytes = Buffer.from(dataBase64, "base64");
      } catch {
        throw badRequest("dataBase64 is not valid base64.");
      }
      return c.json(
        await this.activities.uploadMedia(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          name,
          bytes,
        ),
        201,
      );
    });
    // A file uploaded to another activity of this project, copied into this one's uploads.
    app.post("/:activityId/media-uploads/copy", async (c) => {
      const body = await readJson(c);
      return c.json(
        await this.activities.copyUpload(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          requireString(body, "fromActivityId", { minLen: 1, maxLen: 128 }),
          requireString(body, "path", { minLen: 1, maxLen: 1024 }),
        ),
        201,
      );
    });
    app.get("/:activityId/media-uploads", async (c) =>
      c.json({
        media: await this.activities.listMedia(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
        ),
      }),
    );
    app.get("/:activityId/media-upload", async (c) => {
      const result = await this.activities.uploadContent(
        requireValidId(c, "projectId"),
        pathParam(c, "activityId"),
        requireString(c.req.query(), "path", { minLen: 1, maxLen: 1024 }),
      );
      return new Response(new Uint8Array(result.bytes), {
        headers: {
          "Content-Type": result.mimeType,
          "Content-Length": String(result.bytes.byteLength),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      });
    });
    app.post("/:activityId/generate-audio", async (c) => {
      const body = await readJson(c);
      // Absent: the narration's own provider, else Gemini; that provider's default model.
      const provider = optionalString(body, "provider", { minLen: 1, maxLen: 32 });
      const model = optionalString(body, "model", { minLen: 1, maxLen: 64 });
      return c.json(
        await this.generation.start(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          requireString(body, "agentId", { minLen: 1, maxLen: 128 }),
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
          {
            audio: {
              language: requireString(body, "language", { minLen: 5, maxLen: 5 }),
              assetKey: requireString(body, "assetKey", { minLen: 1, maxLen: 128 }),
              voice: requireString(body, "voice", { minLen: 1, maxLen: 128 }),
              ...(provider ? { provider } : {}),
              ...(model ? { model } : {}),
            },
          },
        ),
        202,
      );
    });
    app.post("/:activityId/generate-sound", async (c) => {
      const body = await readJson(c);
      const provider = requireString(body, "provider", { minLen: 1, maxLen: 64 });
      // A provider with a choice of models (the model hub) may name one.
      const model = optionalString(body, "model", { minLen: 1, maxLen: 128 });
      return c.json(
        await this.generation.start(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          requireString(body, "agentId", { minLen: 1, maxLen: 128 }),
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
          {
            sound: {
              language: requireString(body, "language", { minLen: 5, maxLen: 5 }),
              assetKey: requireString(body, "assetKey", { minLen: 1, maxLen: 128 }),
              provider,
              ...(model !== undefined ? { model } : {}),
            },
          },
        ),
        202,
      );
    });
    app.get("/:activityId/runs/:runId/audio", async (c) => {
      const bytes = await this.generation.audioContent(
        requireValidId(c, "projectId"),
        pathParam(c, "activityId"),
        pathParam(c, "runId"),
      );
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": audioMimeType(bytes),
          "Content-Length": String(bytes.byteLength),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    });
    app.post("/:activityId/runs/:runId/accept-audio", async (c) => {
      const body = await readJson(c);
      return c.json(
        await this.generation.acceptAudio(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          pathParam(c, "runId"),
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
        ),
      );
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
    // What an author calls a ref, and whether others may build against it.
    app.patch("/:activityId/identity", async (c) => {
      const body = await readJson(c);
      if (body.stable !== undefined && typeof body.stable !== "boolean")
        throw badRequest("stable must be true or false.");
      return c.json(
        await this.activities.setRefIdentity(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          {
            ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
            ...(body.stable !== undefined ? { stable: body.stable as boolean } : {}),
          },
        ),
      );
    });
    // A new ref of the product, made from the template ref (`:activityId`) in one pass.
    app.get("/:activityId/refs/next-number", async (c) =>
      c.json(
        await this.activities.nextRefNumber(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
        ),
      ),
    );
    app.post("/:activityId/refs", async (c) => {
      const body = await readJson(c);
      if (typeof body.refNum !== "number") throw badRequest("refNum must be a number.");
      if (body.displayName !== undefined && typeof body.displayName !== "string")
        throw badRequest("displayName must be a string.");
      return c.json(
        await this.activities.createRefFromTemplate(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          {
            refNum: body.refNum,
            ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
            decisions: parseRefDecisions(body.decisions),
          },
        ),
        201,
      );
    });
    // A ref's number, changed when it was given the wrong one.
    app.post("/:activityId/ref-number", async (c) => {
      const projectId = requireValidId(c, "projectId");
      const activityId = pathParam(c, "activityId");
      const body = await readJson(c);
      const expectedRevision = requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 });
      // Loom's module in the checkout names its files by the current number, and the
      // checkout is never written; renaming the ref alone would leave the preview behind.
      if ((await this.sandbox.moduleDocuments(projectId, activityId)).source === "checkout")
        throw new HttpError(
          409,
          "checkout_ref",
          "This ref's module lives in the read-only WAF checkout under its current number, so it cannot be renumbered here.",
        );
      if ((await this.pipelines.status(projectId, activityId))?.status === "running")
        throw new HttpError(
          409,
          "pipeline_running",
          "This activity is running its stages. Stop them before renumbering the ref.",
        );
      return c.json(
        await this.activities.changeRefNum(projectId, activityId, body.refNum, expectedRevision),
      );
    });
    // Saved versions: any member may list them; saving one needs the owner (the guard above).
    app.get("/:activityId/versions", async (c) =>
      c.json({
        versions: await this.versions.list(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
        ),
      }),
    );
    app.post("/:activityId/versions", async (c) => {
      const body = await readJson(c);
      const label =
        body.label === null
          ? null
          : (optionalString(body, "label", { maxLen: VERSION_LABEL_MAX })?.trim() ?? null);
      if (label && /[\u0000-\u001f\u007f]/.test(label))
        throw badRequest("label cannot contain control characters.");
      const result = await this.versions.save(
        requireValidId(c, "projectId"),
        pathParam(c, "activityId"),
        { label, kind: "manual", author: c.var.user.userId },
      );
      // 201 when this save made a version; 200 when nothing changed and the latest is returned.
      return c.json(result, result.created ? 201 : 200);
    });
    // Compare a version with the draft as it is now, or with another version.
    app.get("/:activityId/versions/:versionId/diff", async (c) => {
      const against = c.req.query("against") ?? "current";
      if (against !== "current" && !VERSION_ID.test(against))
        throw badRequest('against must be "current" or a version id.');
      return c.json(
        await this.versions.diff(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          pathParam(c, "versionId"),
          against,
        ),
      );
    });
    // Restore a version (owner, by the guard above): the draft as it was is kept first.
    app.post("/:activityId/versions/:versionId/restore", async (c) => {
      const body = await readJson(c);
      return c.json(
        await this.versions.restore(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          pathParam(c, "versionId"),
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
          c.var.user.userId,
        ),
      );
    });
    // The product's tags, reached through any of its refs; every ref lists the same ones.
    app.put("/:activityId/tags", async (c) => {
      const body = await readJson(c);
      return c.json({
        tags: await this.activities.setProductTags(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          body.tags,
        ),
      });
    });
    // Delete archives: the activity leaves every list and its files stay on disk.
    app.delete("/:activityId", async (c) => {
      const projectId = requireValidId(c, "projectId");
      const activityId = pathParam(c, "activityId");
      // A stage sequence drives runs one after another, so between two of them no run is
      // marked running; the sequence itself is what has to be stopped first.
      if ((await this.pipelines.status(projectId, activityId))?.status === "running")
        throw new HttpError(
          409,
          "pipeline_running",
          "This activity is running its stages. Stop them before deleting the activity.",
        );
      await this.activities.archiveActivity(projectId, activityId);
      return c.body(null, 204);
    });
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
      const runner = stageRunner(body);
      return c.json(
        await this.generation.start(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          runner.agentId,
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
          undefined,
          runner.runtime,
        ),
        202,
      );
    });
    // A conversation about the activity, focused on what the author has open. It is a run
    // like any other, so the activity's history links it to its Session.
    app.post("/:activityId/assist", async (c) => {
      const body = await readJson(c);
      const runner = stageRunner(body);
      return c.json(
        await this.generation.start(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          runner.agentId,
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
          {
            assist: {
              message: requireString(body, "message", { minLen: 1, maxLen: ASSIST_MESSAGE_MAX }),
              focus: parseAssistFocus(body.focus),
            },
          },
          runner.runtime,
        ),
        202,
      );
    });
    app.post("/:activityId/plan-media", async (c) => {
      const body = await readJson(c);
      return c.json(
        await this.activities.planMedia(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
        ),
      );
    });
    app.put("/:activityId/media", async (c) => {
      const body = await readJson(c);
      return c.json(
        await this.activities.applyMedia(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          body.manifest,
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
        ),
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
    // "Run all stages": the runs an author could start by hand, chained and accepted in
    // order (see pipeline-run.ts). It answers at once; the steps run after.
    app.post("/:activityId/pipeline", async (c) => {
      const projectId = requireValidId(c, "projectId");
      const activityId = pathParam(c, "activityId");
      const body = await readJson(c);
      const runner = stageRunner(body);
      const bookMode = optionalString(body, "bookMode", { maxLen: 16 });
      if (bookMode && bookMode !== "readAlong" && bookMode !== "decodable")
        throw badRequest("bookMode must be readAlong or decodable.");
      const language = optionalString(body, "language", { maxLen: 35 });
      const assetKey = optionalString(body, "assetKey", { maxLen: 200 });
      if (assetKey && !language) throw badRequest("assetKey needs a language.");
      const soundProvider = optionalString(body, "soundProvider", { maxLen: 32 });
      if (soundProvider && soundProvider !== "elevenlabs" && soundProvider !== "agenthub")
        throw badRequest("soundProvider must be elevenlabs or agenthub.");
      const state = await this.pipelines.start(projectId, activityId, {
        selection: parseSelection(body.stage),
        ...(language ? { scope: { language, ...(assetKey ? { assetKey } : {}) } } : {}),
        agentId: runner.agentId,
        ...(runner.runtime ? { codingAgentId: runner.runtime.codingAgentId } : {}),
        ...(optionalString(body, "voice", { maxLen: 64 })
          ? { voice: optionalString(body, "voice", { maxLen: 64 }) }
          : {}),
        ...(optionalString(body, "wafRoot", { maxLen: 4096 })
          ? { wafRoot: optionalString(body, "wafRoot", { maxLen: 4096 }) }
          : {}),
        ...(bookMode ? { bookMode: bookMode as "readAlong" | "decodable" } : {}),
        ...(soundProvider ? { soundProvider: soundProvider as SoundProviderId } : {}),
      });
      return c.json(state, 202);
    });
    // Check quality: accessibility and reading level of the played activity, in the test
    // browser. It answers at once with the run; the reports come when the run settles.
    app.post("/:activityId/quality", async (c) =>
      c.json(
        await this.quality.start(requireValidId(c, "projectId"), pathParam(c, "activityId")),
        202,
      ),
    );
    app.get("/:activityId/quality", async (c) =>
      c.json(
        (await this.quality.state(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
        )) satisfies QualityStateResponse,
      ),
    );
    // Run tests: each acceptance criterion checked against the played activity by an agent's
    // tests. It answers at once with the run (already finished when there is nothing to test);
    // the report comes when the run settles.
    app.post("/:activityId/test", async (c) => {
      const body = await readJson(c);
      const runner = stageRunner(body);
      return c.json(
        await this.acceptance.start(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          runner.agentId,
          requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 }),
          runner.runtime,
        ),
        202,
      );
    });
    app.get("/:activityId/test-report", async (c) =>
      c.json(
        (await this.acceptance.state(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
        )) satisfies AcceptanceStateResponse,
      ),
    );
    // What stands between the draft and an assembled module, checked where the facts live.
    app.get("/:activityId/readiness", async (c) => {
      const wafRoot = (c.req.query("wafRoot") ?? "").trim();
      if (wafRoot.length > 4096) throw badRequest("wafRoot is too long.");
      const projectId = requireValidId(c, "projectId");
      const activityId = pathParam(c, "activityId");
      return c.json({
        checks: await this.activities.readiness(
          projectId,
          activityId,
          wafRoot,
          // A module that cannot be read leaves the author's edit, which the service reads.
          await Promise.all([
            this.currentAssessment(projectId, activityId),
            this.sandbox.ownAssessment(projectId, activityId),
          ]).then(
            ([current, own]) => ({ current, own }),
            () => undefined,
          ),
        ),
      });
    });
    // Whether a deploy could start. Reading it is a member's; asking the remote about the
    // branches reaches the network with the server's SSH keys, so that is the owner's.
    app.get("/:activityId/deploy/context", async (c) => {
      const projectId = requireValidId(c, "projectId");
      const checkRemote = c.req.query("checkRemote") === "1";
      if (checkRemote) this.access.requireProjectOwner(c.var.user.userId, projectId);
      return c.json({
        context: await this.deploys.context(projectId, pathParam(c, "activityId"), {
          checkRemote,
        }),
      } satisfies DeployContextResponse);
    });
    // The release: its state and each stage's (a member's to read), the log after a cursor,
    // and starting or stopping it (the owner's: it pushes a branch and starts a Jenkins build).
    app.get("/:activityId/deploy", async (c) =>
      c.json(
        (await this.deploys.state(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
        )) satisfies DeployStateResponse,
      ),
    );
    app.post("/:activityId/deploy", async (c) => {
      const body = await readJson(c);
      const stage = body.stage;
      if (!isStageSelection(stage))
        throw badRequest("stage must be release or one of the release stages.");
      const moduleVersion =
        optionalString(body, "moduleVersion", { maxLen: 40 })?.trim() || undefined;
      if (moduleVersion !== undefined && !isModuleVersion(moduleVersion))
        throw badRequest("moduleVersion must be a version like 1.2.3.");
      return c.json(
        {
          run: await this.deploys.start(
            requireValidId(c, "projectId"),
            pathParam(c, "activityId"),
            {
              target: "qa",
              stage,
              ...(moduleVersion ? { moduleVersion } : {}),
            },
          ),
        } satisfies DeployRunResponse,
        202,
      );
    });
    app.get("/:activityId/deploy/runs/:runId/log", async (c) => {
      const raw = c.req.query("after") ?? "0";
      if (!/^\d{1,15}$/.test(raw)) throw badRequest("after must be a line number.");
      return c.json(
        (await this.deploys.log(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          requireValidId(c, "runId"),
          Number(raw),
        )) satisfies DeployLogResponse,
      );
    });
    app.post("/:activityId/deploy/stop", async (c) => {
      const run = await this.deploys.stop(
        requireValidId(c, "projectId"),
        pathParam(c, "activityId"),
      );
      if (!run)
        throw new HttpError(404, "deploy_run_not_found", "This activity has no deploy run.");
      return c.json({ run } satisfies DeployRunResponse);
    });
    app.post("/:activityId/deploy/clones", async (c) =>
      c.json({
        context: await this.deploys.prepareClones(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
        ),
      } satisfies DeployContextResponse),
    );
    app.get("/:activityId/pipeline", async (c) =>
      c.json({
        pipeline: await this.pipelines.status(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
        ),
      }),
    );
    app.post("/:activityId/pipeline/stop", async (c) => {
      return c.json({
        pipeline: await this.pipelines.stop(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
        ),
      });
    });
    app.get("/:activityId/runs/:runId/candidate", async (c) =>
      c.json({
        candidate: await this.generation.candidate(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          pathParam(c, "runId"),
        ),
      }),
    );
    app.get("/:activityId/runs/:runId/proposal", async (c) =>
      c.json(
        await this.generation.proposal(
          requireValidId(c, "projectId"),
          pathParam(c, "activityId"),
          pathParam(c, "runId"),
        ),
      ),
    );
    // The whole proposal, read fresh from the run and applied as one change to the draft.
    app.post("/:activityId/runs/:runId/proposal/apply", async (c) => {
      const projectId = requireValidId(c, "projectId");
      const activityId = pathParam(c, "activityId");
      const body = await readJson(c);
      const expectedRevision = requireString(body, "expectedRevision", { minLen: 1, maxLen: 128 });
      const { proposal, error } = await this.generation.proposal(
        projectId,
        activityId,
        pathParam(c, "runId"),
      );
      if (!proposal)
        throw new HttpError(
          409,
          "proposal_missing",
          error ?? "The conversation has no proposal to apply.",
        );
      return c.json(
        await this.activities.applyProposal(
          projectId,
          activityId,
          proposal.changes,
          expectedRevision,
        ),
      );
    });
    app.post("/:activityId/runs/:runId/proposal/discard", async (c) => {
      await this.generation.discardProposal(
        requireValidId(c, "projectId"),
        pathParam(c, "activityId"),
        pathParam(c, "runId"),
      );
      return c.json({ proposal: null, error: null });
    });
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
