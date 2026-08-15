/**
 * Test fixture: a minimal platform exercising the generic dispatch route
 * (POST /api/hmr/platform/call) — a normal call, a call that throws, and a
 * call whose result isn't JSON-serializable. Standalone (no kernel/arktype
 * imports), same zero-dependency style as platform-next.bundle.mjs. Exports
 * only `hotPlatform` — see that fixture's doc for why the cli artifact is a
 * separate push, not part of this file.
 */
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

const platformIface = {
  kind: "iface",
  name: "platform",
  version: 1,
  context: objectSchema({ motd: "string" }),
  methods: ["park", "info", "echo", "boom", "fireAndForget", "notJson"],
  children: {},
  migrations: {},
};

const platformImpl = {
  create(_ctx, context) {
    return {
      park: () => ({ motd: context.motd }),
      info: () => ({ impl: "dispatch-fixture", motd: context.motd }),
      // Proves args round-trip and a normal result serializes.
      echo: (x) => ({ got: x }),
      // Proves a thrown error surfaces as a call failure, not a crash.
      boom: () => {
        throw new Error("boom");
      },
      // Proves a void method (side effect only, no return value) reads as
      // success with a null result, not as an error.
      fireAndForget: () => undefined,
      // Proves a genuinely non-JSON-serializable result is rejected rather
      // than silently coerced (JSON.stringify of a bare function is
      // `undefined`, not a string).
      notJson: () => () => {},
    };
  },
};

export const hotPlatform = { id: "dispatch-fixture", iface: platformIface, impl: platformImpl };
