/**
 * A prebuilt single-file platform bundle — the layer-(a) artifact in its
 * purest form: ZERO imports (not even the kernel, not even node builtins).
 * Loading it needs nothing installed: no git, no compiler, no packages, and
 * it works from any path on disk.
 *
 * This is possible because the kernel contracts are pure data + closures: a
 * compiled artifact carries its own minimal schema implementations and plain
 * iface descriptor objects, and the host kernel walks them structurally.
 * (A real distro build would produce exactly this shape via `esbuild
 * --bundle`; this file is the hand-written equivalent, kept small.)
 *
 * Accepts a platform@2 parked document (migration 2→3 fills `channel`).
 * Demo limitation: it does not host live children — restoring a document
 * with terminals/agents in it is out of this artifact's scope.
 */

const ok = (value) => ({ ok: true, value });
const fail = (p) => ({
  ok: false,
  dropped: p.dropped ?? [],
  missing: p.missing ?? [],
  invalid: p.invalid ?? [],
});

/** Minimal strict object schema: fields map name → typeof-kind ("json" = any). */
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
        if (value === undefined) {
          missing.push(`${path}.${name}`);
          continue;
        }
        if (kind !== "json" && typeof value !== kind) {
          invalid.push(`${path}.${name}: expected ${kind}`);
        }
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

// Child ifaces redeclared as data so a v2 parked document's (empty) child
// collections reconcile; the stub impls make the no-live-children limitation
// loud instead of silent.
const terminalIface = {
  kind: "iface",
  name: "terminal",
  version: 2,
  context: objectSchema({ procId: "string", command: "string", cwd: "string", title: "string" }),
  methods: ["park", "write", "read", "alive", "lost", "title"],
  children: {},
  migrations: { 1: (old) => ({ ...old, title: old.command }) },
};

const agentSlotIface = {
  kind: "iface",
  name: "agent-slot",
  version: 1,
  context: objectSchema({ module: "string", rev: "number", state: "json" }),
  methods: ["park", "run", "describe"],
  children: {},
  migrations: {},
};

const stubChildImpl = {
  create() {
    throw new Error("the v4 demo bundle does not host live children");
  },
};

const platformIface = {
  kind: "iface",
  name: "platform",
  version: 3,
  context: objectSchema({ motd: "string", theme: "string", channel: "string" }),
  methods: ["park", "info"],
  children: {
    terminals: { kind: "keyed", iface: terminalIface },
    agents: { kind: "keyed", iface: agentSlotIface },
  },
  migrations: { 2: (old) => ({ ...old, channel: "stable" }) },
};

const platformImpl = {
  children: { terminals: stubChildImpl, agents: stubChildImpl },
  create(_ctx, context) {
    return {
      park: () => ({ motd: context.motd, theme: context.theme, channel: context.channel }),
      info: () => ({
        impl: "v4-bundle",
        ifaceVersion: platformIface.version,
        motd: context.motd,
        theme: context.theme,
        channel: context.channel,
      }),
    };
  },
};

export const hotPlatform = { id: "v4-bundle", iface: platformIface, impl: platformImpl };
