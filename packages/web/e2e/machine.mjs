/**
 * e2e helper: a hub and one connected machine on this box, for specs about what the Web App does
 * through the hub's `/server/<machineId>/` proxy.
 *
 * Both are real servers from this checkout's build, each on a temp data root of its own, and the
 * hub reaches the machine the way it reaches any machine: one `ssh` session whose shell runs the
 * machine's commands and whose `-D` port carries every connection to it. Only two things stand
 * in for a real remote:
 *
 * - `ssh` itself. The hub finds a small script of that name first on its PATH; it runs `/bin/sh`
 *   with the machine's HOME and answers SOCKS5 on the `-D` port, which is all the hub asks of an
 *   ssh session. No sshd, no keys, and the account's own `~/.ssh` and `~/.penguin` are never
 *   touched (the hub's HOME is a temp directory holding the one `Host` entry).
 * - The install. A hub run from a checkout has no release to install, so the machine's program
 *   directory is laid out by hand (the bundled runtime as a link to this Node, the CLI entry as
 *   an import of this checkout's CLI), its server is started here, and the hub's record that it
 *   installed there is written into its database. Connecting is then the hub's own job: probe,
 *   hold the session, mint a token over there, hand over the Model config.
 *
 * The spec owns the processes: `stop()` ends both servers and removes the temp directory.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { request } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD } from "./auth.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SERVER_ENTRY = path.join(ROOT, "packages/server/dist/index.js");
const CLI_ENTRY = path.join(ROOT, "packages/cli/dist/penguin.js");
const WEB_DIST = path.join(ROOT, "packages/web/dist");
const ALIAS = "e2e-machine";
const ADDRESS = `ssh:${ALIAS}`;
/** What the hub's record says it installed; only compared against, never run. */
const VERSION = "0.0.0-e2e";

/** `ssh`, as far as the hub can tell: a shell on the machine, and SOCKS5 on the `-D` port. */
const FAKE_SSH = `#!/usr/bin/env node
const net = require("node:net");
const { spawn } = require("node:child_process");
const home = process.env.PENGUIN_E2E_MACHINE_HOME;
let socksPort = null;
const words = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "-D") socksPort = Number(args[++i].split(":").pop());
  else if (args[i] === "-o") i++;
  else if (!args[i].startsWith("-")) words.push(args[i]);
}
const command = words[1];
// A clean environment: the hub's own PENGUIN_* would make the machine answer as the hub.
const env = { PATH: process.env.PATH, HOME: home, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
const run = () => {
  const shell = spawn("/bin/sh", command === "sh" ? [] : ["-c", command], {
    cwd: home,
    env,
    stdio: "inherit",
  });
  shell.on("exit", (code) => process.exit(code ?? 255));
};
if (socksPort === null) run();
else {
  // Just enough SOCKS5 to answer a CONNECT to an IPv4 address: greet, connect, pipe.
  net
    .createServer((client) => {
      let stage = 0;
      let buffer = Buffer.alloc(0);
      client.on("error", () => {});
      client.on("data", (chunk) => {
        if (stage === 2) return;
        buffer = Buffer.concat([buffer, chunk]);
        if (stage === 0) {
          if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
          buffer = buffer.subarray(2 + buffer[1]);
          stage = 1;
          client.write(Buffer.from([5, 0]));
        }
        if (stage === 1) {
          if (buffer.length < 10) return;
          stage = 2;
          const port = buffer.readUInt16BE(8);
          const rest = buffer.subarray(10);
          const upstream = net.connect({ host: "127.0.0.1", port }, () => {
            client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
            if (rest.length > 0) upstream.write(rest);
            client.pipe(upstream).pipe(client);
          });
          upstream.on("error", () => client.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])));
        }
      });
    })
    .listen(socksPort, "127.0.0.1", run);
}
`;

