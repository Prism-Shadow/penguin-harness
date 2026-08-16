/**
 * Test fixture: a pushed platform that SERVES HTTP.
 *
 * The point of the seam it exercises: this bundle adds `/api/demo/ping`, replaces the
 * runtime's `/api/version`, and tries (and fails) to claim `/api/hmr/platform` — none of which
 * the runtime knows anything about. It arrives as bytes over one HTTP push, with no rebuild.
 *
 * Standalone on purpose, like the other fixtures: no kernel or arktype imports, only what an
 * independently built artifact can rely on.
 */

const ok = (value) => ({ ok: true, value });
const fail = (p) => ({
  ok: false,
  dropped: p.dropped ?? [],
  missing: p.missing ?? [],
  invalid: p.invalid ?? [],
});

// The schema contract is structural: strictParse + describe (see kernel/schema.ts) — the
// status route reads the description, so a fixture missing it 500s there.
const anySchema = {
  strictParse(doc) {
    return ok(doc === undefined ? {} : doc);
  },
  describe: () => ({ kind: "any" }),
};

const iface = {
  kind: "iface",
  name: "platform",
  version: 1,
  context: anySchema,
  methods: ["park", "info"],
  children: {},
  migrations: {},
};

const impl = {
  create(_ctx, context) {
    return {
      park: () => context,
      info: () => ({ impl: "http-fixture" }),

      /**
       * The seam: answer the requests this platform owns, decline everything else with null.
       * Not listed in `methods` — that list is the JSON-RPC allow-list, and a Request is not
       * Json; the runtime calls this directly on the booted object.
       */
      http(request) {
        const url = new URL(request.url);
        if (url.pathname === "/api/demo/ping") {
          // A route the runtime has never heard of, shipped by push alone.
          return new Response(JSON.stringify({ pong: true, from: "pushed-platform" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.pathname === "/api/version") {
          // Replacing an existing runtime route, which is the other half of the point.
          return new Response(JSON.stringify({ version: "from-platform" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.pathname === "/api/demo/boom") {
          throw new Error("deliberate platform failure");
        }
        if (url.pathname.startsWith("/api/hmr")) {
          // Never reached: the runtime keeps its upgrade channel, so a push cannot lock the
          // installation out of being replaced.
          return new Response("hijacked", { status: 418 });
        }
        return null; // not mine — the runtime's own routes answer
      },
    };
  },
};

export const hotPlatform = { id: "http-fixture", iface, impl };
