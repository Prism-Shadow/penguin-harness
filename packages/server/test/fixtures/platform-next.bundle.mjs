/**
 * Test fixture: "the NEXT deployed build" as a pushed single-file bundle.
 *
 * This is what a platform version bump actually looks like in the shipped
 * model: the repo always carries ONE platform; a later build (this fixture)
 * arrives as bytes over HTTP, declares iface version 2, and ships the 1→2
 * migrator alongside its new schema. It is intentionally standalone — no
 * kernel/arktype imports, only node builtins — proving the kernel contracts
 * are structural data any independently built artifact can satisfy.
 */
import { spawn } from "node:child_process";

const ok = (value) => ({ ok: true, value });
const fail = (p) => ({
  ok: false,
  dropped: p.dropped ?? [],
  missing: p.missing ?? [],
  invalid: p.invalid ?? [],
});

/** Minimal strict object schema: fields map name → typeof-kind. */
function objectSchema(fields) {
  return {
    strictParse(doc, path = "$") {
      if (doc === undefined) return fail({ missing: [path] });
      if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
        return fail({ invalid: [`${path}: expected object`] });
      }
      const dropped = [];
      const missing = [];
      const invalid = [];
      for (const [name, kind] of Object.entries(fields)) {
        const value = doc[name];
        if (value === undefined) missing.push(`${path}.${name}`);
        else if (typeof value !== kind) invalid.push(`${path}.${name}: expected ${kind}`);
      }
      for (const key of Object.keys(doc)) {
        if (!(key in fields)) dropped.push(`${path}.${key}`);
      }
      return dropped.length > 0 || missing.length > 0 || invalid.length > 0
        ? fail({ dropped, missing, invalid })
        : ok(doc);
    },
    describe: () => ({ kind: "object", fields }),
  };
}

const terminalIface = {
  kind: "iface",
  name: "terminal",
  version: 1,
  context: objectSchema({ procId: "string", command: "string", cwd: "string" }),
  methods: ["park", "write", "read", "alive", "lost"],
  children: {},
  migrations: {},
};

const terminalImpl = {
  create(ctx, context) {
    const res = ctx.resources.claim(context.procId);
    const live = res !== undefined && res.kind === "shell-proc" ? res : undefined;
    return {
      park: () => ({ ...context }),
      write: (data) => live?.write(data),
      read: () => (live === undefined ? "[terminal lost: process not claimable]" : live.read()),
      alive: () => live?.alive() ?? false,
      lost: () => live === undefined,
    };
  },
};

const platformIface = {
  kind: "iface",
  name: "platform",
  version: 2,
  context: objectSchema({ motd: "string", theme: "string" }),
  methods: ["park", "info", "createTerminal", "terminals"],
  children: { terminals: { kind: "keyed", iface: terminalIface } },
  migrations: {
    1: (old) => ({ ...old, theme: "classic" }),
  },
};

const platformImpl = {
  children: { terminals: terminalImpl },
  create(ctx, context, children) {
    const terminals = children.terminals;
    return {
      park: () => ({ motd: context.motd, theme: context.theme }),
      info: () => ({
        impl: "next",
        ifaceVersion: platformIface.version,
        motd: context.motd,
        theme: context.theme,
        terminals: terminals.keys(),
      }),
      async createTerminal(command, cwd) {
        const id = `term_${Math.random().toString(36).slice(2, 10)}`;
        const procId = `proc_${id}`;
        const proc = spawn(command, { shell: true, cwd, stdio: ["pipe", "pipe", "pipe"] });
        const chunks = [];
        let exited = false;
        proc.stdout?.on("data", (d) => chunks.push(d.toString("utf8")));
        proc.stderr?.on("data", (d) => chunks.push(d.toString("utf8")));
        proc.on("exit", () => (exited = true));
        proc.on("error", () => (exited = true));
        ctx.resources.register(procId, {
          kind: "shell-proc",
          proc,
          read: () => chunks.join(""),
          write: (data) => proc.stdin?.write(data),
          alive: () => !exited,
          kill: () => {
            if (!exited) proc.kill();
          },
        });
        await terminals.add(id, { procId, command, cwd });
        return { id };
      },
      terminals: () => terminals,
    };
  },
};

export const hotPlatform = { id: "next", iface: platformIface, impl: platformImpl };
