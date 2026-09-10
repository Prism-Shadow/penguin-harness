/**
 * The read-only opener: what `penguin server status` reads a machine's database through.
 * The point is not that the reader happens not to write — it is that it cannot.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, openDatabaseReadOnly } from "../src/db/database.js";

describe("openDatabaseReadOnly", () => {
  it("answers reads and refuses every write", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-ro-"));
    const file = path.join(dir, "web.db");
    try {
      openDatabase(file).close();
      const db = openDatabaseReadOnly(file);
      try {
        expect(db.prepare("SELECT COUNT(*) AS n FROM machine").get()).toEqual({ n: 0 });
        expect(() =>
          db.exec("INSERT INTO machine (singleton, machine_id) VALUES (1, 'LNrJdHAZJ91G58i0')"),
        ).toThrow(/readonly/);
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not create a database that is not there", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-ro-"));
    try {
      const file = path.join(dir, "web.db");
      expect(() => openDatabaseReadOnly(file)).toThrow();
      expect(fs.existsSync(file)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
