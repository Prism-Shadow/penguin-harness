/**
 * Changing an organization's company workflows is itself an Action, on subject `workflow:<id>`:
 *
 *   workflow.write     { files: { <path>: <content> | null }, replace? }  write (or delete) files,
 *                      `replace` deleting every other file of the folder; then load
 *   workflow.remove    delete the workflow and its versions
 *   workflow.rollback  { revision }  restore a recorded version, then load
 *   workflow.reload    load the folder again, after it was changed on the server in place
 *
 * Each run's result carries the load's outcome — the revision serving, when the files did not
 * load why, and the contributions the registry left out with their reasons — so the Activity answers who changed the company's process when, and whether
 * the change took effect. They are the registry's own built-in Actions (with the `workflow`
 * subject resolver), and a company workflow can neither replace their guard nor hook them
 * (action-index.ts): an organization cannot lock itself out of the way it changes its
 * workflows. Their default guard allows any member of the organization.
 *
 * The reads are routes of their own, `…/organizations/:orgId/workflows[/:id[/files/<path>|/history]]`.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { CompanyWorkflowView } from "@prismshadow/penguin-server/api";
import type { OrgView } from "@prismshadow/penguin-server/plugin";
import { ActionRefusal, type ActionCode, type SubjectCode } from "./action-model.js";
import type { Contributed } from "./action-index.js";
import type { ActionRegistry } from "./action-registry.js";
import { refusalHandler } from "./action-routes.js";
import type { CompanyWorkflows } from "./company-workflows.js";
import { actorOfQuery, param } from "./route-input.js";

/** The registry's own module, as the contributor of these Actions. */
const FROM = "CompanyActionRegistry";

/** The read routes' contribution id, as the manifest names it. */
export const WORKFLOW_ROUTES_ID = "company-proposals.workflow-routes";

/** Why the registry left a contribution out: its id, and the reason. */
type Skipped = ReadonlyArray<{ id: string; reason: string }>;

/** The organization's contributions its registry leaves out now (ActionRegistry.skippedIn). */
export type SkippedIn = (org: OrgView) => Promise<Skipped>;

/**
 * The workflow as the registry takes it: `contributions` are those in force, and the ones it
 * left out are in `skipped`, each with its reason — the same for a read and for a run's result.
 */
export function inForce(view: CompanyWorkflowView, skipped: Skipped): CompanyWorkflowView {
  const mine = skipped.filter((s) => view.contributions.includes(s.id));
  const out = new Set(mine.map((s) => s.id));
  return {
    ...view,
    contributions: view.contributions.filter((id) => !out.has(id)),
    skipped: mine,
  };
}

/** What a write, a rollback or a reload answers: the workflow, and whether it took effect. */
function loaded(view: CompanyWorkflowView, skipped: Skipped) {
  return {
    workflow: inForce(view, skipped),
    loaded: view.error === null && view.serving === view.revision,
    error: view.error,
  };
}

function filesOf(raw: unknown): Record<string, string | null> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ActionRefusal(400, "bad_files", "files maps each path to its content, or null.");
  }
  return raw as Record<string, string | null>;
}

const action = (
  id: string,
  key: string,
  params: Record<string, string>,
  description: string,
  run: ActionCode["run"],
): Contributed => ({
  id,
  from: FROM,
  data: { kind: "action", key, subjects: ["workflow"], params, description },
  code: { run } satisfies ActionCode,
});

/** The `workflow.*` Actions and the `workflow` subject resolver, over the organization's workflows. */
export function workflowContributions(
  workflows: CompanyWorkflows,
  skippedIn: SkippedIn,
): Contributed[] {
  /** The load's answer, with what the organization's registry now leaves out of it. */
  const answer = async (org: OrgView, view: CompanyWorkflowView) =>
    loaded(view, await skippedIn(org));
  const subject: SubjectCode = {
    state: async ({ org }, s) => {
      // A workflow that does not exist yet is a subject too: its first write creates it.
      try {
        return await workflows.view(org, s.id);
      } catch (err) {
        if (err instanceof ActionRefusal && err.status === 404) return null;
        throw err;
      }
    },
  };
  return [
    action(
      "company-proposals.workflow.write",
      "workflow.write",
      { files: "object", "replace?": "boolean" },
      "Write files of a company workflow (null deletes one), then load it.",
      async (ctx) =>
        answer(
          ctx.org,
          await workflows.write(
            ctx.org,
            ctx.subject.id,
            filesOf(ctx.params.files),
            ctx.params.replace === true,
          ),
        ),
    ),
    action(
      "company-proposals.workflow.remove",
      "workflow.remove",
      {},
      "Delete a company workflow and its versions.",
      async (ctx) => {
        await workflows.remove(ctx.org, ctx.subject.id);
        return { removed: ctx.subject.id };
      },
    ),
    action(
      "company-proposals.workflow.rollback",
      "workflow.rollback",
      { revision: "string" },
      "Restore a recorded version of a company workflow, then load it.",
      async (ctx) =>
        answer(
          ctx.org,
          await workflows.rollback(ctx.org, ctx.subject.id, ctx.params.revision as string),
        ),
    ),
    action(
      "company-proposals.workflow.reload",
      "workflow.reload",
      {},
      "Load a company workflow again, after its files were changed in place.",
      async (ctx) => answer(ctx.org, await workflows.reload(ctx.org, ctx.subject.id)),
    ),
    {
      id: "company-proposals.workflow.subject",
      from: FROM,
      data: { kind: "subject", subjects: ["workflow"] },
      code: subject,
    },
  ];
}

/** `GET …/workflows[/:id[/files/<path>|/history]]`: the organization's company workflows. */
export function workflowRoutes(registry: ActionRegistry, workflows: CompanyWorkflows): Hono {
  const app = new Hono();
  app.onError(refusalHandler);
  const scope = (c: Context) =>
    registry.scope(param(c, "projectId"), param(c, "orgId"), actorOfQuery(c));

  app.get("/", async (c) => {
    const s = await scope(c);
    const list = await workflows.list(s.org);
    return c.json({ workflows: list.map((w) => inForce(w, s.index.skipped)) });
  });
  app.get("/:id", async (c) => {
    const s = await scope(c);
    return c.json(inForce(await workflows.view(s.org, c.req.param("id")), s.index.skipped));
  });
  app.get("/:id/history", async (c) => {
    const s = await scope(c);
    return c.json({ versions: await workflows.history(s.org, c.req.param("id")) });
  });
  app.get("/:id/files/*", async (c) => {
    const s = await scope(c);
    const id = c.req.param("id");
    const marker = `/${encodeURIComponent(id)}/files/`;
    const at = c.req.path.indexOf(marker);
    const rel = at < 0 ? "" : decodeURIComponent(c.req.path.slice(at + marker.length));
    const content = await workflows.readFile(s.org, id, rel);
    if (content === null) {
      throw new ActionRefusal(404, "file_not_found", `Workflow ${id} has no file ${rel}.`);
    }
    return c.json({ path: rel, content });
  });
  return app;
}
