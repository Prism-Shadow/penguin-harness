/**
 * A local npm registry for the built-in agent tests: serves one package version's metadata and
 * its tarball, holding a stub program that answers --version and otherwise runs the fake ACP
 * agent. Never touches the real registry.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as tar from "tar";

const AGENT_MAIN = fileURLToPath(new URL("../coding-agents-agent.mjs", import.meta.url));

export interface FakeRegistry {
  url: string;
  requests: string[];
  close(): Promise<void>;
}

export async function fakeRegistry(opts: {
  packageName: string;
  version: string;
  /** Serve a tarball whose bytes do not match the published integrity. */
  corrupt?: boolean;
  /** Close the connection halfway through the tarball. */
  truncate?: boolean;
  /** Hold the tarball response until this resolves. */
  hold?: Promise<void>;
  /** The stub's `--version` exits non-zero instead of reporting a version. */
  failVersion?: boolean;
  /** The stub's `--version` line also prints this environment variable's value. */
  echoEnv?: string;
}): Promise<FakeRegistry> {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "builtin-registry-"));
  const pkg = path.join(work, "package");
  await fs.mkdir(pkg);
  const win = process.platform === "win32";
  const program = win ? "copilot.cmd" : "copilot";
  await fs.writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({
      name: opts.packageName,
      version: opts.version,
      exports: { ".": `./${program}` },
    }),
  );
  const winEcho = opts.echoEnv !== undefined ? ` [%${opts.echoEnv}%]` : "";
  const posixEcho = opts.echoEnv !== undefined ? ` [$${opts.echoEnv}]` : "";
  const winVersionBranch = opts.failVersion ? "exit /b 1" : `echo 1.0.0-test${winEcho}& exit /b 0`;
  const posixVersionBranch = opts.failVersion ? "exit 1" : `echo "1.0.0-test${posixEcho}"; exit 0`;
  await fs.writeFile(
    path.join(pkg, program),
    win
      ? `@echo off\r\nif "%~1"=="--version" (${winVersionBranch})\r\n"${process.execPath}" "${AGENT_MAIN}" %*\r\n`
      : `#!/bin/sh\nif [ "$1" = "--version" ]; then ${posixVersionBranch}; fi\nexec "${process.execPath}" "${AGENT_MAIN}" "$@"\n`,
    { mode: 0o755 },
  );
  const tgz = path.join(work, "pkg.tgz");
  await tar.create({ gzip: true, file: tgz, cwd: work, portable: false }, ["package"]);
  const bytes = await fs.readFile(tgz);
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  const served = opts.corrupt ? Buffer.concat([bytes, Buffer.from("x")]) : bytes;
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url ?? "");
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    if (req.url === `/${opts.packageName}/${opts.version}`) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          version: opts.version,
          dist: { tarball: `${base}/-/tarball.tgz`, integrity },
        }),
      );
      return;
    }
    if (req.url === "/-/tarball.tgz") {
      void (async () => {
        await opts.hold;
        res.setHeader("content-length", String(served.length));
        if (opts.truncate) {
          res.write(served.subarray(0, served.length >> 1));
          res.destroy();
          return;
        }
        res.end(served);
      })();
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(work, { recursive: true, force: true });
    },
  };
}
