/**
 * web.db's stored paths when the layout migration moves a Project's folder (layout/web-db-paths.ts):
 *
 * - Every path under the old folder gets the same place under the new one — a Session's
 *   Workspace, its sandbox's masked paths, an Agent API Workspace, the Trace cache's copy, the
 *   sandbox settings' masked paths, a draft's Workspace — and a path anywhere else is left as it
 *   was, another Project's whose name only starts the same included.
 * - One transaction: a rewrite that fails leaves every row as it was.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "@prismshadow/penguin-library-db";
import { rewriteWebDbPaths } from "../src/layout/web-db-paths.js";

const FROM = "/data/acme";
const TO = "/data/projects/acme";
const MOVES = [{ from: FROM, to: TO }];
const NOW = "2026-11-20T00:00:00.000Z";

let db: DatabaseSync;

beforeEach(() => {
  db = openDatabase(":memory:");
  db.prepare(
    "INSERT INTO users (user_id, password_hash, is_admin, created_at) VALUES ('admin', 'x', 1, ?)",
  ).run(NOW);
});

afterEach(() => db.close());

function session(id: string, workspace: string, sandbox: unknown = null): void {
  db.prepare(
    "INSERT INTO sessions (session_id, project_id, agent_id, provider, model_id, workspace, sandbox, created_at) VALUES (?, 'acme', 'writer', 'deepseek', 'deepseek-flash', ?, ?, ?)",
  ).run(id, workspace, sandbox === null ? null : JSON.stringify(sandbox), NOW);
}

const one = <T>(sql: string, ...args: (string | number)[]): T => db.prepare(sql).get(...args) as T;

describe("the paths web.db stores", () => {
  it("moves every one under the old folder, and leaves every other where it is", () => {
    session("s-temp", `${FROM}/agents/writer/workspaces/tmp-0a1b2c3d`, {
      mode: "workspace-write",
      maskPaths: [`${FROM}/agents/writer/agent_state`, "/home/me/secrets"],
    });
    session("s-user", "/home/me/code");
    session("s-twin", "/data/acme2/agents/writer/workspaces/tmp-0a1b2c3d");
    db.prepare(
      "INSERT INTO agent_api (project_id, agent_id, workspace, updated_at) VALUES ('acme', 'writer', ?, ?)",
    ).run(`${FROM}/organizations/co_one/workspace`, NOW);
    db.prepare(
      "INSERT INTO trace_sessions (session_id, project_id, agent_id, workspace) VALUES ('s-temp', 'acme', 'writer', ?)",
    ).run(`${FROM}/agents/writer/workspaces/tmp-0a1b2c3d`);
    db.prepare("INSERT INTO server_settings (key, value) VALUES ('plugin-config:sandbox', ?)").run(
      JSON.stringify({ defaultPreset: "workspace-write", maskPaths: [FROM] }),
    );
    db.prepare(
      "INSERT INTO user_drafts (user_id, draft_key, project_id, value_json, updated_at) VALUES ('admin', 'chat:acme', 'acme', ?, ?)",
    ).run(JSON.stringify({ text: `see ${FROM}/notes`, workspace: `${FROM}/organizations` }), NOW);

    rewriteWebDbPaths(db, MOVES);

    const workspace = (id: string) =>
      one<{ workspace: string }>("SELECT workspace FROM sessions WHERE session_id = ?", id)
        .workspace;
    expect(workspace("s-temp")).toBe(`${TO}/agents/writer/workspaces/tmp-0a1b2c3d`);
    expect(workspace("s-user")).toBe("/home/me/code");
    expect(workspace("s-twin")).toBe("/data/acme2/agents/writer/workspaces/tmp-0a1b2c3d");
    expect(
      JSON.parse(
        one<{ sandbox: string }>("SELECT sandbox FROM sessions WHERE session_id = 's-temp'")
          .sandbox,
      ),
    ).toEqual({
      mode: "workspace-write",
      maskPaths: [`${TO}/agents/writer/agent_state`, "/home/me/secrets"],
    });
    expect(one<{ workspace: string }>("SELECT workspace FROM agent_api").workspace).toBe(
      `${TO}/organizations/co_one/workspace`,
    );
    expect(one<{ workspace: string }>("SELECT workspace FROM trace_sessions").workspace).toBe(
      `${TO}/agents/writer/workspaces/tmp-0a1b2c3d`,
    );
    expect(
      JSON.parse(
        one<{ value: string }>(
          "SELECT value FROM server_settings WHERE key = 'plugin-config:sandbox'",
        ).value,
      ),
    ).toEqual({ defaultPreset: "workspace-write", maskPaths: [TO] });
    // A draft's Workspace moves; what the user typed stays as typed.
    expect(
      JSON.parse(one<{ value_json: string }>("SELECT value_json FROM user_drafts").value_json),
    ).toEqual({ text: `see ${FROM}/notes`, workspace: `${TO}/organizations` });
  });

  it("rewrites nothing when one row cannot be written", () => {
    session("s-temp", `${FROM}/agents/writer/workspaces/tmp-0a1b2c3d`);
    db.prepare(
      "INSERT INTO agent_api (project_id, agent_id, workspace, updated_at) VALUES ('acme', 'writer', ?, ?)",
    ).run(`${FROM}/w`, NOW);
    db.exec(
      "CREATE TRIGGER refuse BEFORE UPDATE ON agent_api BEGIN SELECT RAISE(ABORT, 'refused'); END",
    );

    expect(() => rewriteWebDbPaths(db, MOVES)).toThrow(/refused/);

    expect(
      one<{ workspace: string }>("SELECT workspace FROM sessions WHERE session_id = 's-temp'")
        .workspace,
    ).toBe(`${FROM}/agents/writer/workspaces/tmp-0a1b2c3d`);
  });
});
