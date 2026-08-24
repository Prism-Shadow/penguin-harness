/**
 * The hot-update applier that runs ON a remote machine, under that machine's own Node.
 *
 * Why it runs over there rather than the pushing side driving HTTP through the tunnel: the
 * upgrade endpoint takes an admin cookie session, so somebody has to log in — and the
 * password must not travel the wire to do it. Here it does not have to. This script reads
 * the machine's OWN seeded admin password off its OWN disk and logs in over 127.0.0.1, so
 * the credential never leaves the host it belongs to. Only the bundle crosses the network,
 * over ssh, and the bundle is not a secret.
 *
 * It is invoked as `<node> <scratch>/remote-upgrade.cjs`, with no arguments: the job is read
 * from `upgrade-job.json` beside this file, so nothing has to survive a shell's quoting
 * rules — the same contract remote-installer.cjs uses.
 *
 * Everything below is plain Node with no dependencies: it runs on whatever Node the install
 * left behind, which may be the machine's own.
 */
"use strict";
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const here = __dirname;
const job = JSON.parse(fs.readFileSync(path.join(here, "upgrade-job.json"), "utf8"));
/**
 * This machine's data root, resolved HERE. The sending side deliberately does not pass a
 * path: it would have to write `$HOME` and have a shell expand it, and getting that quoting
 * wrong fails silently — the literal string becomes a directory that does not exist.
 */
const dataRoot = job.dataRoot || path.join(os.homedir(), ".penguin", "data");
const say = (line) => process.stdout.write(`${line}\n`);

/** Marker lines, so the pushing side reads an outcome rather than parsing prose. */
const OK = "---penguin-upgrade-ok---";
const FAIL = "---penguin-upgrade-failed---";

function fail(message) {
  say(FAIL);
  say(message);
  process.exit(0); // A refusal is an ANSWER, not an ssh failure: exit 0 and say why.
}

/**
 * One request to this machine's own server. 127.0.0.1 with the Host header forced to the
 * canonical app host: the API answers only under that name (127.0.0.1 itself is the preview
 * surface), and a name could resolve to a DIFFERENT server on a machine running several.
 */
function call(port, options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: options.path,
        method: options.method,
        headers: { ...options.headers, host: `localhost:${port}` },
        timeout: options.timeoutMs || 120000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("the local request timed out"));
    });
    req.on("error", reject);
    if (body) req.end(body);
    else req.end();
  });
}

async function main() {
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(path.join(dataRoot, "server.lock"), "utf8"));
  } catch {
    fail("no server is running here (no lock file), so there is nothing to hot-update");
    return;
  }
  if (typeof lock.port !== "number") fail("this machine's server lock names no port");

  // The seeded admin password, which the server keeps in plaintext ONLY until it is
  // changed. Its absence is the expected state on a machine whose admin password was set
  // by a person — and the honest answer there is "I cannot log in", not a guess.
  let password;
  try {
    password = fs.readFileSync(path.join(dataRoot, "initial-admin-password"), "utf8").trim();
  } catch {
    fail(
      "this machine's admin password has been changed, so the seeded one is gone and this " +
        "side cannot authenticate; update it from its own window, or reinstall",
    );
    return;
  }
  if (password === "") fail("this machine's seeded admin password is empty");

  const login = await call(
    lock.port,
    { method: "POST", path: "/api/auth/login", headers: { "content-type": "application/json" } },
    Buffer.from(JSON.stringify({ userId: job.userId || "admin", password })),
  );
  if (login.status !== 200) fail(`could not sign in to this machine's server: ${login.status}`);
  const setCookie = login.headers["set-cookie"] || [];
  const cookie = setCookie.map((c) => String(c).split(";")[0]).join("; ");
  if (cookie === "") fail("this machine's server issued no session cookie");

  const payload = fs.readFileSync(path.join(here, job.payloadName));
  const res = await call(
    lock.port,
    {
      method: "POST",
      path: "/api/hmr/upgrade",
      headers: {
        "content-type": "application/gzip",
        "content-length": String(payload.byteLength),
        cookie,
      },
      timeoutMs: 300000,
    },
    payload,
  );
  if (res.status < 200 || res.status >= 300) {
    fail(`the upgrade was refused: ${res.status} ${res.text.slice(0, 400)}`);
    return;
  }
  say(OK);
  say(res.text.slice(0, 400));
}

main().catch((err) => fail(String((err && err.message) || err)));
