import fs from "node:fs/promises";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, resolve: open };
}

it("discards a watched folder removal that settles after the host closes", async () => {
  const t = await createTestApp();
  const client = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  const root = "/api/projects/default_project/agents/penguin_support/workbenches";
  const dir = path.join(
    t.root,
    "projects/default_project/agents/penguin_support/agent_state/workbenches/support",
  );
  const entered = gate();
  const release = gate();
  const finished = gate();
  const realRead = fs.readFile.bind(fs);
  let stopped = false;
  const read = vi.spyOn(fs, "readFile");
  try {
    expect((await client.get(root + "?id=support")).status).toBe(200);
    read.mockImplementation(async (filename, options) => {
      if (filename === path.join(dir, "package.json")) {
        entered.resolve();
        await release.promise;
        try {
          return await realRead(filename, options);
        } finally {
          finished.resolve();
        }
      }
      return realRead(filename, options);
    });
    await fs.appendFile(path.join(dir, "index.ts"), "\n");
    await entered.promise;
    await t.cleanup();
    stopped = true;
    const prepares = vi.spyOn(t.deps.db, "prepare");
    try {
      release.resolve();
      await finished.promise;
      await setImmediate();
      expect(prepares).not.toHaveBeenCalled();
    } finally {
      prepares.mockRestore();
    }
  } finally {
    release.resolve();
    read.mockRestore();
    if (!stopped) await t.cleanup();
  }
});
