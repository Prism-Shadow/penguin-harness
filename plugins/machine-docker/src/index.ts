/**
 * @prismshadow/penguin-plugin-machine-docker — the container machine KIND: a container is a
 * machine, `docker:<name>`, defined by a person on the Machines page and reached through the
 * container CLI (docker, podman, nerdctl).
 *
 * A PLUGIN PACKAGE, not part of the platform: a Project enables it on the Plugins page. It
 * compiles against `@prismshadow/penguin-server/plugin` (types only) and contributes to
 * `MachinesModule.kinds`. Its definitions are kept by the host (machine_definitions), so the
 * plugin keeps no file of its own; definition.ts says what one may hold.
 *
 *   ready    the container brought to running: an existing one started when stopped; an image
 *            one created (`penguin-<name>`, labelled `penguin.machine=<name>`) when absent, then
 *            started. Only for what a PERSON asked — the host's automatic re-hold never calls it,
 *            so a container someone stopped stays stopped until someone connects
 *   launch   `<cli> exec -i [-u <user>] <container> sh` — the host holds it and frames its
 *            commands exactly as for ssh, so installer, store, probe and token all work as they are
 *   dial     a bridge (bridge.ts) through `<cli> exec -i`, whatever the network mode: no
 *            published port, no route to the container's address
 *   copyTo   `<cli> cp`
 *   forwards none: this kind has no port forwarding, and says so (`forwards()` is null)
 *
 * NEVER REMOVED. Forgetting a definition removes its row on the host; the container is left as
 * it is. A container removed by hand: an existing-container definition answers with the CLI's
 * own "No such container" until it is edited or forgotten; an image definition creates a new one
 * at the next connect — a new filesystem, so the machine reads as not installed, and its id is new.
 *
 * ONE CONNECTION, in the sense that matters: the host holds one `exec … sh` per container and
 * judges liveness by it alone. Not in the sense of one process: each dial is a short `exec` of
 * its own, ending with its socket — the price of the bridge.
 */
