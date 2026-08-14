---
name: hot-skill-authoring
description: Author and install live "hot skills" on the local PenguinHarness hot platform — write a contract-conforming script, install it over the loopback API with the local-agent token, fix it against validator feedback, and verify the registered tool by invoking it.
short_description: Turn a one-sentence request into a live platform tool.
short_description_zh: 把一句话需求变成平台上的可用工具。
preinstall: false
version: 1
updated: 2026-08-14T12:00:00Z
---

# Hot skill authoring

The hot platform can gain new tools at runtime: you write a small "hot skill
script", install it through the local API, and the tool becomes callable
immediately — no rebuild, no restart. Use this skill whenever the user asks to
ADD A RUNNABLE CAPABILITY to the system, e.g. "实现计数器功能", "add a tool
that converts numbers to Roman numerals".

You are the authoring loop: you write the script, the platform's validator
judges it (a 400 response tells you exactly what is wrong), you fix and retry.
Never try to weaken or bypass the validator — conform to it.

## Before you start

If the user's message only invokes this skill without a concrete capability to
build, ask what tool they want (name, input, output, whether it needs to keep
state). When the request is concrete, check the credential first (below); if
it is missing, report that the hot platform is unavailable instead of
improvising.

## 1. Credential

The server publishes a local-agent credential at
`$PENGUIN_HOME/hot/api.json` (fallback `~/.penguin/hot/api.json`), containing
`{ "url": "http://127.0.0.1:<port>", "token": "<hex>" }`. It is regenerated on
every server boot.

```bash
HOT_FILE="${PENGUIN_HOME:-$HOME/.penguin}/hot/api.json"
[ -r "$HOT_FILE" ] && echo ok || echo missing
HOT_URL=$(python3 -c "import json;print(json.load(open('$HOT_FILE'))['url'])")
HOT_TOKEN=$(python3 -c "import json;print(json.load(open('$HOT_FILE'))['token'])")
```

If the file is missing, the server is not running (or you are not on the
server machine): say so to the user and stop — do not guess tokens.

## 2. The script contract

A hot skill script is the BODY of a strict-mode JavaScript function receiving
one argument named `context` (`context.state` is your previously saved state,
or null on first install). It must RETURN an object:

- `name`: non-empty string
- `version`: number
- `setup`: `function(ctx)` — call `ctx.registerTool({ name, description, run })`
  for each tool; `run` receives one JSON input argument and returns a JSON
  result.
- `park` (optional): `function()` returning your serializable state (it rides
  across reloads and platform upgrades).

No `import`/`require`/`await`. No code outside the function body. Keep tool
names unique and descriptive — duplicate names are rejected loudly.

Example (a stateful counter):

```js
let count = context.state && typeof context.state.count === "number" ? context.state.count : 0;
return {
  name: "counter",
  version: 1,
  setup(ctx) {
    ctx.registerTool({
      name: "count",
      description: "Increments and returns the running count.",
      run: () => ({ count: ++count }),
    });
  },
  park: () => ({ count }),
};
```

## 3. Install, verify, iterate

Write the script to a file, JSON-encode it, and install:

```bash
cat > /tmp/skill.js <<'SCRIPT'
...your script...
SCRIPT
python3 - <<'PY' > /tmp/skill.json
import json
print(json.dumps({"id": "counter", "script": open("/tmp/skill.js").read()}))
PY
curl -s -X POST -H "Authorization: Bearer $HOT_TOKEN" -H "content-type: application/json" \
  -d @/tmp/skill.json "$HOT_URL/api/hot/skills"
```

- `201` → installed; the response lists the registered tools.
- `400` → the validator rejected it; `error.message` is the exact verdict
  (parse error, missing contract field, duplicate tool name…). Fix the script
  and retry. Do not retry more than 3 times — after that, show the user the
  last script and the verdict.

Always verify before reporting success:

```bash
curl -s -X POST -H "Authorization: Bearer $HOT_TOKEN" -H "content-type: application/json" \
  -d '{"input": {}}' "$HOT_URL/api/hot/tools/count/invoke"
```

Check the result is actually correct for a case you can compute yourself.
Then tell the user the tool name and one example invocation.

## 4. Maintenance endpoints

- `GET /api/hot/skills` — installed skills; `GET /api/hot/tools` — live tools.
- `POST /api/hot/skills/<id>/reload` body `{"script": "..."}` — hot-swap the
  code; the parked state rides across (this is how you upgrade a skill
  without losing its data).
- `DELETE /api/hot/skills/<id>` — unload; its tools deregister automatically.

## Notes

- The hot APIs are loopback-only by default (403 on exposed binds without
  HTTPS) — this skill works on the server machine.
- State discipline: anything worth keeping goes through `park()`/`context.state`;
  everything else is rebuilt on reload. Never stash state in globals.
