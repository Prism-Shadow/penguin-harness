import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it } from "vitest";
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
