/**
 * What a container machine IS, as a person defines it: pure, so every refusal is unit-visible.
 *
 * A definition is kept by the host (machine_definitions), keyed by `docker:<name>`; this file
 * checks it and reads it back. Two modes, exactly one of them:
 *
 *   container   an existing container, by name or id — the plugin starts it when a person
 *               connects and it is stopped, and never removes it
 *   image       a container this plugin creates, `penguin-<name>`, labelled
 *               `penguin.machine=<name>`, from the image with the run arguments passed through
 *               as argv items (never a shell) and a keep-alive command (default
 *               `sleep infinity`)
 *
 * The run arguments may carry anything the CLI takes — `-p`, `-v`, `--network`, `--gpus`,
 * `--env` — except what would fight the plugin: `--rm` (the container would take the installed
 * server with it the moment it stops), `--name` (the plugin names it), `-d` / `--detach`
 * (`create` never attaches anyway).
 *
 * The CLI is `docker` by default; `podman`, `nerdctl` or an absolute path serve the same, since
 * only the subcommands all of them share are used: inspect, create, start, exec -i [-u], cp.
 */
import path from "node:path";
import type { MachineDefinition, MachineForm } from "@prismshadow/penguin-server/plugin";

export interface DockerSpec {
  cli: string;
  /** An existing container (name or id); absent in image mode. */
  container?: string;
  /** The image to create the container from; absent in container mode. */
  image?: string;
  runArgs: string[];
  /** The created container's keep-alive command, as argv. */
  command: string[];
  /** The account commands run as inside; empty for the image's own. */
  user: string;
}

/** A definition's name: what `docker:<name>` and `penguin-<name>` are made of. */
export const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

const DEFAULT_COMMAND = ["sleep", "infinity"];

/** The run arguments this plugin will not pass on, and why each would break the machine. */
const REFUSED_ARGS: { match: (arg: string) => boolean; why: string }[] = [
  {
    match: (a) => a === "--rm",
    why: "--rm would remove the container, and the server installed in it, the moment it stops",
  },
  {
    match: (a) => a === "--name" || a.startsWith("--name="),
    why: "--name is chosen by the plugin (penguin-<name>)",
  },
  {
    match: (a) => a === "-d" || a === "--detach" || a.startsWith("--detach="),
    why: "-d / --detach is not needed: the container is created, never attached to",
  },
];

export const FORM: MachineForm = {
  name: {
    type: "string",
    title: "Name",
    titleZh: "名称",
    description:
      "Lower-case letters, digits and dashes. The machine is docker:<name>; a created container is penguin-<name>.",
    descriptionZh:
      "小写字母、数字与连字符。机器地址为 docker:<名称>；按镜像创建的容器名为 penguin-<名称>。",
    placeholder: "cuda-box",
    required: true,
    pattern: NAME.source,
    patternErrorMessage: "must be lower-case letters, digits and dashes",
  },
  fields: {
    container: {
      type: "string",
      title: "Existing container",
      titleZh: "已有容器",
      description: "A container's name or id. Leave empty to create one from an image instead.",
      descriptionZh: "容器名或 id。留空则改为按镜像创建。",
      placeholder: "my-dev-container",
    },
    image: {
      type: "string",
      title: "Image",
      titleZh: "镜像",
      description:
        "Create the container from this image (when no existing container is named). It needs sh.",
      descriptionZh: "按此镜像创建容器（未填已有容器时）。镜像里要有 sh。",
      placeholder: "ubuntu:24.04",
    },
    runArgs: {
      type: "list",
      title: "Run arguments",
      titleZh: "运行参数",
      description:
        "Passed to create as they are, one argument per line (-p, -v, --gpus, --env…). Not --rm, --name or -d.",
      descriptionZh:
        "原样传给 create，每行一个参数（-p、-v、--gpus、--env…）。不能用 --rm、--name 或 -d。",
    },
    command: {
      type: "list",
      title: "Keep-alive command",
      titleZh: "保活命令",
      description: "What the created container runs, one argument per line. Empty: sleep infinity.",
      descriptionZh: "创建的容器运行的命令，每行一个参数。留空为 sleep infinity。",
    },
    user: {
      type: "string",
      title: "User",
      titleZh: "用户",
      description: "Run as this account inside the container. Empty: the image's own.",
      descriptionZh: "在容器内以此账户执行。留空为镜像默认账户。",
    },
    cli: {
      type: "string",
      title: "Container CLI",
      titleZh: "容器命令行",
      description: "docker, podman, nerdctl, or an absolute path to one of them.",
      descriptionZh: "docker、podman、nerdctl，或其中之一的绝对路径。",
      default: "docker",
    },
  },
};

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const lines = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split("\n") : [])
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item !== "");

/** A definition checked against the rules above; the spec is what the host stores. */
export function defineDocker(name: string, values: Record<string, unknown>): MachineDefinition {
  if (!NAME.test(name)) {
    return { ok: false, field: "name", message: "must be lower-case letters, digits and dashes" };
  }
  const cli = text(values.cli) || "docker";
  if (!["docker", "podman", "nerdctl"].includes(cli) && !path.isAbsolute(cli)) {
    return {
      ok: false,
      field: "cli",
      message: "must be docker, podman, nerdctl or an absolute path",
    };
  }
  const container = text(values.container);
  const image = text(values.image);
  if (container !== "" && image !== "") {
    return {
      ok: false,
      field: "image",
      message: "name an existing container or an image, not both",
    };
  }
  if (container === "" && image === "") {
    return {
      ok: false,
      field: "container",
      message: "name an existing container, or an image to create one from",
    };
  }
  const runArgs = lines(values.runArgs);
  for (const arg of runArgs) {
    const refused = REFUSED_ARGS.find((rule) => rule.match(arg));
    if (refused !== undefined) return { ok: false, field: "runArgs", message: refused.why };
  }
  if (container !== "" && runArgs.length > 0) {
    return {
      ok: false,
      field: "runArgs",
      message: "run arguments apply to a container created from an image",
    };
  }
  const user = text(values.user);
  if (/\s/.test(user)) return { ok: false, field: "user", message: "must be one word" };
  const command = lines(values.command);
  const spec: DockerSpec = {
    cli,
    ...(container === "" ? { image } : { container }),
    runArgs,
    command: command.length === 0 ? DEFAULT_COMMAND : command,
    user,
  };
  return { ok: true, spec: spec as unknown as Record<string, unknown> };
}

/** A stored spec read back leniently; the check above is what admitted it. */
export function specOf(raw: Record<string, unknown> | null): DockerSpec {
  const r = raw ?? {};
  const container = text(r.container);
  const image = text(r.image);
  return {
    cli: text(r.cli) || "docker",
    ...(container === "" ? {} : { container }),
    ...(image === "" ? {} : { image }),
    runArgs: lines(r.runArgs),
    command: lines(r.command).length === 0 ? DEFAULT_COMMAND : lines(r.command),
    user: text(r.user),
  };
}

/** The spec as the form shows it back. */
export function valuesOf(spec: DockerSpec): Record<string, unknown> {
  return {
    cli: spec.cli,
    container: spec.container ?? "",
    image: spec.image ?? "",
    runArgs: spec.runArgs,
    command: spec.command,
    user: spec.user,
  };
}

/** The container a definition names: the existing one, or the one this plugin creates. */
export function containerOf(name: string, spec: DockerSpec): string {
  return spec.container ?? `penguin-${name}`;
}
