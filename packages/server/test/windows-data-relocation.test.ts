import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it } from "vitest";
import {
  memoryScopeDir,
  projectDir,
  WORKSPACE_MARKER_FILENAME,
  workspaceMemoryKeyForRealPath,
} from "@prismshadow/penguin-core";
import { openDatabase } from "@prismshadow/penguin-library-db";
import { migrateDataRoot } from "../src/layout/migrate-data-root.js";

it.skipIf(process.platform !== "win32")(
  "rewrites only the verified database and its managed Session workspaces",
  async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-workspaces-"));
    const previous = path.join(temp, "old", "data");
    const current = path.join(temp, "new", "data");
    const outside = path.join(temp, "outside");
    const oldWorkspace = path.join(
      previous,
      "projects",
      "sample",
      "agents",
      "one",
      "workspaces",
      "tmp-test",
    );
    const oldFile = path.join(previous, "web.db");
    const currentFile = path.join(current, "web.db");
    const read = (db: ReturnType<typeof openDatabase>) =>
      db
        .prepare("SELECT workspace FROM sessions ORDER BY session_id")
        .all()
        .map((row) => row.workspace);
    try {
      await fs.mkdir(previous, { recursive: true });
      await fs.mkdir(current, { recursive: true });
      const old = openDatabase(oldFile);
      const add = old.prepare(
        "INSERT INTO sessions (session_id, project_id, agent_id, provider, model_id, workspace, created_at) VALUES (?, 'default_project', 'default_agent', 'custom', 'text', ?, '2026-11-23')",
      );
      add.run("one", oldWorkspace);
      add.run("two", outside);
      old.close();
      await fs.copyFile(oldFile, currentFile);
      await fs.writeFile(
        path.join(path.dirname(current), "windows-data-roots.json"),
        JSON.stringify({ from: [previous], to: current }),
      );
      const before = await fs.readFile(oldFile);
      const original = openDatabase(oldFile);
      const copy = openDatabase(currentFile);
      try {
        await migrateDataRoot(current, original, () => {});
        expect(read(original)).toEqual([oldWorkspace, outside]);
        for (let boot = 0; boot < 2; boot++) {
          await migrateDataRoot(current, copy, () => {});
          expect(read(copy)).toEqual([
            path.join(current, path.relative(previous, oldWorkspace)),
            outside,
          ]);
        }
      } finally {
        original.close();
        copy.close();
      }
      expect(await fs.readFile(oldFile)).toEqual(before);
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform !== "win32")(
  "relocates config files and workspace memory inside top-level legacy Projects before layout migration",
  async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-legacy-relocate-"));
    const previous = path.join(temp, "old", "data");
    const current = path.join(temp, "new", "data");
    const outside = path.join(temp, "outside");
    const oldDesk = path.join(
      previous,
      "default_project",
      "organizations",
      "co_one",
      "workspace",
      "hr",
    );
    const expectedDesk = path.join(
      projectDir(current, "default_project"),
      "organizations",
      "co_one",
      "workspace",
      "hr",
    );
    const oldKey = workspaceMemoryKeyForRealPath(oldDesk);
    const expectedKey = workspaceMemoryKeyForRealPath(expectedDesk);
    const outsideKey = workspaceMemoryKeyForRealPath(outside);
    try {
      await fs.mkdir(outside, { recursive: true });
      await fs.mkdir(path.join(current, "default_project", "organizations", "co_one"), {
        recursive: true,
      });
      await fs.mkdir(
        path.join(current, "default_project", "agents", "one", "agent_state", "schedule"),
        { recursive: true },
      );
      await fs.writeFile(
        path.join(current, "default_project", ".project_config.toml"),
        `[default_chat]\nworkspace = ${JSON.stringify(oldDesk)}\n`,
        "utf8",
      );
      await fs.writeFile(
        path.join(current, "default_project", "organizations", "co_one", "desks.toml"),
        `[one]\nworkspace = ${JSON.stringify(oldDesk)}\n`,
        "utf8",
      );
      await fs.writeFile(
        path.join(
          current,
          "default_project",
          "agents",
          "one",
          "agent_state",
          "schedule",
          "daily.toml",
        ),
        `prompt = "check"\nworkspace = ${JSON.stringify(oldDesk)}\n`,
        "utf8",
      );
      const legacyMemBase = path.join(
        current,
        "default_project",
        "agents",
        "one",
        "agent_state",
        "memory",
      );
      await fs.mkdir(path.join(legacyMemBase, oldKey), { recursive: true });
      await fs.writeFile(
        path.join(legacyMemBase, oldKey, WORKSPACE_MARKER_FILENAME),
        `${oldDesk}\n`,
        "utf8",
      );
      await fs.writeFile(path.join(legacyMemBase, oldKey, "MEMORY.md"), "legacy note\n", "utf8");
      await fs.mkdir(path.join(legacyMemBase, outsideKey), { recursive: true });
      await fs.writeFile(
        path.join(legacyMemBase, outsideKey, WORKSPACE_MARKER_FILENAME),
        `${outside}\n`,
        "utf8",
      );
      await fs.writeFile(
        path.join(legacyMemBase, outsideKey, "MEMORY.md"),
        "outside note\n",
        "utf8",
      );

      const dbFile = path.join(current, "web.db");
      const db = openDatabase(dbFile);
      db.prepare(
        "INSERT INTO sessions (session_id, project_id, agent_id, provider, model_id, workspace, created_at) VALUES (?, 'default_project', 'one', 'custom', 'text', ?, '2026-11-23')",
      ).run("legacy-1", oldDesk);
      await fs.writeFile(
        path.join(path.dirname(current), "windows-data-roots.json"),
        JSON.stringify({ from: [previous], to: current }),
      );

      try {
        for (let boot = 0; boot < 2; boot++) {
          await migrateDataRoot(current, db, () => {});
          expect(
            await fs.readFile(
              path.join(projectDir(current, "default_project"), ".project_config.toml"),
              "utf8",
            ),
          ).toBe(`[default_chat]\nworkspace = ${JSON.stringify(expectedDesk)}\n`);
          expect(
            await fs.readFile(
              path.join(
                projectDir(current, "default_project"),
                "organizations",
                "co_one",
                "desks.toml",
              ),
              "utf8",
            ),
          ).toBe(`[one]\nworkspace = ${JSON.stringify(expectedDesk)}\n`);
          expect(
            await fs.readFile(
              path.join(
                projectDir(current, "default_project"),
                "agents",
                "one",
                "agent_state",
                "schedule",
                "daily.toml",
              ),
              "utf8",
            ),
          ).toBe(`prompt = "check"\nworkspace = ${JSON.stringify(expectedDesk)}\n`);

          const relocatedScope = memoryScopeDir(current, "default_project", "one", expectedKey);
          expect(
            await fs.readFile(path.join(relocatedScope, WORKSPACE_MARKER_FILENAME), "utf8"),
          ).toBe(`${expectedDesk}\n`);
          expect(await fs.readFile(path.join(relocatedScope, "MEMORY.md"), "utf8")).toBe(
            "legacy note\n",
          );
          await expect(
            fs.lstat(memoryScopeDir(current, "default_project", "one", oldKey)),
          ).rejects.toMatchObject({ code: "ENOENT" });

          const untouchedOutside = memoryScopeDir(current, "default_project", "one", outsideKey);
          expect(
            await fs.readFile(path.join(untouchedOutside, WORKSPACE_MARKER_FILENAME), "utf8"),
          ).toBe(`${outside}\n`);

          const row = db
            .prepare("SELECT workspace FROM sessions WHERE session_id = ?")
            .get("legacy-1") as { workspace: string };
          expect(row.workspace).toBe(expectedDesk);
        }
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  },
);
