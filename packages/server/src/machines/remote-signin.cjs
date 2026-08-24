/**
 * Mints a session ON a remote machine, under that machine's own Node.
 *
 * The point is what does NOT travel. A machine is a separate server with its own accounts,
 * so reaching its API needs a session there — but obtaining one must not put its password on
 * the wire. Here it does not have to: this script runs on that machine, reads its OWN seeded
 * admin password off its OWN disk, and logs in over 127.0.0.1. What comes back across ssh is
 * the Set-Cookie line the server issued — a session token, not a password: short-lived,
 * revocable, and exactly what a person typing the password into the browser would have got.
 *
 * No escalation either: whoever can run this already has ssh to that machine and can read
 * its whole data root, password file included. This spends that access rather than widening
 * it.
 *
 * It is invoked as `<node> <scratch>/remote-signin.cjs`, with no arguments: the job is read
 * from `signin-job.json` beside this file, the same contract the other far-side scripts use.
 */
"use strict";
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const here = __dirname;
const job = JSON.parse(fs.readFileSync(path.join(here, "signin-job.json"), "utf8"));
const say = (line) => process.stdout.write(`${line}\n`);

const OK = "---penguin-signin-ok---";
const FAIL = "---penguin-signin-failed---";

function fail(message) {
  say(FAIL);
  say(message);
  process.exit(0); // A refusal is an ANSWER, not an ssh failure.
}

function main() {
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(path.join(job.dataRoot, "server.lock"), "utf8"));
  } catch {
    return fail("no server is running here");
  }
  if (typeof lock.port !== "number") return fail("this machine's server lock names no port");

  // Present only until somebody changes the admin password, which is the expected state on
  // a machine a person has set up by hand. Its absence is an honest "ask them", not a bug.
  let password;
  try {
    password = fs.readFileSync(path.join(job.dataRoot, "initial-admin-password"), "utf8").trim();
  } catch {
    return fail("this machine's admin password has been changed, so sign in to it by hand");
  }
  if (password === "") return fail("this machine's seeded admin password is empty");

  const body = Buffer.from(JSON.stringify({ userId: job.userId || "admin", password }));
  const req = http.request(
    {
      host: "127.0.0.1",
      port: lock.port,
      path: "/api/auth/login",
      method: "POST",
      // The API answers only under the canonical app host; 127.0.0.1 itself is the preview
      // surface, and a NAME could resolve to a different server on a busy machine.
      headers: {
        host: `localhost:${lock.port}`,
        "content-type": "application/json",
        "content-length": String(body.byteLength),
      },
      timeout: 30000,
    },
    (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          return fail(`this machine's server refused the sign-in: ${res.statusCode}`);
        }
        const setCookie = res.headers["set-cookie"] || [];
        if (setCookie.length === 0) return fail("this machine's server issued no session cookie");
        say(OK);
        // The Set-Cookie lines verbatim: the caller renames them into this machine's
        // namespace exactly as the proxy would, so nothing here has to know that shape.
        for (const line of setCookie) say(String(line));
      });
    },
  );
  req.on("timeout", () => {
    req.destroy();
    fail("this machine's server did not answer in time");
  });
  req.on("error", (err) => fail(String((err && err.message) || err)));
  req.end(body);
}

main();
