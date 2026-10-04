/**
 * `penguin org workflow`: the organization's company workflows (company-proposals) — packages
 * under the organization's `workflows/<id>/`, shaped like an Agent's workflow, whose
 * contributions to the Action registry take effect in the organization as soon as they load.
 *
 *   workflow ls
 *   workflow put <id> <dir> [--keep]     write a local directory as the workflow (the
 *                                        `workflow.write` Action; --keep leaves the files the
 *                                        directory lacks), and say whether it loaded
 *   workflow rm <id>                     the `workflow.remove` Action
 *   workflow reload <id>                 the `workflow.reload` Action (after an edit in place)
 *   workflow history <id>                its recorded versions
 *   workflow rollback <id> <revision>    the `workflow.rollback` Action
 *
 * The reads are `GET …/organizations/<org>/workflows[/:id/history]`; every change is an Action
 * run, so the Activity records who changed the organization's workflows and whether it loaded.
 */
import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import type {
  CompanyWorkflowHistoryResponse,
  CompanyWorkflowsResponse,
  CompanyWorkflowView,
} from "@prismshadow/penguin-server/api";
import type { Messages } from "../i18n.js";
import { renderTable } from "../table.js";
import { startRun } from "./action-client.js";
import type { DeployKit } from "./proposal-deploy.js";

/** What a put sends at most (the server's own limits are the same). */
const MAX_FILES = 200;
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * The files of a local workflow directory, by relative path: everything but `node_modules` and
 * the dot-entries (the server's `.harness/` and `.build/`, a `.git`). The reason when it cannot
 * be sent.
 */
export function readWorkflowDir(
  dir: string,
): { files: Record<string, string> } | { error: string } {
  const files: Record<string, string> = {};
  let bytes = 0;
  const walk = (abs: string, rel: string): string | null => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const childRel = rel === "" ? e.name : `${rel}/${e.name}`;
      const childAbs = path.join(abs, e.name);
      if (e.isDirectory()) {
        const err = walk(childAbs, childRel);
        if (err !== null) return err;
      } else if (e.isFile()) {
        const content = fs.readFileSync(childAbs, "utf8");
        bytes += Buffer.byteLength(content);
        files[childRel] = content;
        if (Object.keys(files).length > MAX_FILES) return `more than ${MAX_FILES} files`;
        if (bytes > MAX_BYTES) return `more than ${MAX_BYTES} bytes`;
      }
    }
    return null;
  };
  try {
    if (!fs.statSync(dir).isDirectory()) return { error: "not a directory" };
    const err = walk(dir, "");
    if (err !== null) return { error: err };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  if (files["package.json"] === undefined) return { error: "no package.json in it" };
  return { files };
}

/** What a write, a rollback or a reload answers. */
interface Loaded {
  workflow: CompanyWorkflowView;
  loaded: boolean;
  error: string | null;
}

export function registerOrgWorkflow(org: Command, t: Messages, kit: DeployKit): void {
  const workflow = org.command("workflow").description(t.org.workflowDesc);

  /** Runs a `workflow.*` Action and reports the load it answers. */
  const change = async (
    opts: Record<string, unknown>,
    key: string,
    id: string,
    params: Record<string, unknown>,
  ): Promise<void> => {
    const request = await kit.openActions(opts);
    if (request === null) return;
    const res = await startRun(request, { key }, `workflow:${id}`, params, kit.actorFields());
    if (res === null) return;
    if (opts.json === true) {
      kit.printJson(res);
      return;
    }
    const result = res.result as Loaded | { removed: string } | null;
    if (result !== null && "removed" in result) {
      kit.print(t.org.workflowRemoved(id));
      return;
    }
    if (result === null || result.loaded) {
      kit.print(t.org.workflowLoaded(id, result?.workflow.revision ?? ""));
      for (const s of result?.workflow.skipped ?? [])
        kit.print(t.org.workflowSkipped(s.id, s.reason));
      return;
    }
    kit.fail(t.org.workflowNotLoaded(id, result.error ?? ""));
    kit.exit(1);
  };

  kit
    .scoped(workflow.command("ls").description(t.org.workflowLsDesc))
    .action(async (opts: Record<string, unknown>) => {
      const request = await kit.openWorkflows(opts);
      if (request === null) return;
      const res = await request<CompanyWorkflowsResponse>("GET", kit.actorQuery());
      if (res === null) return;
      if (opts.json === true) {
        kit.printJson(res);
        return;
      }
      if (res.workflows.length === 0) {
        kit.print(t.org.workflowsNone);
        return;
      }
      kit.write(
        renderTable(
          t.org.workflowsHeader,
          res.workflows.map((w) => [
            w.id,
            w.serving ?? "-",
            w.revision,
            String(w.contributions.length),
            w.error === null ? "ok" : w.error.split("\n")[0]!.slice(0, 80),
          ]),
        ),
      );
    });

  kit
    .scoped(
      workflow
        .command("put <id> <dir>")
        .description(t.org.workflowPutDesc)
        .option("--keep", t.org.workflowPutKeep),
    )
    .action(async (id: string, dir: string, opts: Record<string, unknown>) => {
      const read = readWorkflowDir(path.resolve(dir));
      if ("error" in read) {
        kit.fail(t.org.workflowDirInvalid(dir, read.error));
        return;
      }
      await change(opts, "workflow.write", id, {
        files: read.files,
        ...(opts.keep === true ? {} : { replace: true }),
      });
    });

  kit
    .scoped(workflow.command("rm <id>").description(t.org.workflowRmDesc))
    .action((id: string, opts: Record<string, unknown>) => change(opts, "workflow.remove", id, {}));

  kit
    .scoped(workflow.command("reload <id>").description(t.org.workflowReloadDesc))
    .action((id: string, opts: Record<string, unknown>) => change(opts, "workflow.reload", id, {}));

  kit
    .scoped(workflow.command("rollback <id> <revision>").description(t.org.workflowRollbackDesc))
    .action((id: string, revision: string, opts: Record<string, unknown>) =>
      change(opts, "workflow.rollback", id, { revision }),
    );

  kit
    .scoped(workflow.command("history <id>").description(t.org.workflowHistoryDesc))
    .action(async (id: string, opts: Record<string, unknown>) => {
      const request = await kit.openWorkflows(opts);
      if (request === null) return;
      const res = await request<CompanyWorkflowHistoryResponse>(
        "GET",
        `/${encodeURIComponent(id)}/history${kit.actorQuery()}`,
      );
      if (res === null) return;
      if (opts.json === true) {
        kit.printJson(res);
        return;
      }
      if (res.versions.length === 0) {
        kit.print(t.org.workflowVersionsNone);
        return;
      }
      kit.write(
        renderTable(
          t.org.workflowVersionsHeader,
          res.versions.map((v) => [v.revision, v.savedAt, String(v.files.length)]),
        ),
      );
    });
}