async function waitFor(what, probe, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (err) {
      last = err;
    }
    if (Date.now() > deadline)
      throw new Error(`${what} did not happen in time${last ? `: ${last}` : ""}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** A server of this checkout on `port` and `dataRoot`, with nothing inherited but PATH. */
function startServer({ port, dataRoot, home, extraEnv = {}, logFile }) {
  const log = fs.openSync(logFile, "a");
  return spawn(process.execPath, [SERVER_ENTRY], {
    cwd: home,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PENGUIN_HOME: dataRoot,
      PORT: String(port),
      HOST: "127.0.0.1",
      PENGUIN_SEED_ADMIN_PASSWORD: ADMIN_PASSWORD,
      ...extraEnv,
    },
    stdio: ["ignore", log, log],
  });
}

/**
 * Starts a hub and a machine and connects them. `model` is the Project's Model config (PUT
 * /models), handed to the machine as part of connecting.
 *
 * Answers the hub's address, the Project, the machine's id as the proxy names it, an admin
 * request context signed in to the hub, and `stop`.
 */
export async function startHubWithMachine({ hubPort, machinePort, model }) {
  for (const built of [SERVER_ENTRY, CLI_ENTRY, path.join(WEB_DIST, "index.html")]) {
    if (!fs.existsSync(built))
      throw new Error(`${built} is missing: build server, cli and web first`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-e2e-machine-"));
  const machineHome = path.join(dir, "machine-home");
  const hubHome = path.join(dir, "hub-home");
  const hubData = path.join(dir, "hub-data");
  const bin = path.join(dir, "bin");
  const program = path.join(machineHome, ".penguin");
  for (const made of [
    `${program}/node/bin`,
    `${program}/lib/dist`,
    `${hubHome}/.ssh`,
    hubData,
    bin,
  ]) {
    fs.mkdirSync(made, { recursive: true });
  }
  fs.symlinkSync(process.execPath, `${program}/node/bin/node`);
  fs.writeFileSync(`${program}/lib/package.json`, JSON.stringify({ version: VERSION }));
  fs.writeFileSync(`${program}/lib/dist/penguin-hmr.js`, `import ${JSON.stringify(CLI_ENTRY)};\n`);
  fs.writeFileSync(`${program}/lib/dist/package.json`, JSON.stringify({ type: "module" }));
  fs.writeFileSync(`${hubHome}/.ssh/config`, `Host ${ALIAS}\n  HostName 127.0.0.1\n`);
  fs.writeFileSync(`${bin}/ssh`, FAKE_SSH, { mode: 0o755 });

  const servers = [
    startServer({
      port: machinePort,
      dataRoot: `${program}/data`,
      home: machineHome,
      logFile: path.join(dir, "machine.log"),
    }),
    startServer({
      port: hubPort,
      dataRoot: hubData,
      home: hubHome,
      extraEnv: {
        PATH: `${bin}:${process.env.PATH}`,
        PENGUIN_WEB_DIST: WEB_DIST,
        PENGUIN_E2E_MACHINE_HOME: machineHome,
      },
      logFile: path.join(dir, "hub.log"),
    }),
  ];
  const stop = async () => {
    for (const server of servers) server.kill();
    await Promise.all(
      servers.map((server) =>
        server.exitCode !== null ? null : new Promise((resolve) => server.once("exit", resolve)),
      ),
    );
    fs.rmSync(dir, { recursive: true, force: true });
  };

  try {
    const base = `http://localhost:${hubPort}`;
    // Any answer at all: the server is listening.
    const up = (port) => fetch(`http://localhost:${port}/api/me`).then(() => true);
    await waitFor("the machine's server starting", () => up(machinePort));
    await waitFor("the hub starting", () => up(hubPort));

    const admin = await request.newContext({ baseURL: base });
    const signedIn = await admin.post("/api/auth/login", {
      data: { userId: ADMIN_ID, password: ADMIN_PASSWORD },
    });
    if (!signedIn.ok()) throw new Error(`hub login failed: ${await signedIn.text()}`);
    const projectId = (await (await admin.get("/api/projects")).json()).projects[0].projectId;
    const models = await admin.put(`/api/projects/${projectId}/models`, { data: model });
    if (!models.ok()) throw new Error(`hub models failed: ${await models.text()}`);

    // The record an install would have left: the hub installed there, and the Project uses it.
    const db = new DatabaseSync(path.join(hubData, "web.db"));
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      db.prepare(
        "INSERT OR REPLACE INTO machines (address, version, installed_at, platform) VALUES (?, ?, ?, 'linux')",
      ).run(ADDRESS, VERSION, new Date().toISOString());
      db.prepare(
        "INSERT OR REPLACE INTO machine_project (project_id, addresses) VALUES (?, ?)",
      ).run(projectId, JSON.stringify([ADDRESS]));
    } finally {
      db.close();
    }

    const machinesPath = `/api/projects/${projectId}/machines`;
    const connect = await admin.post(`${machinesPath}/${encodeURIComponent(ADDRESS)}/connect`);
    if (!connect.ok())
      throw new Error(`connect refused: ${connect.status()} ${await connect.text()}`);
    const machineId = await waitFor(
      "the machine connecting",
      async () => {
        const listing = await (await admin.get(machinesPath)).json();
        const failed = (listing.jobs ?? []).find((job) => job.result && job.result.ok === false);
        if (failed) throw new Error(`connect failed: ${JSON.stringify(failed.result)}`);
        const machine = listing.machines.find((entry) => entry.id === ADDRESS);
        return machine?.connection && machine.machineId ? machine.machineId : null;
      },
      60_000,
    );
    await waitFor("the proxy answering", async () =>
      (await admin.get(`/server/${machineId}/api/projects`)).ok(),
    );
    return { base, projectId, machineId, admin, logs: dir, stop };
  } catch (err) {
    const tail = (name) => {
      try {
        return fs.readFileSync(path.join(dir, name), "utf8").split("\n").slice(-25).join("\n");
      } catch {
        return "";
      }
    };
    const logs = `--- hub.log ---\n${tail("hub.log")}\n--- machine.log ---\n${tail("machine.log")}`;
    await stop();
    throw new Error(`${err instanceof Error ? err.message : err}\n${logs}`);
  }
}
