/**
 * The container kind against a stub container CLI on PATH — one script that plays docker (and,
 * under another name, podman): it keeps each container's state in a file, answers `inspect`,
 * `create`, `start` and `cp` the way the CLI does, and runs `exec` locally, so a container's
 * loopback is this machine's. What is checked is the argv this plugin hands the CLI and how it
 * reads the answers — no real docker, podman or nerdctl ran.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MachineSession } from "@prismshadow/penguin-server/plugin";
import { DockerKind, DockerMachine, defineDocker, specOf } from "../src/index.js";

describe("a definition", () => {
  it("is an existing container or an image, never both, never neither", () => {
    expect(defineDocker("dev", { container: "my-dev" })).toMatchObject({ ok: true });
    expect(defineDocker("cuda", { image: "ubuntu:24.04" })).toMatchObject({ ok: true });
    expect(defineDocker("x", { container: "a", image: "b" })).toMatchObject({
      ok: false,
      field: "image",
    });
    expect(defineDocker("x", {})).toMatchObject({ ok: false, field: "container" });
    expect(defineDocker("Bad Name", { image: "b" })).toMatchObject({ ok: false, field: "name" });
  });

  it("refuses the run arguments that would fight the plugin, naming the field, and passes the rest", () => {
    for (const arg of ["--rm", "--name", "--name=other", "-d", "--detach"]) {
      const refused = defineDocker("cuda", { image: "ubuntu", runArgs: ["--gpus", "all", arg] });
      expect(refused).toMatchObject({ ok: false, field: "runArgs" });
    }
    const passed = defineDocker("cuda", {
      image: "ubuntu",
      runArgs: ["--gpus", "all", "-v", "/data:/data", "-p", "8080:80", "--network", "host"],
    });
    expect(passed).toMatchObject({
      ok: true,
      spec: {
        runArgs: ["--gpus", "all", "-v", "/data:/data", "-p", "8080:80", "--network", "host"],
      },
    });
  });

  it("takes docker, podman, nerdctl or an absolute path as its CLI", () => {
    expect(defineDocker("a", { image: "u", cli: "podman" })).toMatchObject({
      ok: true,
      spec: { cli: "podman" },
    });
    expect(defineDocker("a", { image: "u", cli: "/opt/bin/nerdctl" })).toMatchObject({ ok: true });
    expect(defineDocker("a", { image: "u", cli: "rm -rf" })).toMatchObject({
      ok: false,
      field: "cli",
    });
    expect(new DockerKind().discover()).toEqual([]);
  });
});

const posixOnly = process.platform === "win32" ? describe.skip : describe;

posixOnly("against a stub container CLI", () => {
  let stubBin: string;
  let logFile: string;
  let state: string;
  beforeEach(() => {
    stubBin = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-docker-"));
    logFile = path.join(stubBin, "calls.log");
    state = path.join(stubBin, "state");
    fs.mkdirSync(state);
    const script = `#!/bin/sh
echo "$(basename "$0") $*" >> ${JSON.stringify(logFile)}
S=${JSON.stringify(state)}
cmd=$1; shift
case "$cmd" in
  inspect)
    c=$3
    [ -f "$S/$c" ] || { echo "Error: No such container: $c" >&2; exit 1; }
    cat "$S/$c"; exit 0 ;;
  create)
    while [ "$1" != "--name" ]; do shift; done
    echo false > "$S/$2"; echo created; exit 0 ;;
  start)
    [ -f "$S/$1" ] || { echo "Error: No such container: $1" >&2; exit 1; }
    echo true > "$S/$1"; echo "$1"; exit 0 ;;
  cp)
    exit 0 ;;
  exec)
    shift
    [ "$1" = "-u" ] && shift 2
    c=$1; shift
    [ -f "$S/$c" ] || { echo "Error: No such container: $c" >&2; exit 1; }
    [ "$(cat "$S/$c")" = true ] || { echo "Error response from daemon: container $c is not running" >&2; exit 1; }
    exec "$@" ;;
esac
exit 2
`;
    for (const name of ["docker", "podman"]) {
      fs.writeFileSync(path.join(stubBin, name), script);
      fs.chmodSync(path.join(stubBin, name), 0o755);
    }
  });
  afterEach(() => {
    fs.rmSync(stubBin, { recursive: true, force: true });
  });
  const calls = () =>
    fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n") : [];
  const machine = (name: string, values: Record<string, unknown>) => {
    const defined = defineDocker(name, { cli: path.join(stubBin, "docker"), ...values });
    if (!defined.ok) throw new Error(defined.message);
    return new DockerMachine(name, specOf(defined.spec));
  };
  const cli = (name = "docker") => path.join(stubBin, name);

  it("an existing container: launch is `exec -i [-u] <container> sh`, and ready starts it only when stopped", async () => {
    fs.writeFileSync(path.join(state, "my-dev"), "false\n");
    const dev = machine("dev", { container: "my-dev", user: "k" });
    expect(await dev.launch()).toEqual({
      program: cli(),
      args: ["exec", "-i", "-u", "k", "my-dev", "sh"],
    });
    // launch never starts it: that is ready's, and only for what a person asked.
    expect(calls()).toEqual([]);
    expect(await dev.ready()).toEqual({ ok: true });
    expect(calls()).toEqual([
      `docker inspect --format {{.State.Running}} my-dev`,
      `docker start my-dev`,
    ]);
    expect(await dev.ready()).toEqual({ ok: true });
    expect(calls()).toHaveLength(3); // running: inspected, not started again
  });

  it("an image: ready creates penguin-<name> with the label, the run arguments as given, the image and the keep-alive, then starts it", async () => {
    const cuda = machine("cuda", {
      image: "ubuntu:24.04",
      runArgs: ["--gpus", "all", "-v", "/d:/d"],
    });
    expect(await cuda.ready()).toEqual({ ok: true });
    expect(calls()).toEqual([
      "docker inspect --format {{.State.Running}} penguin-cuda",
      "docker create --name penguin-cuda --label penguin.machine=cuda --gpus all -v /d:/d ubuntu:24.04 sleep infinity",
      "docker start penguin-cuda",
    ]);
  });

  it("with podman as its CLI, every call is podman", async () => {
    const pod = machine("pod", { image: "alpine", cli: cli("podman") });
    await pod.ready();
    await pod.oneShot("true", {});
    await pod.copyTo(["/tmp/x"], "/root");
    expect(calls().every((line) => line.startsWith("podman "))).toBe(true);
    expect(calls().at(-1)).toBe("podman cp /tmp/x penguin-pod:/root");
    expect((await pod.launch()).program).toBe(cli("podman"));
  });

  it("a container removed by hand: ready and the shell both answer the CLI's own 'No such container'", async () => {
    const gone = machine("gone", { container: "vanished" });
    const ready = await gone.ready();
    expect(ready).toEqual({ ok: false, detail: "Error: No such container: vanished" });
    const shell = await gone.oneShot("true", {});
    expect(shell.stderr).toContain("No such container: vanished");
  });

  it("a stopped container: the shell says so in the CLI's words, and ready — not launch — brings it back", async () => {
    fs.writeFileSync(path.join(state, "paused"), "false\n");
    const paused = machine("paused", { container: "paused" });
    expect((await paused.oneShot("true", {})).stderr).toContain("is not running");
    expect(await paused.ready()).toEqual({ ok: true });
    expect((await paused.oneShot("echo up", {})).stdout).toBe("up\n");
  });

  it("dials the container's loopback through `exec -i` and a bridge run by the machine's Node", async () => {
    fs.writeFileSync(path.join(state, "web"), "true\n");
    const web = http.createServer((_req, res) => res.end("ok from the container"));
    await new Promise<void>((resolve) => web.listen(0, "127.0.0.1", resolve));
    try {
      const port = (web.address() as net.AddressInfo).port;
      const box = machine("web", { container: "web" });
      const socket = await box.dial(port, {
        session: {} as MachineSession,
        node: JSON.stringify(process.execPath),
      });
      const answer = await new Promise<string>((resolve) => {
        let text = "";
        socket.on("data", (chunk: Buffer) => (text += String(chunk)));
        socket.on("end", () => resolve(text));
        socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
      });
      expect(answer).toContain("ok from the container");
      // (The logged line is split where the stub's echo reads the script's `\n`.)
      expect(calls().some((line) => line.startsWith("docker exec -i web sh -c "))).toBe(true);
      expect(box.forwards()).toBeNull();
    } finally {
      web.close();
    }
  });
});
