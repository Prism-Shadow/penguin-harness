/** Exercise the installed server, isolated from the checkout, the user's Git and credentials. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";

export async function checkAgentStateGit(serverEntry, args = []) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-offline-git-"));
  const root = path.join(scratch, "Agent data");
  const blocked = path.join(scratch, "empty PATH");
  const portFile = path.join(scratch, "port");
  const fake = path.join(scratch, "system-git-was-used");
  await fs.mkdir(blocked);
  const config = path.join(scratch, ".gitconfig");
  const originalConfig = "[user]\n\tname = Offline Author\n\temail = off@example.test\n";
  await fs.writeFile(config, originalConfig);
  if (process.platform !== "win32") {
    await fs.writeFile(
      path.join(blocked, "git"),
      `#!/bin/sh\n: > "$PENGUIN_GIT_CHECK_MARK"\nexit 127\n`,
      { mode: 0o755 },
    );
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^path$|^git_|^penguin_|^(home|userprofile)$/i.test(key),
    ),
  );
  const child = spawn(process.execPath, [serverEntry, ...args], {
    cwd: scratch,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...env,
      HOME: scratch,
      USERPROFILE: scratch,
      PATH: blocked,
      PENGUIN_GIT_CHECK_MARK: fake,
      HTTP_PROXY: "http://127.0.0.1:1",
      HTTPS_PROXY: "http://127.0.0.1:1",
      NO_PROXY: "localhost,127.0.0.1",
      NODE_USE_ENV_PROXY: "1",
      PENGUIN_HOME: root,
      PENGUIN_WEB_DB: path.join(root, "web.db"),
      HOST: "127.0.0.1",
      PORT: "0",
      PENGUIN_PORT_FILE: portFile,
      PENGUIN_SEED_ADMIN_PASSWORD: "test-local-state",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_COMMITTER_NAME: "Configured Committer",
    },
  });
  let log = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => (log = (log + chunk.toString()).slice(-8000)));
  const exited = once(child, "exit");
  try {
    let port;
    for (let i = 0; i < 300 && child.exitCode === null; i++) {
      const text = await fs.readFile(portFile, "utf8").catch(() => null);
      if (text) {
        port = Number(text.trim());
        break;
      }
      await delay(100);
    }
    assert(port, "packaged server did not announce its port: " + log);
    const base = `http://localhost:${port}`;
    let cookie;
    async function request(route, method = "GET", body) {
      const r = await fetch(base + route, {
        method,
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (r.headers.has("set-cookie"))
        cookie = r.headers
          .getSetCookie()
          .map((v) => v.split(";")[0])
          .join("; ");
      const content = await r.text();
      assert(r.ok, `${method} ${route}: ${r.status} ${content.slice(0, 400)}`);
      return content ? JSON.parse(content) : {};
    }
    await request("/api/auth/login", "POST", { userId: "admin", password: "test-local-state" });
    const project = (await request("/api/projects")).projects[0].projectId;
    const agent = "state_check";
    await request(`/api/projects/${project}/agents`, "POST", { agentId: agent });
    const folder = path.join(
      root,
      project,
      "agents",
      agent,
      "agent_state",
      "workbenches",
      "history-check",
    );
    await fs.mkdir(path.dirname(folder), { recursive: true });
    await fs.cp(
      path.resolve(import.meta.dirname, "../plugins/penguin-support/workbenches/support"),
      folder,
      { recursive: true },
    );
    const file = path.join(folder, "ui", "会议 notes.txt"),
      route = `/api/projects/${project}/agents/${agent}/workbenches/history-check`;
    async function save(value) {
      await fs.writeFile(file, value);
      const { workbench } = await request(route + "/reload", "POST");
      assert.equal(workbench.error, null);
      return workbench.revision;
    }
    const first = await save("first"),
      second = await save("second");
    assert.notEqual(first, second);
    const history = async () => (await request(route + "/history")).versions;
    assert.deepEqual(
      (await history()).slice(0, 2).map((v) => v.revision),
      [second, first],
    );
    // Read the commit object directly: the verifier needs no Git on PATH either.
    const bare = path.join(root, project, "agents", agent, "agent_state.git");
    const ref = (await fs.readFile(path.join(bare, "HEAD"), "utf8")).trim().replace(/^ref: /, "");
    const oid = (await fs.readFile(path.join(bare, ref), "utf8")).trim();
    const commit = inflateSync(
      await fs.readFile(path.join(bare, "objects", oid.slice(0, 2), oid.slice(2))),
    ).toString();
    assert.match(commit, /\nauthor Offline Author <off@example\.test> /);
    assert.match(commit, /\ncommitter Configured Committer <off@example\.test> /);
    assert.equal(await fs.readFile(config, "utf8"), originalConfig);
    const restored = (await request(route + "/rollback", "POST", { revision: first })).workbench;
    assert.equal(restored.revision, first);
    assert.equal(await fs.readFile(file, "utf8"), "first");
    await request(route, "DELETE");
    assert.deepEqual(await history(), []);
    await assert.rejects(fs.stat(file), { code: "ENOENT" });
    await assert.rejects(fs.stat(fake), { code: "ENOENT" });
    console.log(
      `[agent-state-git] ${process.platform}-${process.arch}: saved two revisions, restored and deleted through the packaged API without system Git.`,
    );
  } catch (err) {
    console.error(log);
    throw err;
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await exited;
    }
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await checkAgentStateGit(
    path.resolve(process.argv[2] ?? "packages/server/dist/index.js"),
    process.argv.slice(3),
  );
}