import { Bind, Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";
import type {
  ExecResult,
  Machine,
  MachineDefinition,
  MachineDial,
  MachineForm,
  MachineForwards,
  MachineKind,
  ShellLaunch,
} from "@prismshadow/penguin-server/plugin";
import type net from "node:net";
import { bridgeArgs, dialViaBridge, runText } from "./bridge.js";
import { FORM, containerOf, defineDocker, specOf, valuesOf } from "./definition.js";
import type { DockerSpec } from "./definition.js";

export { BRIDGE_SCRIPT, bridgeArgs, dialViaBridge } from "./bridge.js";
export { FORM, NAME, containerOf, defineDocker, specOf, valuesOf } from "./definition.js";
export type { DockerSpec } from "./definition.js";

/** The CLI's last line of complaint, or a fallback naming the exit. */
const said = (result: ExecResult, what: string): string =>
  result.stderr.trim().split("\n").pop()?.trim() ||
  result.stdout.trim().split("\n").pop()?.trim() ||
  `${what} exited ${result.code}`;

export class DockerMachine implements Machine {
  readonly #spec: DockerSpec;
  readonly #container: string;

  constructor(
    readonly name: string,
    spec: DockerSpec,
  ) {
    this.#spec = spec;
    this.#container = containerOf(name, spec);
  }

  /** `exec -i [-u <user>] <container>` — every way into the container starts here. */
  #exec(): string[] {
    return [
      "exec",
      "-i",
      ...(this.#spec.user === "" ? [] : ["-u", this.#spec.user]),
      this.#container,
    ];
  }

  #cli(args: string[], opts: { input?: Buffer; timeoutMs?: number } = {}): Promise<ExecResult> {
    return runText(this.#spec.cli, args, opts);
  }

  async launch(): Promise<ShellLaunch> {
    return { program: this.#spec.cli, args: [...this.#exec(), "sh"] };
  }

  async up(): Promise<void> {}

  async ready(): Promise<{ ok: true } | { ok: false; detail: string }> {
    const cli = this.#spec.cli;
    const inspected = await this.#cli(
      ["inspect", "--format", "{{.State.Running}}", this.#container],
      { timeoutMs: 30_000 },
    );
    if (inspected.code !== 0) {
      // Absent. An existing-container definition says so in the CLI's words; an image one
      // creates it — what "defined from an image" means.
      if (this.#spec.image === undefined)
        return { ok: false, detail: said(inspected, `${cli} inspect`) };
      const created = await this.#cli(
        [
          "create",
          "--name",
          this.#container,
          "--label",
          `penguin.machine=${this.name}`,
          ...this.#spec.runArgs,
          this.#spec.image,
          ...this.#spec.command,
        ],
        { timeoutMs: 10 * 60_000 },
      );
      if (created.code !== 0) return { ok: false, detail: said(created, `${cli} create`) };
    } else if (inspected.stdout.trim() === "true") {
      return { ok: true };
    }
    const started = await this.#cli(["start", this.#container], { timeoutMs: 60_000 });
    return started.code === 0 ? { ok: true } : { ok: false, detail: said(started, `${cli} start`) };
  }

  dial(port: number, via: MachineDial): Promise<net.Socket> {
    return dialViaBridge(this.#spec.cli, [...this.#exec(), ...bridgeArgs(via.node, port)]);
  }

  oneShot(command: string, opts: { timeoutMs?: number; input?: Buffer }): Promise<ExecResult> {
    return this.#cli([...this.#exec(), "sh", "-c", command], {
      ...(opts.input === undefined ? {} : { input: opts.input }),
      ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
    });
  }

  async copyTo(localFiles: string[], remoteDir: string): Promise<ExecResult> {
    for (const file of localFiles) {
      const result = await this.#cli(["cp", file, `${this.#container}:${remoteDir}`]);
      if (result.code !== 0) return result;
    }
    return { code: 0, stdout: "", stderr: "", timedOut: false };
  }

  /** The two walls a person can do something about: the daemon, and the socket's permissions. */
  diagnose(result: ExecResult): string | null {
    const text = `${result.stderr}\n${result.stdout}`;
    if (/cannot connect to the docker daemon/i.test(text)) {
      return "The container runtime is not running on this server: start it, then connect again.";
    }
    if (/permission denied.*docker\.sock/i.test(text)) {
      return "The server's account may not use the container runtime: add it to the docker group, or use rootless podman.";
    }
    return null;
  }

  /** This kind has no port forwarding. */
  forwards(): MachineForwards | null {
    return null;
  }
}

/** The container kind: machines a person defined; nothing is discovered. */
export class DockerKind implements MachineKind {
  /** Containers on a host are mostly services, not machines: only a definition makes one. */
  discover(): string[] {
    return [];
  }

  form(): MachineForm {
    return FORM;
  }

  async define(name: string, values: Record<string, unknown>): Promise<MachineDefinition> {
    return defineDocker(name, values);
  }

  read(
    _name: string,
    spec: Record<string, unknown> | null,
  ): { values: Record<string, unknown>; editable: boolean } | null {
    return spec === null ? null : { values: valuesOf(specOf(spec)), editable: true };
  }

  connect(name: string, spec: Record<string, unknown> | null): Machine {
    return new DockerMachine(name, specOf(spec));
  }
}

@Component({
  contributes: {
    "WebModule.quickStarts": [
      {
        id: "machine-docker.quick-start",
        prompt:
          "List the containers on this machine with `docker ps -a --format '{{.Names}}\\t{{.Image}}\\t{{.Status}}'` (or podman, if docker is not installed), then for each running one check `docker exec <name> sh -c 'echo ok'`. Report a table: name, image, status, whether it has sh — a container needs sh to become a machine on the Machines page.",
        promptZh:
          "用 `docker ps -a --format '{{.Names}}\\t{{.Image}}\\t{{.Status}}'` 列出这台机器上的容器（没有 docker 就用 podman），再对每个运行中的容器执行 `docker exec <名称> sh -c 'echo ok'`。用表格报告：名称、镜像、状态、是否有 sh——容器要有 sh 才能在机器页上成为机器。",
      },
    ],
    "MachinesModule.kinds": [
      { id: "machine-docker.kind", kind: "docker", title: "Container", titleZh: "容器" },
    ],
  },
})
export class MachineDocker {
  @Bind("machine-docker.kind") kind!: MachineKind;

  setup() {
    this.kind = new DockerKind();
  }
}

const plugin: Plugin = { modules: [MachineDocker] };
export default plugin;
