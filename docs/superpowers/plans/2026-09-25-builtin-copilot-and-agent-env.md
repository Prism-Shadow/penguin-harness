# Built-in GitHub Copilot and Coding-Agent Environment Variables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin can give any coding agent its own environment variables, and can run GitHub Copilot on a pasted PAT with nothing installed on the server machine.

**Architecture:** Part 1 extends the existing `AgentServerDefinition.env` with validation, a Vault-style `PUT …/env` route, masked listing and a card editor. Part 2 adds a `BuiltinAgentsService` that downloads the Copilot CLI's platform package from the npm registry, verifies it, unpacks it under the data root, and registers an ordinary coding-agent definition (`copilot-builtin`, `--acp`) whose `COPILOT_GITHUB_TOKEN` uses Part 1's storage. No new session runtime: the existing ACP path runs it.

**Tech Stack:** TypeScript, Node 24, Hono routes, the penguin-core kernel (`@Component`/`Interface`), `tar` (already a server dependency), undici-backed global `fetch` (already proxy-aware), React + Vitest.

**Spec:** `docs/superpowers/specs/2026-09-25-builtin-copilot-and-agent-env-design.md`

## Global Constraints

- Every user-facing string lives in `packages/web/src/lib/strings-en.ts` with its type in `strings-types.ts`. English only.
- Status colour only via `packages/web/src/lib/tone.ts` (`toneInk`, `toneStrip`); never a palette class for status.
- Controls take `size="sm"`; no `text-*` class on a control. Tab switchers use `Segmented`.
- Stateful server logic lives in a kernel `@Component` service behind an `Interface` class, registered in `packages/server/src/platform.ts`. Run `pnpm gen:ifaces` (repo root) after changing a mechanism interface.
- Env keys: `^[A-Za-z_][A-Za-z0-9_]*$`; values ≤ 8192 characters, no newlines.
- Reserved env keys: the sandbox pass-through list (`PATH PATHEXT SYSTEMROOT WINDIR COMSPEC TEMP TMP HOME USERPROFILE LOCALAPPDATA APPDATA LANG LC_ALL HTTPS_PROXY HTTP_PROXY NO_PROXY SSL_CERT_FILE NODE_EXTRA_CA_CERTS`, case-insensitive), `NO_BROWSER`, and any key starting with `PENGUIN_`.
- Masking: `maskApiKey` from `packages/server/src/services/project-config-service.ts` (`***` up to 12 characters, else `first4…last4`). Real values never leave the server.
- Copilot package: `@github/copilot-<platform>-<arch>`, pinned version `1.0.88`. Platforms: `win32`, `darwin`, `linux`, `linuxmusl` × `x64`, `arm64`.
- Built-in Copilot definition id: `copilot-builtin`; title `GitHub Copilot (built-in)`; args `["--acp"]`; env `COPILOT_GITHUB_TOKEN` and `COPILOT_HOME` (its own config folder under the agent home).
- Runtimes live in `<data root>/runtimes/copilot/<version>/`; temporary folders are `<data root>/runtimes/copilot/.incoming-*`.
- Registry base URL: `process.env.PENGUIN_NPM_REGISTRY ?? "https://registry.npmjs.org"` (also serves corporate mirrors; tests point it at a local server).
- Changelog entries under `changelog/unreleased/`, one per part.
- Known baseline: `packages/web/test/model-grouping.test.ts` fails on main; do not fix it.
- Release blocker for Part 2: the Copilot CLI's `LICENSE.md` permits running and redistributing unmodified copies inside an application with material functionality beyond it; confirm with the user before release and link the license from the card.

## Deviation from the spec (flagged for review)

The spec says the card's Environment editor keeps changes local until **Save**. The Agent Vault tab, which the spec names as the model, saves each add or remove immediately. This plan follows the Vault: add and remove persist at once, with a confirm on overwrite and remove. Fewer states, same pattern users already know.

## Review Focus

1. **A non-admin lists agents** → the response carries no `env` (not even masked values) and no `envPending`. Test in Task 2.
2. **An admin re-saves an agent through Add agent without variables** → the stored `env` survives. Test in Task 2.
3. **Someone saves, or sets env on, `copilot-builtin` through the Local CLI routes** → refused with a message pointing at the Built-in tab, so the built-in token and `COPILOT_HOME` cannot be clobbered. Tests in Task 2.
4. **The download is interrupted, or its checksum does not match** → nothing is swapped in, the previous version keeps working, and no `.incoming-*` folder survives a restart. Tests in Task 5.
5. **Two Set up clicks arrive together** → one download, both callers see the same state. Test in Task 6.

---

## File Structure

**Part 1**
- Modify `packages/coding-agents/src/env.ts`: add `validateAgentEnvEntry`, `isReservedEnvKey`.
- Modify `packages/coding-agents/src/types.ts`: `builtin?: string` on `AgentServerDefinition`; `parseDefinition` passes it through.
- Modify `packages/coding-agents/src/manager.ts`: remember the env each live connection started with; `startedWithOtherEnv(id)`.
- Modify `packages/coding-agents/src/index.ts`: export the new helpers and `spawnTarget`.
- Modify `packages/server/src/api/types.ts`: `CodingAgentEnvEntryInfo`, `CodingAgentEnvRequest`; `env`, `envPending`, `builtin` on `CodingAgentServerInfo`.
- Modify `packages/server/src/mechanisms/coding-agents.ts`: `setAgentEnv`, `saveBuiltinDefinition`, `removeBuiltinDefinition`.
- Modify `packages/server/src/coding-agents/service.ts`: implement the above; `saveAgent` keeps env and refuses built-ins; `listAgents(admin)`.
- Modify `packages/server/src/http/routes/coding-agents.ts`: `PUT /agents/:agentId/env`; strip env for non-admins.
- Modify `packages/web/src/api/endpoints.ts`: `setCodingAgentEnv`.
- Create `packages/web/src/features/models/agent-env.ts`: pure rules + request builders.
- Create `packages/web/src/features/models/agent-env-editor.tsx`: the card's Environment section.
- Modify `packages/web/src/features/models/local-cli-panel.tsx`, `add-agent-modal.tsx`, `packages/web/src/features/coding-agents/agent-cards.ts`.
- Modify strings (`strings-en.ts`, `strings-types.ts`).
- Tests: `packages/coding-agents/test/env.test.ts` (create), `packages/coding-agents/test/manager.test.ts`, `packages/server/test/coding-agent-env.test.ts` (create), `packages/web/test/agent-env.test.ts` (create), `packages/web/test/agent-cards.test.ts`.

**Part 2**
- Create `packages/server/src/coding-agents/builtin/copilot-package.ts`: platform → package name, pinned version, binary from a package manifest.
- Create `packages/server/src/coding-agents/builtin/runtime-install.ts`: metadata, verified download, unpack, swap, version check, cleanup.
- Create `packages/server/src/mechanisms/builtin-agents.ts`: the `BuiltinAgents` interface.
- Create `packages/server/src/coding-agents/builtin/service.ts`: `BuiltinAgentsService`.
- Modify `packages/server/src/coding-agents/routes.ts`, `packages/server/src/http/routes/coding-agents.ts`, `packages/server/src/platform.ts`, `packages/server/src/api/types.ts`.
- Create `packages/web/src/features/models/builtin-model.ts` and `builtin-panel.tsx`.
- Modify `packages/web/src/features/models/models-page.tsx`, `packages/web/src/features/chat/coding-agent-models.ts`, `packages/web/src/api/endpoints.ts`, strings.
- Tests: `packages/server/test/builtin-copilot-package.test.ts`, `packages/server/test/builtin-runtime-install.test.ts`, `packages/server/test/builtin-agents.test.ts`, `packages/server/test/fixtures/builtin-registry.ts` (all created), `packages/web/test/builtin-model.test.ts` (create).

---

## Part 1: Environment variables

### Task 1: Kernel env rules, built-in marker, stale-env tracking

**Files:**
- Modify: `packages/coding-agents/src/env.ts`
- Modify: `packages/coding-agents/src/types.ts:8-16`, `:159-198`
- Modify: `packages/coding-agents/src/manager.ts` (fields near `:118`, `connectionFor` `:570`, `disposeSession` `:404`, `onConnectionEvent` `:595`)
- Modify: `packages/coding-agents/src/index.ts`
- Test: `packages/coding-agents/test/env.test.ts` (create), `packages/coding-agents/test/manager.test.ts`

**Interfaces:**
- Produces:
  - `isReservedEnvKey(key: string): boolean`
  - `validateAgentEnvEntry(key: string, value: string | undefined): string | null`: an English reason, or null when valid. `value === undefined` means "keep stored" and only validates the key.
  - `AgentServerDefinition.builtin?: string`
  - `CodingAgentManager.startedWithOtherEnv(definitionId: string): boolean`
  - `spawnTarget` exported from the package index.

- [ ] **Step 1: Write the failing env-rule tests**

Create `packages/coding-agents/test/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isReservedEnvKey, validateAgentEnvEntry } from "../src/env.js";
import { parseDefinition } from "../src/types.js";

describe("agent env rules", () => {
  it("reserves the sandbox pass-through names, NO_BROWSER and PENGUIN_*", () => {
    for (const key of ["PATH", "path", "UserProfile", "NO_BROWSER", "PENGUIN_CODING_AGENT_HOME", "PENGUIN_X"]) {
      expect(isReservedEnvKey(key)).toBe(true);
    }
    for (const key of ["GEMINI_API_KEY", "COPILOT_GITHUB_TOKEN", "PATHS", "MY_PENGUIN"]) {
      expect(isReservedEnvKey(key)).toBe(false);
    }
  });

  it("names what is wrong with a key or value", () => {
    expect(validateAgentEnvEntry("GEMINI_API_KEY", "abc")).toBeNull();
    expect(validateAgentEnvEntry("GEMINI_API_KEY", undefined)).toBeNull();
    expect(validateAgentEnvEntry("1BAD", "x")).toMatch(/letter or underscore/);
    expect(validateAgentEnvEntry("HAS-DASH", "x")).toMatch(/letter or underscore/);
    expect(validateAgentEnvEntry("PATH", "x")).toMatch(/set by Penguin/);
    expect(validateAgentEnvEntry("K", "")).toMatch(/empty/);
    expect(validateAgentEnvEntry("K", "a\nb")).toMatch(/line break/);
    expect(validateAgentEnvEntry("K", "x".repeat(8193))).toMatch(/8192/);
    expect(validateAgentEnvEntry("K", "x".repeat(8192))).toBeNull();
  });

  it("carries the built-in marker through parseDefinition", () => {
    expect(parseDefinition({ id: "a", command: "c", builtin: "copilot" }).builtin).toBe("copilot");
    expect(parseDefinition({ id: "a", command: "c" })).not.toHaveProperty("builtin");
    expect(() => parseDefinition({ id: "a", command: "c", builtin: 3 })).toThrow(/builtin/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/coding-agents && npx vitest run test/env.test.ts`
Expected: FAIL, because `isReservedEnvKey` and `validateAgentEnvEntry` are not exported.

- [ ] **Step 3: Implement the rules and the marker**

Append to `packages/coding-agents/src/env.ts`:

```ts
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_ENV_VALUE = 8192;

/**
 * Names an agent definition may not set: the ones the sandbox passes through from the host
 * (overriding them breaks how the agent starts) and the ones Penguin sets itself.
 */
export function isReservedEnvKey(key: string): boolean {
  return PASS_THROUGH.test(key) || /^NO_BROWSER$/i.test(key) || /^PENGUIN_/i.test(key);
}

/**
 * Why an entry cannot be stored, or null when it can. An undefined value means "keep the
 * stored one" and only the name is checked.
 */
export function validateAgentEnvEntry(key: string, value: string | undefined): string | null {
  if (!ENV_KEY_PATTERN.test(key)) {
    return `${key}: a name starts with a letter or underscore and uses only letters, digits and underscores.`;
  }
  if (isReservedEnvKey(key)) return `${key} is set by Penguin and cannot be changed here.`;
  if (value === undefined) return null;
  if (value === "") return `${key}: the value is empty.`;
  if (/[\r\n]/.test(value)) return `${key}: the value cannot contain a line break.`;
  if (value.length > MAX_ENV_VALUE) return `${key}: the value is longer than ${MAX_ENV_VALUE} characters.`;
  return null;
}
```

In `packages/coding-agents/src/types.ts`, add to `AgentServerDefinition` after `env`:

```ts
  /**
   * Set on a definition Penguin manages itself (Models → Built-in), naming which built-in it
   * is; such a definition is written only by that service, never through the Local CLI routes.
   */
  builtin?: string;
```

In `parseDefinition`, before the `return`:

```ts
  const builtin = raw.builtin;
  if (builtin !== undefined && (typeof builtin !== "string" || !ID_PATTERN.test(builtin))) {
    throw new AcpAgentError("builtin must be a short identifier.");
  }
```

and add to the returned object:

```ts
    ...(typeof builtin === "string" ? { builtin } : {}),
```

In `packages/coding-agents/src/index.ts`, change the connection and env exports to:

```ts
export {
  AcpConnection,
  spawnTarget,
  type AcpClientInfo,
  type AcpConnectionHandlers,
  type SpawnProcess,
} from "./connection.js";
```

```ts
export { isReservedEnvKey, sandboxedAgentEnv, validateAgentEnvEntry } from "./env.js";
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/coding-agents && npx vitest run test/env.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing stale-env test**

In `packages/coding-agents/test/manager.test.ts`, inside `describe("CodingAgentManager", …)`:

```ts
  // The process reads its environment once; a change saved while it runs applies next start.
  it("reports when a running agent was started with other environment variables", async () => {
    let env: Record<string, string> = { KEY: "one" };
    const { manager } = harness({ envFor: () => env });
    manager.setDefinitions([{ id: "fake", command: "fake" }]);
    expect(manager.startedWithOtherEnv("fake")).toBe(false);
    const view = await manager.createSession("fake", workspace);
    expect(manager.startedWithOtherEnv("fake")).toBe(false);
    env = { KEY: "two" };
    expect(manager.startedWithOtherEnv("fake")).toBe(true);
    await manager.disposeSession(view.sessionId);
    expect(manager.startedWithOtherEnv("fake")).toBe(false);
  });
```

Check `harness` (top of the file, around `:30-51`). If it does not already accept an `envFor` override, add one: give its options parameter `envFor?: (definition: AgentServerDefinition) => Record<string, string>` and pass `envFor: options.envFor ?? (() => ({}))` to the `CodingAgentManager` constructor in place of the current value.

- [ ] **Step 6: Run to verify it fails**

Run: `cd packages/coding-agents && npx vitest run test/manager.test.ts -t "other environment"`
Expected: FAIL, because `startedWithOtherEnv` is not a function.

- [ ] **Step 7: Implement tracking in the manager**

In `packages/coding-agents/src/manager.ts`, add a field after `pendingConnections`:

```ts
  /** The environment each live connection's process was started with, as compared JSON. */
  private readonly spawnedEnv = new Map<string, string>();
```

In `connectionFor`, record the env when a connection is created. Replace the `.then(async (connection) => { … })` body with:

```ts
      .then(async (connection) => {
        await connection.initialize();
        this.connections.set(definition.id, connection);
        this.spawnedEnv.set(definition.id, JSON.stringify(this.envFor(definition)));
        return connection;
      })
```

In `disposeSession`, where the last session tears the connection down:

```ts
    if (!remaining) {
      this.connections.delete(record.definitionId);
      this.spawnedEnv.delete(record.definitionId);
      connection.dispose();
    }
```

In `onConnectionEvent`, right after `this.connections.delete(definitionId);`:

```ts
      this.spawnedEnv.delete(definitionId);
```

In `dispose()`, add `this.spawnedEnv.clear();`.

Add the public method after `listSessions()`:

```ts
  /**
   * Whether the agent's running process was started with a different environment than its
   * definition now gives; false when it is not running. Its sessions keep the old values until
   * the last one ends, since the process reads its environment only at start.
   */
  startedWithOtherEnv(definitionId: string): boolean {
    const started = this.spawnedEnv.get(definitionId);
    const definition = this.definitions.get(definitionId);
    if (started === undefined || definition === undefined) return false;
    return started !== JSON.stringify(this.envFor(definition));
  }
```

- [ ] **Step 8: Run the package suite**

Run: `cd packages/coding-agents && npx vitest run && npx tsc --noEmit -p . && npx tsup`
Expected: all tests pass (previous 57 plus 4 new), no type errors, `dist/` rebuilt. The server consumes `dist/`.

- [ ] **Step 9: Commit**

```bash
git add packages/coding-agents/src packages/coding-agents/test
git commit -m "feat(coding-agents): env rules, built-in marker and stale-env tracking"
```

### Task 2: Server env storage, route and listing

**Files:**
- Modify: `packages/server/src/api/types.ts` (near `CodingAgentServerInfo`, `:4868`)
- Modify: `packages/server/src/mechanisms/coding-agents.ts:22-35`
- Modify: `packages/server/src/coding-agents/service.ts` (`listAgents` `:182`, `saveAgent` `:245`; new methods)
- Modify: `packages/server/src/http/routes/coding-agents.ts` (header comment, `GET /agents`, new `PUT`)
- Modify: `packages/server/src/ifaces.json` (regenerated)
- Test: `packages/server/test/coding-agent-env.test.ts` (create)

**Interfaces:**
- Consumes: `validateAgentEnvEntry`, `startedWithOtherEnv`, `AgentServerDefinition.builtin` (Task 1).
- Produces (API types):

```ts
export interface CodingAgentEnvEntryInfo {
  key: string;
  valueMasked: string;
}
/** PUT /api/coding-agents/agents/:agentId/env: the whole set; an entry without value keeps the stored one. */
export interface CodingAgentEnvRequest {
  entries: { key: string; value?: string }[];
}
```

`CodingAgentServerInfo` gains three fields: `env?: CodingAgentEnvEntryInfo[]` (admins only), `envPending?: boolean` (admins only), and `builtin?: string`.
- Produces (mechanism):
  - `listAgents(opts?: { withEnv?: boolean }): CodingAgentServerInfo[]`
  - `setAgentEnv(agentId: string, entries: { key: string; value?: string }[]): Promise<CodingAgentServerInfo>`
  - `saveBuiltinDefinition(definition: AgentServerDefinition): void`
  - `removeBuiltinDefinition(agentId: string): boolean`

- [ ] **Step 1: Write the failing route tests**

Create `packages/server/test/coding-agent-env.test.ts`:

```ts
/**
 * Coding-agent environment variables over HTTP: Vault-style replace with keep-by-key,
 * masking, admin-only visibility, and the built-in definitions the Local CLI routes may not touch.
 */
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CodingAgentsResponse } from "../src/api/types.js";
import type { CodingAgents } from "../src/mechanisms/coding-agents.js";
import { upgradeAdapterPackage } from "../src/coding-agents/service.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const AGENT_MAIN = fileURLToPath(new URL("./coding-agents-agent.mjs", import.meta.url));

describe("coding agent env", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    member = apiClient(t.app, (await provisionUser(t.app, "member_b")).cookie);
    expect(
      (
        await admin.post("/api/coding-agents/agents", {
          id: "fake",
          command: process.execPath,
          args: [AGENT_MAIN],
        })
      ).status,
    ).toBe(201);
  });
  afterEach(async () => t.cleanup());

  const agentsAs = async (client: typeof admin) =>
    ((await (await client.get("/api/coding-agents/agents")).json()) as CodingAgentsResponse).agents;

  it("stores values, returns them masked, and keeps a key sent without a value", async () => {
    const put = (entries: unknown) => admin.put("/api/coding-agents/agents/fake/env", { entries });
    expect((await put([{ key: "GEMINI_API_KEY", value: "AIzaSyExample1234567890" }, { key: "SHORT", value: "abc" }])).status).toBe(200);
    let fake = (await agentsAs(admin)).find((a) => a.id === "fake")!;
    expect(fake.env).toEqual([
      { key: "GEMINI_API_KEY", valueMasked: "AIza…7890" },
      { key: "SHORT", valueMasked: "***" },
    ]);
    // Keep GEMINI_API_KEY by name, drop SHORT, add another.
    expect((await put([{ key: "GEMINI_API_KEY" }, { key: "OTHER", value: "value-two" }])).status).toBe(200);
    fake = (await agentsAs(admin)).find((a) => a.id === "fake")!;
    expect(fake.env).toEqual([
      { key: "GEMINI_API_KEY", valueMasked: "AIza…7890" },
      { key: "OTHER", valueMasked: "***" },
    ]);
    expect(JSON.stringify(await agentsAs(admin))).not.toContain("AIzaSyExample1234567890");
  });

  it("refuses bad, reserved, duplicate and unknown keys and saves nothing", async () => {
    const put = (entries: unknown) => admin.put("/api/coding-agents/agents/fake/env", { entries });
    for (const entries of [
      [{ key: "PATH", value: "x" }],
      [{ key: "PENGUIN_X", value: "x" }],
      [{ key: "1BAD", value: "x" }],
      [{ key: "A", value: "a\nb" }],
      [{ key: "A", value: "x" }, { key: "A", value: "y" }],
      [{ key: "NEVER_STORED" }],
    ]) {
      const res = await put(entries);
      expect(res.status).toBe(400);
    }
    expect((await agentsAs(admin)).find((a) => a.id === "fake")!.env).toEqual([]);
  });

  it("is admin-only to write, and members never see env", async () => {
    expect((await member.put("/api/coding-agents/agents/fake/env", { entries: [] })).status).toBe(403);
    await admin.put("/api/coding-agents/agents/fake/env", { entries: [{ key: "K", value: "secret-value-123" }] });
    const fake = (await agentsAs(member)).find((a) => a.id === "fake")!;
    expect(fake).not.toHaveProperty("env");
    expect(fake).not.toHaveProperty("envPending");
  });

  it("keeps stored env when an agent is re-saved without env", async () => {
    await admin.put("/api/coding-agents/agents/fake/env", { entries: [{ key: "K", value: "secret-value-123" }] });
    expect(
      (await admin.post("/api/coding-agents/agents", { id: "fake", title: "Renamed", command: process.execPath, args: [AGENT_MAIN] })).status,
    ).toBe(201);
    const fake = (await agentsAs(admin)).find((a) => a.id === "fake")!;
    expect(fake.title).toBe("Renamed");
    expect(fake.env).toEqual([{ key: "K", valueMasked: "secr…-123" }]);
  });

  it("keeps env through the adapter-package upgrade", () => {
    const upgraded = upgradeAdapterPackage({
      id: "codex",
      command: "npx",
      args: ["-y", "@zed-industries/codex-acp"],
      env: { K: "v" },
    });
    expect(upgraded.args).toEqual(["-y", "@agentclientprotocol/codex-acp"]);
    expect(upgraded.env).toEqual({ K: "v" });
  });

  it("keeps built-in definitions off the Local CLI routes", async () => {
    const service = t.deps.platform.get(CodingAgentsToken);
    service.saveBuiltinDefinition({
      id: "copilot-builtin",
      title: "GitHub Copilot (built-in)",
      command: process.execPath,
      args: [AGENT_MAIN],
      env: { COPILOT_GITHUB_TOKEN: "github_pat_example_abcd" },
      builtin: "copilot",
    });
    const save = await admin.post("/api/coding-agents/agents", { id: "copilot-builtin", command: "x" });
    expect(save.status).toBe(400);
    expect(await save.text()).toMatch(/Built-in/);
    const env = await admin.put("/api/coding-agents/agents/copilot-builtin/env", { entries: [] });
    expect(env.status).toBe(400);
    const listed = (await agentsAs(admin)).find((a) => a.id === "copilot-builtin")!;
    expect(listed.builtin).toBe("copilot");
  });
});
```

The last test needs the service instance. Check how other server tests reach a kernel service from `TestApp` (for example `grep -rn "deps\.\w*\.get(" packages/server/test | head`). Replace `t.deps.platform.get(CodingAgentsToken)` with that pattern, typed as `CodingAgents`. If no such accessor exists, add `codingAgents: CodingAgents` to `TestDeps` in `test/helpers.ts`, the same way the other exported mechanisms are exposed there.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/server && npx vitest run test/coding-agent-env.test.ts`
Expected: FAIL, with 404s on the new route and a missing `env` on listed agents.

- [ ] **Step 3: Add the API types and the mechanism methods**

In `packages/server/src/api/types.ts`, add the two interfaces from **Produces** above, right before `CodingAgentServerInfo`, and these fields to `CodingAgentServerInfo`:

```ts
  /** Admins only: the agent's own environment variables, values masked. */
  env?: CodingAgentEnvEntryInfo[];
  /**
   * Admins only: the running agent was started with other values than it now has; they apply
   * once its running sessions end.
   */
  envPending?: boolean;
  /** Set when Penguin manages this agent itself (Models → Built-in), naming which built-in. */
  builtin?: string;
```

In `packages/server/src/mechanisms/coding-agents.ts`, change `listAgents()` and add after `removeAgent`:

```ts
  /** `withEnv` adds each agent's masked variables; the route passes it for admins only. */
  listAgents(opts?: { withEnv?: boolean }): CodingAgentServerInfo[];
```

```ts
  /**
   * Replace an agent's environment variables (Vault rules: an entry without a value keeps the
   * stored one; a key not listed is removed). A detected agent's definition is saved first.
   * Refused for a built-in definition, whose variables its own service owns.
   */
  setAgentEnv(agentId: string, entries: { key: string; value?: string }[]): Promise<CodingAgentServerInfo>;
  /** For the built-in agents service only: write its definition, bypassing the Local CLI guard. */
  saveBuiltinDefinition(definition: AgentServerDefinition): void;
  /** For the built-in agents service only: drop its definition. */
  removeBuiltinDefinition(agentId: string): boolean;
```

Add `type AgentServerDefinition` to that file's `@prismshadow/penguin-coding-agents` type import.

- [ ] **Step 4: Implement in the service**

In `packages/server/src/coding-agents/service.ts`:

Import `validateAgentEnvEntry` alongside `parseDefinition`, and add `import { maskApiKey } from "../services/project-config-service.js";`. If that import pulls in a cycle (the type check or an import error will show it), move `maskApiKey` into `packages/server/src/services/mask.ts`, re-export it from `project-config-service.ts`, and import it from there.

Replace `listAgents` and `saveAgent`:

```ts
  listAgents(opts: { withEnv?: boolean } = {}): CodingAgentServerInfo[] {
    const models = this.loadRememberedModels();
    const options = this.loadRememberedOptions();
    const manager = this.getManager();
    return manager.listDefinitions().map((d) => ({
      ...this.infoOf(d),
      ...(models[d.id] !== undefined ? { rememberedModel: models[d.id] } : {}),
      ...(options[d.id] !== undefined ? { rememberedOptions: options[d.id] } : {}),
      ...(opts.withEnv === true
        ? { env: maskedEnv(d.env), envPending: manager.startedWithOtherEnv(d.id) }
        : {}),
    }));
  }

  saveAgent(input: unknown): CodingAgentServerInfo {
    const parsed: AgentServerDefinition = parseDefinition(input);
    const existing = this.loadDefinitions().find((d) => d.id === parsed.id);
    if (existing?.builtin !== undefined || parsed.builtin !== undefined) {
      throw new AcpAgentError(`${parsed.id} is managed on Models → Built-in.`);
    }
    // A save that names no variables keeps the stored ones: the form never has their values.
    const sentEnv =
      input !== null && typeof input === "object" && Object.hasOwn(input as object, "env");
    for (const [key, value] of Object.entries(parsed.env ?? {})) {
      const problem = validateAgentEnvEntry(key, value);
      if (problem !== null) throw new AcpAgentError(problem);
    }
    const definition = sentEnv ? parsed : { ...parsed, env: existing?.env ?? {} };
    this.persistDefinitions([
      ...this.loadDefinitions().filter((d) => d.id !== definition.id),
      definition,
    ]);
    return this.infoOf(definition);
  }

  async setAgentEnv(
    agentId: string,
    entries: { key: string; value?: string }[],
  ): Promise<CodingAgentServerInfo> {
    await this.ensureDefinition(agentId);
    const definition = this.loadDefinitions().find((d) => d.id === agentId);
    if (definition === undefined) throw new AcpAgentError(`unknown agent: ${agentId}`);
    if (definition.builtin !== undefined) {
      throw new AcpAgentError(`${agentId} is managed on Models → Built-in.`);
    }
    const stored = definition.env ?? {};
    const next: Record<string, string> = {};
    for (const entry of entries) {
      const problem = validateAgentEnvEntry(entry.key, entry.value);
      if (problem !== null) throw new AcpAgentError(problem);
      if (Object.hasOwn(next, entry.key)) throw new AcpAgentError(`${entry.key} is listed twice.`);
      const value = entry.value ?? stored[entry.key];
      if (value === undefined) throw new AcpAgentError(`${entry.key} has no stored value to keep.`);
      next[entry.key] = value;
    }
    this.persistDefinitions([
      ...this.loadDefinitions().filter((d) => d.id !== agentId),
      { ...definition, env: next },
    ]);
    return this.listAgents({ withEnv: true }).find((a) => a.id === agentId)!;
  }

  saveBuiltinDefinition(definition: AgentServerDefinition): void {
    this.persistDefinitions([
      ...this.loadDefinitions().filter((d) => d.id !== definition.id),
      definition,
    ]);
  }

  removeBuiltinDefinition(agentId: string): boolean {
    const definitions = this.loadDefinitions();
    const remaining = definitions.filter((d) => !(d.id === agentId && d.builtin !== undefined));
    if (remaining.length === definitions.length) return false;
    this.persistDefinitions(remaining);
    return true;
  }
```

`removeAgent` (Local CLI **Remove**) must also refuse built-ins. Change its filter to:

```ts
    const target = definitions.find((d) => d.id === agentId);
    if (target?.builtin !== undefined) {
      throw new AcpAgentError(`${agentId} is managed on Models → Built-in.`);
    }
    const remaining = definitions.filter((d) => d.id !== agentId);
```

Add these private helpers (the `infoOf` one next to `toInfo`, the `maskedEnv` one at module level):

```ts
  /** The listing shape of a definition, without remembered settings or env. */
  private infoOf(d: AgentServerDefinition): CodingAgentServerInfo {
    return {
      id: d.id,
      command: d.command,
      args: d.args ?? [],
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.builtin !== undefined ? { builtin: d.builtin } : {}),
    };
  }
```

```ts
/** An agent's variables as the API shows them: names in order, values masked. */
function maskedEnv(env: Record<string, string> | undefined): CodingAgentEnvEntryInfo[] {
  return Object.entries(env ?? {}).map(([key, value]) => ({ key, valueMasked: maskApiKey(value) }));
}
```

Add `CodingAgentEnvEntryInfo` to the `../api/types.js` import.

- [ ] **Step 5: Add the route and admin-only listing**

In `packages/server/src/http/routes/coding-agents.ts`, add to the header list:

```
 *   PUT    /api/coding-agents/agents/:agentId/env                      (admin: replace an agent's environment variables)
```

Find the `app.get("/agents", …)` handler and make it:

```ts
  app.get("/agents", (c) =>
    c.json({ agents: deps.codingAgents.listAgents({ withEnv: c.var.user.isAdmin }) }),
  );
```

Add after the `/agents/:agentId/options` handler:

```ts
  app.put("/agents/:agentId/env", async (c) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "forbidden", "Admin access is required.");
    }
    const agentId = pathParam(c, "agentId");
    const body = (await readJson(c)) as { entries?: unknown };
    if (!Array.isArray(body.entries)) throw badRequest("entries must be an array.");
    const entries = body.entries.map((raw: unknown) => {
      const entry = raw as { key?: unknown; value?: unknown };
      if (typeof entry?.key !== "string") throw badRequest("every entry needs a key.");
      if (entry.value !== undefined && typeof entry.value !== "string") {
        throw badRequest(`${entry.key}: value must be a string.`);
      }
      return entry.value === undefined ? { key: entry.key } : { key: entry.key, value: entry.value };
    });
    try {
      return c.json({ agent: await deps.codingAgents.setAgentEnv(agentId, entries) });
    } catch (error) {
      rethrowKernelError(error);
    }
  });
```

Wrap the `DELETE /agents/:agentId` handler's `removeAgent` call in the same `try { … } catch (error) { rethrowKernelError(error); }` so a built-in refusal becomes a 400.

- [ ] **Step 6: Run the new and existing coding-agent tests**

Run: `cd packages/server && npx vitest run test/coding-agent-env.test.ts test/coding-agents.test.ts test/coding-agent-adapter-upgrade.test.ts test/coding-agent-sessions.test.ts`
Expected: PASS. The existing `lists saved definitions for any authenticated user` test reads as a member, so its exact `toEqual` still holds.

- [ ] **Step 7: Regenerate interfaces and type-check**

Run: `pnpm gen:ifaces && cd packages/server && npx tsc --noEmit -p .` (from the repo root)
Expected: `ifaces.json` updated; no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src packages/server/test
git commit -m "feat(server): environment variables for coding agents"
```

### Task 3: Web Environment editor and Add agent dialog

**Files:**
- Create: `packages/web/src/features/models/agent-env.ts`
- Create: `packages/web/src/features/models/agent-env-editor.tsx`
- Modify: `packages/web/src/features/models/local-cli-panel.tsx` (`CliCard`, `:302-377`)
- Modify: `packages/web/src/features/models/add-agent-modal.tsx`
- Modify: `packages/web/src/features/coding-agents/agent-cards.ts`
- Modify: `packages/web/src/api/endpoints.ts` (coding agents block, `:1804`)
- Modify: `packages/web/src/lib/strings-en.ts`, `packages/web/src/lib/strings-types.ts`
- Create: `changelog/unreleased/2026-09-25-coding-agent-env.md`
- Test: `packages/web/test/agent-env.test.ts` (create), `packages/web/test/agent-cards.test.ts`

**Interfaces:**
- Consumes: `CodingAgentEnvEntryInfo`, `CodingAgentEnvRequest`, `CodingAgentServerInfo.env/envPending/builtin` (Task 2).
- Produces:
  - `AgentCardModel.env?: CodingAgentEnvEntryInfo[]`
  - `AgentCardModel.envPending?: boolean`
  - `buildAgentCards` skips definitions with `builtin`.
  - `envKeyProblem(key: string, existing: string[]): string | null`
  - `keepAllExcept(entries: CodingAgentEnvEntryInfo[], exclude?: string): CodingAgentEnvRequest["entries"]`
  - `setCodingAgentEnv(agentId: string, body: CodingAgentEnvRequest): Promise<{ agent: CodingAgentServerInfo }>`

- [ ] **Step 1: Write the failing helper and card tests**

Create `packages/web/test/agent-env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { envKeyProblem, keepAllExcept } from "../src/features/models/agent-env";
import { S } from "../src/lib/strings";

describe("agent env helpers", () => {
  it("checks a new key the way the server does", () => {
    expect(envKeyProblem("GEMINI_API_KEY", [])).toBeNull();
    expect(envKeyProblem("", [])).toBe(S.common.requiredField);
    expect(envKeyProblem("1BAD", [])).toBe(S.models.cliEnvKeyInvalid);
    expect(envKeyProblem("path", [])).toBe(S.models.cliEnvKeyReserved);
    expect(envKeyProblem("PENGUIN_X", [])).toBe(S.models.cliEnvKeyReserved);
    expect(envKeyProblem("NO_BROWSER", [])).toBe(S.models.cliEnvKeyReserved);
  });

  it("keeps every stored key by name, minus the one being replaced or removed", () => {
    const entries = [
      { key: "A", valueMasked: "***" },
      { key: "B", valueMasked: "***" },
    ];
    expect(keepAllExcept(entries)).toEqual([{ key: "A" }, { key: "B" }]);
    expect(keepAllExcept(entries, "A")).toEqual([{ key: "B" }]);
  });
});
```

Append to `packages/web/test/agent-cards.test.ts`:

```ts
describe("built-in and env on cards", () => {
  it("leaves built-in definitions off Local CLI and carries env onto cards", () => {
    const { installed } = buildAgentCards(
      [
        { id: "mine", command: "x", args: [], env: [{ key: "K", valueMasked: "***" }], envPending: true },
        { id: "copilot-builtin", command: "y", args: [], builtin: "copilot" },
      ],
      null,
      "setup",
    );
    expect(installed.map((c) => c.agentId)).toEqual(["mine"]);
    expect(installed[0]!.env).toEqual([{ key: "K", valueMasked: "***" }]);
    expect(installed[0]!.envPending).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/web && npx vitest run test/agent-env.test.ts test/agent-cards.test.ts`
Expected: FAIL, because `agent-env` does not exist and the built-in card is listed.

- [ ] **Step 3: Add strings**

In `packages/web/src/lib/strings-types.ts`, inside the `models` block (next to `viewLocalCli`):

```ts
    cliEnv: string;
    cliEnvHint: string;
    cliEnvEmpty: string;
    cliEnvAdd: string;
    cliEnvAddTitle: string;
    cliEnvKey: string;
    cliEnvValue: string;
    cliEnvRemove: string;
    cliEnvSaved: string;
    cliEnvPending: string;
    cliEnvKeyInvalid: string;
    cliEnvKeyReserved: string;
    cliEnvValueRequired: string;
    cliEnvOverwriteTitle: string;
    cliEnvOverwriteBody: (key: string) => string;
    cliEnvRemoveTitle: string;
    cliEnvRemoveBody: (key: string) => string;
```

In `packages/web/src/lib/strings-en.ts`, in the same block:

```ts
    cliEnv: "Environment",
    cliEnvHint:
      "Variables this agent starts with, such as an API key. Values stay on the server and are shown masked.",
    cliEnvEmpty: "No variables.",
    cliEnvAdd: "Add variable",
    cliEnvAddTitle: "Add a variable",
    cliEnvKey: "Name",
    cliEnvValue: "Value",
    cliEnvRemove: "Remove",
    cliEnvSaved: "Saved. The agent uses it from its next start.",
    cliEnvPending: "Applies once this agent's running sessions end.",
    cliEnvKeyInvalid: "Use letters, digits and underscores, starting with a letter or underscore.",
    cliEnvKeyReserved: "Penguin sets this one itself.",
    cliEnvValueRequired: "Enter a value.",
    cliEnvOverwriteTitle: "Replace this value?",
    cliEnvOverwriteBody: (key) => `${key} already has a value. Saving replaces it.`,
    cliEnvRemoveTitle: "Remove this variable?",
    cliEnvRemoveBody: (key) => `The agent starts without ${key} from its next start.`,
```

In `codingAgents` (`:776-777`), replace `envHint: "One KEY=value per line."` with `envHint: "Variables this agent starts with, such as an API key."` (type unchanged).

- [ ] **Step 4: Implement the helpers, endpoint and card data**

Create `packages/web/src/features/models/agent-env.ts`:

```ts
/**
 * An agent's environment variables as the Models page edits them: the naming rule the server
 * enforces, and the Vault-style request that keeps stored values by sending names alone.
 */
import type {
  CodingAgentEnvEntryInfo,
  CodingAgentEnvRequest,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED =
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|LANG|LC_ALL|HTTPS_PROXY|HTTP_PROXY|NO_PROXY|SSL_CERT_FILE|NODE_EXTRA_CA_CERTS|NO_BROWSER)$|^PENGUIN_/i;

/** Why a new variable name cannot be used, or null. Same rule as the server's. */
export function envKeyProblem(key: string, _existing: string[]): string | null {
  if (key === "") return S.common.requiredField;
  if (!KEY_PATTERN.test(key)) return S.models.cliEnvKeyInvalid;
  if (RESERVED.test(key)) return S.models.cliEnvKeyReserved;
  return null;
}

/** Every stored variable by name alone (which keeps its value), except `exclude`. */
export function keepAllExcept(
  entries: CodingAgentEnvEntryInfo[],
  exclude?: string,
): CodingAgentEnvRequest["entries"] {
  return entries.filter((e) => e.key !== exclude).map((e) => ({ key: e.key }));
}
```

Drop the unused `_existing` parameter if the linter objects; update both the signature and the test calls together.

In `packages/web/src/api/endpoints.ts`, after `testCodingAgent`:

```ts
/** Replace an agent's environment variables; a name sent alone keeps its value. Admin-only. */
export const setCodingAgentEnv = (agentId: string, body: CodingAgentEnvRequest) =>
  apiFetch<{ agent: CodingAgentServerInfo }>(
    `/api/coding-agents/agents/${encodeURIComponent(agentId)}/env`,
    { method: "PUT", body },
  );
```

Add `CodingAgentEnvRequest` and `CodingAgentServerInfo` to that file's type imports if they are not already there.

In `packages/web/src/features/coding-agents/agent-cards.ts`:
- Add to `AgentCardModel`:

```ts
  /** Admins only: the agent's variables, masked. */
  env?: CodingAgentEnvEntryInfo[];
  /** Admins only: saved values apply once the running sessions end. */
  envPending?: boolean;
```

- At the start of `buildAgentCards`, replace `saved` with its non-built-in part:

```ts
  saved = saved.filter((a) => a.builtin === undefined);
```

- In the recipe-card object literal, after `rememberedModel`, add:

```ts
      ...(definition?.env !== undefined ? { env: definition.env } : {}),
      ...(definition?.envPending === true ? { envPending: true } : {}),
```

- Do the same in the saved-only card object, reading from `agent`.
- Import `CodingAgentEnvEntryInfo` from `@prismshadow/penguin-server/api`.

- [ ] **Step 5: Run the helper and card tests**

Run: `cd packages/web && npx vitest run test/agent-env.test.ts test/agent-cards.test.ts`
Expected: PASS.

- [ ] **Step 6: Build the editor component**

Create `packages/web/src/features/models/agent-env-editor.tsx`:

```tsx
/**
 * A Local CLI card's Environment section: the agent's variables as name + masked value, added
 * and removed like the Agent Vault's entries (each change saves at once, a replace or removal is
 * confirmed first). Admin-only; values never come back from the server.
 */
import { useState } from "react";
import type { CodingAgentEnvEntryInfo, CodingAgentEnvRequest } from "@prismshadow/penguin-server/api";
import { setCodingAgentEnv } from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { PasswordInput } from "../../components/ui/password-input";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { envKeyProblem, keepAllExcept } from "./agent-env";

export function AgentEnvEditor({
  agentId,
  entries,
  pending,
  onChanged,
}: {
  agentId: string;
  entries: CodingAgentEnvEntryInfo[];
  pending: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [errors, setErrors] = useState<{ key?: string; value?: string }>({});
  const [overwriting, setOverwriting] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const persist = async (body: CodingAgentEnvRequest): Promise<string | null> => {
    setBusy(true);
    try {
      await setCodingAgentEnv(agentId, body);
      toastSuccess(S.models.cliEnvSaved);
      onChanged();
      return null;
    } catch (e) {
      return apiErrorText(e);
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const name = key.trim();
    const next = {
      ...(envKeyProblem(name, entries.map((e) => e.key)) !== null
        ? { key: envKeyProblem(name, entries.map((e) => e.key))! }
        : {}),
      ...(value === "" ? { value: S.models.cliEnvValueRequired } : {}),
    };
    if (next.key || next.value) {
      setErrors(next);
      return;
    }
    if (overwriting !== name && entries.some((e) => e.key === name)) {
      setOverwriting(name);
      return;
    }
    setOverwriting(null);
    const error = await persist({ entries: [...keepAllExcept(entries, name), { key: name, value }] });
    if (error !== null) {
      setErrors({ key: error });
      return;
    }
    setAdding(false);
  };

  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {S.models.cliEnv}
      </span>
      <p className="text-xs text-gray-500 dark:text-gray-400">{S.models.cliEnvHint}</p>
      {entries.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">{S.models.cliEnvEmpty}</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {entries.map((entry) => (
            <li key={entry.key} className="flex min-w-0 items-center gap-3 px-3 py-1.5">
              <span className="truncate font-mono text-xs text-gray-900 dark:text-gray-100">{entry.key}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-500 dark:text-gray-400">
                {entry.valueMasked}
              </span>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRemoving(entry.key)}>
                {S.models.cliEnvRemove}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {pending && <p className={`text-xs ${toneInk.attention}`}>{S.models.cliEnvPending}</p>}
      <Button
        size="sm"
        disabled={busy}
        onClick={() => {
          setKey("");
          setValue("");
          setErrors({});
          setAdding(true);
        }}
      >
        {S.models.cliEnvAdd}
      </Button>

      <Modal
        open={adding}
        title={S.models.cliEnvAddTitle}
        onClose={() => setAdding(false)}
        footer={
          <>
            <Button size="sm" onClick={() => setAdding(false)}>
              {S.common.cancel}
            </Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void add()}>
              {S.common.save}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            size="sm"
            label={S.models.cliEnvKey}
            required
            error={errors.key}
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setErrors({});
            }}
            className="font-mono"
            placeholder="GEMINI_API_KEY"
            autoComplete="off"
          />
          <PasswordInput
            size="sm"
            label={S.models.cliEnvValue}
            required
            error={errors.value}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setErrors({});
            }}
            className="font-mono"
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void add();
            }}
          />
        </div>
      </Modal>

      <ConfirmModal
        open={overwriting !== null}
        title={S.models.cliEnvOverwriteTitle}
        tone="primary"
        confirmLabel={S.common.save}
        busy={busy}
        onClose={() => setOverwriting(null)}
        onConfirm={() => void add()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {overwriting !== null ? S.models.cliEnvOverwriteBody(overwriting) : ""}
        </p>
      </ConfirmModal>

      <ConfirmModal
        open={removing !== null}
        title={S.models.cliEnvRemoveTitle}
        busy={busy}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing === null) return;
          void persist({ entries: keepAllExcept(entries, removing) }).then((error) => {
            if (error !== null) toastError(error);
            setRemoving(null);
          });
        }}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {removing !== null ? S.models.cliEnvRemoveBody(removing) : ""}
        </p>
      </ConfirmModal>
    </div>
  );
}
```

Tidy the double `envKeyProblem` call into a local `const keyProblem = envKeyProblem(…)` when you write it.

- [ ] **Step 7: Put the editor on the card and simplify Add agent**

In `local-cli-panel.tsx`, `CliCard`, after the effort `Select` block and before `card.setupHint`:

```tsx
          {isAdmin && card.startable && (
            <AgentEnvEditor
              agentId={card.agentId}
              entries={card.env ?? []}
              pending={card.envPending === true}
              onChanged={onChanged}
            />
          )}
```

Import `AgentEnvEditor` from `./agent-env-editor`.

In `add-agent-modal.tsx`, remove the `env` state, the `envRecord` parsing, the `env: envRecord` field and the env `Field`. The dialog creates the agent, and its card's Environment section adds variables afterwards. That is one editor instead of two, and no plaintext textarea. Replace the component's header comment line "with its arguments and extra environment" with "with its arguments; its environment variables are added on its card afterwards". Remove the now-unused `codingAgents.envLabel` and `envHint` strings from both strings files, and search for other uses first: `grep -rn "codingAgents.env" packages/web/src`.

- [ ] **Step 8: Type-check, test, and look at it**

Run: `cd packages/web && npx tsc --noEmit -p . && npx vitest run test/agent-env.test.ts test/agent-cards.test.ts`
Expected: PASS.

Then with the dev app running (`localhost:7365`), open **Models → Local CLI** and check:
- expanding Gemini CLI shows Environment
- adding `GEMINI_API_KEY` shows a masked row
- **Test again** runs
- a member account sees no Environment section

- [ ] **Step 9: Changelog and commit**

Create `changelog/unreleased/2026-09-25-coding-agent-env.md`:

```markdown
# Coding agents take their own environment variables

- **Date:** 2026-09-25
- **Type:** feat
- **Scope:** `coding-agents`, `server`, `web`

Each agent on **Models → Local CLI** has an **Environment** section where an admin adds the
variables it starts with, such as `GEMINI_API_KEY` or `COPILOT_GITHUB_TOKEN`. It works for
detected agents as well as ones added by hand. Values stay on the server and are shown
masked; members do not see them. Names Penguin sets itself (`PATH`, `HOME`, `PENGUIN_*`
and the like) are refused.

A change applies from the agent's next start; while its sessions run, the card says so.
Saving an agent again from **Add agent** no longer erases its variables, and the dialog's
plain-text environment box is gone in favour of the card's editor.
```

```bash
git add packages/web changelog/unreleased/2026-09-25-coding-agent-env.md
git commit -m "feat(web): an Environment section on coding-agent cards"
```

---

## Part 2: Built-in GitHub Copilot

### Task 4: Copilot package facts

**Files:**
- Create: `packages/server/src/coding-agents/builtin/copilot-package.ts`
- Test: `packages/server/test/builtin-copilot-package.test.ts` (create)

**Interfaces:**
- Produces:
  - `COPILOT_VERSION = "1.0.88"`
  - `copilotPackageName(platform: NodeJS.Platform, arch: string, musl: boolean): string | null`
  - `isMuslLinux(): boolean`
  - `binaryFromManifest(manifest: unknown): string`: the relative path of the program, taken from `exports["."]`, else the first `bin` value. It throws a plain `Error` when neither is present.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  COPILOT_VERSION,
  binaryFromManifest,
  copilotPackageName,
} from "../src/coding-agents/builtin/copilot-package.js";

describe("copilot package facts", () => {
  it("pins a version", () => expect(COPILOT_VERSION).toMatch(/^\d+\.\d+\.\d+$/));

  it("names the platform package, musl included, and nothing for unknown platforms", () => {
    expect(copilotPackageName("win32", "x64", false)).toBe("@github/copilot-win32-x64");
    expect(copilotPackageName("darwin", "arm64", false)).toBe("@github/copilot-darwin-arm64");
    expect(copilotPackageName("linux", "x64", false)).toBe("@github/copilot-linux-x64");
    expect(copilotPackageName("linux", "arm64", true)).toBe("@github/copilot-linuxmusl-arm64");
    expect(copilotPackageName("linux", "ia32", false)).toBeNull();
    expect(copilotPackageName("freebsd", "x64", false)).toBeNull();
  });

  it("reads the program from the manifest's exports, else its bin", () => {
    expect(binaryFromManifest({ exports: { ".": "./copilot.exe" } })).toBe("copilot.exe");
    expect(binaryFromManifest({ bin: { "copilot-linux-x64": "copilot" } })).toBe("copilot");
    expect(() => binaryFromManifest({})).toThrow(/program/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/server && npx vitest run test/builtin-copilot-package.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * What Penguin downloads to run GitHub Copilot itself: the Copilot CLI's platform package from
 * npm (the same program the Local CLI recipe runs with --acp), at a version pinned here and
 * raised deliberately with a Penguin release.
 */
export const COPILOT_VERSION = "1.0.88";

const ARCHES = new Set(["x64", "arm64"]);

/** The npm package holding the program for this machine, or null when Copilot has no build for it. */
export function copilotPackageName(
  platform: NodeJS.Platform,
  arch: string,
  musl: boolean,
): string | null {
  if (!ARCHES.has(arch)) return null;
  if (platform === "win32" || platform === "darwin") return `@github/copilot-${platform}-${arch}`;
  if (platform === "linux") return `@github/copilot-${musl ? "linuxmusl" : "linux"}-${arch}`;
  return null;
}

/** A Linux without glibc (Alpine and the like), where the musl build is the one that runs. */
export function isMuslLinux(): boolean {
  if (process.platform !== "linux") return false;
  const header = (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } })
    .header;
  return header?.glibcVersionRuntime === undefined;
}

/** The program's path inside the unpacked package, from its manifest. */
export function binaryFromManifest(manifest: unknown): string {
  const m = manifest as { exports?: Record<string, unknown>; bin?: Record<string, unknown> };
  const exported = m.exports?.["."];
  const bin = m.bin !== undefined ? Object.values(m.bin)[0] : undefined;
  const found = typeof exported === "string" ? exported : typeof bin === "string" ? bin : null;
  if (found === null) throw new Error("The Copilot package does not name its program.");
  return found.replace(/^\.\//u, "");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/server && npx vitest run test/builtin-copilot-package.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/coding-agents/builtin/copilot-package.ts packages/server/test/builtin-copilot-package.test.ts
git commit -m "feat(server): the Copilot platform package Penguin downloads"
```

### Task 5: Verified download and install

**Files:**
- Create: `packages/server/src/coding-agents/builtin/runtime-install.ts`
- Create: `packages/server/test/fixtures/builtin-registry.ts`
- Test: `packages/server/test/builtin-runtime-install.test.ts` (create)

**Interfaces:**
- Consumes: `binaryFromManifest` (Task 4); `spawnTarget` (Task 1, from `@prismshadow/penguin-coding-agents`).
- Produces:

```ts
export interface InstallRequest {
  registry: string;          // base URL, no trailing slash
  packageName: string;
  version: string;
  runtimesDir: string;       // <data root>/runtimes/copilot
  signal?: AbortSignal;
  onProgress?: (received: number, total: number | null) => void;
}
export interface InstalledRuntime {
  version: string;
  dir: string;               // <runtimesDir>/<version>
  program: string;           // absolute path to the program
  reportedVersion: string;   // first line of `<program> --version`
}
export class RuntimeInstallError extends Error {
  readonly kind: "network" | "integrity" | "start" | "cancelled";
}
export function installRuntime(req: InstallRequest): Promise<InstalledRuntime>;
export function installedRuntime(runtimesDir: string, version: string): Promise<InstalledRuntime | null>; // no --version call
export function cleanRuntimes(runtimesDir: string, keepVersion: string | null): Promise<void>;
```

`fakeRegistry(opts)` in the fixture returns `{ url, close(), requests: string[] }`. It serves `/<name>/<version>` metadata and `/-/tarball.tgz`, built from a stub program that prints `1.0.0-test` for `--version` and otherwise runs `server/test/coding-agents-agent.mjs`.

- [ ] **Step 1: Write the fake registry fixture**

Create `packages/server/test/fixtures/builtin-registry.ts`:

```ts
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
}): Promise<FakeRegistry> {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "builtin-registry-"));
  const pkg = path.join(work, "package");
  await fs.mkdir(pkg);
  const win = process.platform === "win32";
  const program = win ? "copilot.cmd" : "copilot";
  await fs.writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({ name: opts.packageName, version: opts.version, exports: { ".": `./${program}` } }),
  );
  await fs.writeFile(
    path.join(pkg, program),
    win
      ? `@echo off\r\nif "%~1"=="--version" (echo 1.0.0-test& exit /b 0)\r\n"${process.execPath}" "${AGENT_MAIN}" %*\r\n`
      : `#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.0.0-test; exit 0; fi\nexec "${process.execPath}" "${AGENT_MAIN}" "$@"\n`,
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
      res.end(JSON.stringify({ version: opts.version, dist: { tarball: `${base}/-/tarball.tgz`, integrity } }));
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
```

The package name contains a `/` (`@github/copilot-win32-x64`). npm registries take it unencoded in the path, as `/@github/copilot-win32-x64/1.0.88`, so `installRuntime` must request it that way.

- [ ] **Step 2: Write the failing install tests**

Create `packages/server/test/builtin-runtime-install.test.ts`:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RuntimeInstallError,
  cleanRuntimes,
  installRuntime,
  installedRuntime,
} from "../src/coding-agents/builtin/runtime-install.js";
import { fakeRegistry, type FakeRegistry } from "./fixtures/builtin-registry.js";

const NAME = "@github/copilot-test-x64";

describe("runtime install", () => {
  let dir: string;
  let registry: FakeRegistry | null = null;
  beforeEach(async () => {
    dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "runtimes-")), "copilot");
  });
  afterEach(async () => {
    await registry?.close();
    registry = null;
    await fs.rm(path.dirname(dir), { recursive: true, force: true });
  });

  it("downloads, verifies, unpacks into <version>/ and runs --version", async () => {
    registry = await fakeRegistry({ packageName: NAME, version: "9.9.9" });
    const progress: number[] = [];
    const installed = await installRuntime({
      registry: registry.url,
      packageName: NAME,
      version: "9.9.9",
      runtimesDir: dir,
      onProgress: (received) => progress.push(received),
    });
    expect(installed.dir).toBe(path.join(dir, "9.9.9"));
    expect(installed.reportedVersion).toBe("1.0.0-test");
    expect(progress.at(-1)).toBeGreaterThan(0);
    expect(registry.requests[0]).toBe(`/${NAME}/9.9.9`);
    expect(await installedRuntime(dir, "9.9.9")).toMatchObject({ program: installed.program });
    expect((await fs.readdir(dir)).filter((n) => n.startsWith(".incoming-"))).toEqual([]);
  });

  it("discards a download whose checksum does not match, keeping the installed version", async () => {
    registry = await fakeRegistry({ packageName: NAME, version: "1.0.0" });
    await installRuntime({ registry: registry.url, packageName: NAME, version: "1.0.0", runtimesDir: dir });
    await registry.close();
    registry = await fakeRegistry({ packageName: NAME, version: "2.0.0", corrupt: true });
    await expect(
      installRuntime({ registry: registry.url, packageName: NAME, version: "2.0.0", runtimesDir: dir }),
    ).rejects.toMatchObject({ kind: "integrity" });
    expect(await installedRuntime(dir, "1.0.0")).not.toBeNull();
    expect(await installedRuntime(dir, "2.0.0")).toBeNull();
    expect((await fs.readdir(dir)).filter((n) => n.startsWith(".incoming-"))).toEqual([]);
  });

  it("reports a cut-off download as a network failure and leaves nothing behind", async () => {
    registry = await fakeRegistry({ packageName: NAME, version: "1.0.0", truncate: true });
    await expect(
      installRuntime({ registry: registry.url, packageName: NAME, version: "1.0.0", runtimesDir: dir }),
    ).rejects.toBeInstanceOf(RuntimeInstallError);
    expect(await installedRuntime(dir, "1.0.0")).toBeNull();
  });

  it("stops on cancel", async () => {
    let release!: () => void;
    registry = await fakeRegistry({
      packageName: NAME,
      version: "1.0.0",
      hold: new Promise<void>((r) => (release = r)),
    });
    const controller = new AbortController();
    const pending = installRuntime({
      registry: registry.url,
      packageName: NAME,
      version: "1.0.0",
      runtimesDir: dir,
      signal: controller.signal,
    });
    controller.abort();
    release();
    await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
    expect(await installedRuntime(dir, "1.0.0")).toBeNull();
  });

  it("cleans leftover incoming folders and other versions", async () => {
    await fs.mkdir(path.join(dir, ".incoming-abc"), { recursive: true });
    await fs.mkdir(path.join(dir, "0.1.0"), { recursive: true });
    await fs.mkdir(path.join(dir, "0.2.0"), { recursive: true });
    await cleanRuntimes(dir, "0.2.0");
    expect((await fs.readdir(dir)).sort()).toEqual(["0.2.0"]);
    await cleanRuntimes(path.join(dir, "missing"), null); // no throw on a missing folder
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd packages/server && npx vitest run test/builtin-runtime-install.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

Create `packages/server/src/coding-agents/builtin/runtime-install.ts`:

```ts
/**
 * Download and install one npm platform package as a runtime Penguin runs itself: metadata from
 * the registry, the tarball checked against the checksum the registry publishes, unpacked into a
 * temporary folder and renamed into `<runtimesDir>/<version>` in one step, then started once with
 * --version. A failed, cut-off or cancelled download never replaces a working version. Uses the
 * global fetch, which the server routes through its proxy settings (net/proxy.ts).
 */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnTarget } from "@prismshadow/penguin-coding-agents";
import * as tar from "tar";
import { binaryFromManifest } from "./copilot-package.js";

export interface InstallRequest {
  registry: string;
  packageName: string;
  version: string;
  runtimesDir: string;
  signal?: AbortSignal;
  onProgress?: (received: number, total: number | null) => void;
}

export interface InstalledRuntime {
  version: string;
  dir: string;
  program: string;
  reportedVersion: string;
}

export class RuntimeInstallError extends Error {
  constructor(
    readonly kind: "network" | "integrity" | "start" | "cancelled",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "RuntimeInstallError";
  }
}

const INCOMING = ".incoming-";

export async function installRuntime(req: InstallRequest): Promise<InstalledRuntime> {
  await fs.mkdir(req.runtimesDir, { recursive: true });
  const incoming = path.join(req.runtimesDir, `${INCOMING}${randomUUID().slice(0, 8)}`);
  try {
    const meta = await fetchJson(`${req.registry}/${req.packageName}/${req.version}`, req.signal);
    const dist = (meta as { dist?: { tarball?: unknown; integrity?: unknown } }).dist;
    if (typeof dist?.tarball !== "string" || typeof dist.integrity !== "string") {
      throw new RuntimeInstallError("network", "The registry did not describe the package download.");
    }
    await fs.mkdir(incoming);
    const archive = path.join(incoming, "package.tgz");
    await download(dist.tarball, dist.integrity, archive, req);
    const unpacked = path.join(incoming, "unpacked");
    await fs.mkdir(unpacked);
    await tar.extract({ file: archive, cwd: unpacked, strip: 1 });
    await fs.rm(archive);
    const target = path.join(req.runtimesDir, req.version);
    await fs.rm(target, { recursive: true, force: true });
    await fs.rename(unpacked, target);
    const installed = await installedRuntime(req.runtimesDir, req.version);
    if (installed === null) throw new RuntimeInstallError("start", "The package did not unpack a program.");
    const reportedVersion = await versionOf(installed.program).catch(async (error: unknown) => {
      await fs.rm(target, { recursive: true, force: true });
      throw new RuntimeInstallError("start", `The program did not start: ${(error as Error).message}`, {
        cause: error,
      });
    });
    return { ...installed, reportedVersion };
  } catch (error) {
    if (req.signal?.aborted) throw new RuntimeInstallError("cancelled", "The download was cancelled.");
    if (error instanceof RuntimeInstallError) throw error;
    throw new RuntimeInstallError("network", (error as Error).message, { cause: error });
  } finally {
    await fs.rm(incoming, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The runtime already unpacked for `version`, or null. Does not start it. */
export async function installedRuntime(
  runtimesDir: string,
  version: string,
): Promise<InstalledRuntime | null> {
  const dir = path.join(runtimesDir, version);
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8")) as unknown;
    const program = path.join(dir, binaryFromManifest(manifest));
    await fs.access(program);
    return { version, dir, program, reportedVersion: "" };
  } catch {
    return null;
  }
}

/** Remove leftover incoming folders and every version but `keepVersion`. Best-effort. */
export async function cleanRuntimes(runtimesDir: string, keepVersion: string | null): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(runtimesDir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name !== keepVersion)
      .map((name) => fs.rm(path.join(runtimesDir, name), { recursive: true, force: true }).catch(() => undefined)),
  );
}

async function fetchJson(url: string, signal: AbortSignal | undefined): Promise<unknown> {
  const res = await fetch(url, { ...(signal ? { signal } : {}), headers: { accept: "application/json" } });
  if (!res.ok) throw new RuntimeInstallError("network", `The registry answered ${res.status} for ${url}.`);
  return res.json();
}

async function download(url: string, integrity: string, file: string, req: InstallRequest): Promise<void> {
  const res = await fetch(url, req.signal ? { signal: req.signal } : {});
  if (!res.ok || res.body === null) {
    throw new RuntimeInstallError("network", `The download answered ${res.status}.`);
  }
  const header = res.headers.get("content-length");
  const total = header !== null ? Number(header) : null;
  const [algorithm, expected] = integrity.split("-", 2) as [string, string];
  const hash = createHash(algorithm);
  const out = createWriteStream(file);
  let received = 0;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", resolve));
      req.onProgress?.(received, total);
    }
  } finally {
    await new Promise<void>((resolve) => out.end(resolve));
  }
  if (total !== null && received !== total) {
    throw new RuntimeInstallError("network", "The download stopped before it finished.");
  }
  if (hash.digest("base64") !== expected) {
    throw new RuntimeInstallError(
      "integrity",
      "The download did not match its published checksum and was discarded.",
    );
  }
}

function versionOf(program: string): Promise<string> {
  const [file, args] = spawnTarget(program, ["--version"]);
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: 30_000, windowsHide: true, ...(file !== program ? { windowsVerbatimArguments: true } : {}) },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.trim().split(/\r?\n/u)[0] ?? "");
      },
    );
  });
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd packages/server && npx vitest run test/builtin-runtime-install.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/coding-agents/builtin/runtime-install.ts packages/server/test/fixtures/builtin-registry.ts packages/server/test/builtin-runtime-install.test.ts
git commit -m "feat(server): verified download and install of agent runtimes"
```

### Task 6: BuiltinAgentsService and routes

**Files:**
- Create: `packages/server/src/mechanisms/builtin-agents.ts`
- Create: `packages/server/src/coding-agents/builtin/service.ts`
- Modify: `packages/server/src/api/types.ts`
- Modify: `packages/server/src/coding-agents/routes.ts`
- Modify: `packages/server/src/http/routes/coding-agents.ts`
- Modify: `packages/server/src/platform.ts:357-361`
- Modify: `packages/server/src/ifaces.json` (regenerated)
- Test: `packages/server/test/builtin-agents.test.ts` (create)

**Interfaces:**
- Consumes:
  - `CodingAgents.saveBuiltinDefinition`, `removeBuiltinDefinition` (Task 2). `CodingAgents.listDefinitionsForBuiltin(): AgentServerDefinition[]` is added in this task's Step 4.
  - `installRuntime`, `installedRuntime`, `cleanRuntimes`, `RuntimeInstallError` (Task 5)
  - `COPILOT_VERSION`, `copilotPackageName`, `isMuslLinux` (Task 4)
- Produces (API types):

```ts
export type BuiltinAgentStatus = "not-installed" | "downloading" | "ready" | "update-available" | "failed" | "unsupported";
export interface BuiltinAgentInfo {
  id: "copilot";
  agentId: "copilot-builtin";
  title: string;
  status: BuiltinAgentStatus;
  installedVersion: string | null;
  pinnedVersion: string;
  /** Bytes, for the "about N MB" note; null when unknown. */
  downloadSize: number | null;
  progress: { received: number; total: number | null } | null;
  tokenMasked: string | null;
  /** Why the last attempt failed, or why the machine is unsupported. */
  message: string | null;
}
export interface BuiltinAgentsResponse { agents: BuiltinAgentInfo[] }
export interface BuiltinSetupRequest { token?: string }
```

- Produces (mechanism `BuiltinAgents`): `list(): BuiltinAgentInfo[]`, `startSetup(id: "copilot", token?: string): BuiltinAgentInfo` (not `setup`, which is the kernel's lifecycle hook), `cancel(id: "copilot"): void`, `replaceToken(id: "copilot", token: string): BuiltinAgentInfo`, `remove(id: "copilot"): Promise<void>`.
- Routes (admin only):
  - `GET /api/coding-agents/builtin`
  - `POST /api/coding-agents/builtin/copilot/setup`
  - `POST …/copilot/cancel`
  - `PUT …/copilot/token`
  - `DELETE …/copilot`

- [ ] **Step 1: Write the failing route tests**

Create `packages/server/test/builtin-agents.test.ts`:

```ts
/**
 * Built-in Copilot over HTTP against a local registry: setup downloads and registers a
 * coding agent that starts over ACP, one download for concurrent clicks, token replace and
 * removal, admin-only, and a stable state for an unsupported or failed download.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  BuiltinAgentsResponse,
  CodingAgentTestResult,
  CodingAgentsResponse,
} from "../src/api/types.js";
import { COPILOT_VERSION, copilotPackageName, isMuslLinux } from "../src/coding-agents/builtin/copilot-package.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { fakeRegistry, type FakeRegistry } from "./fixtures/builtin-registry.js";

const PAT = "github_pat_11EXAMPLE0000000000000000abcd";

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("state never settled");
}

describe("built-in copilot", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let registry: FakeRegistry;
  const packageName = copilotPackageName(process.platform, process.arch, isMuslLinux())!;

  beforeEach(async () => {
    registry = await fakeRegistry({ packageName, version: COPILOT_VERSION });
    process.env.PENGUIN_NPM_REGISTRY = registry.url;
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    member = apiClient(t.app, (await provisionUser(t.app, "member_b")).cookie);
  });
  afterEach(async () => {
    delete process.env.PENGUIN_NPM_REGISTRY;
    await t.cleanup();
    await registry.close();
  });

  const state = async () =>
    ((await (await admin.get("/api/coding-agents/builtin")).json()) as BuiltinAgentsResponse).agents[0]!;

  it("starts not set up, admin-only", async () => {
    expect((await member.get("/api/coding-agents/builtin")).status).toBe(403);
    expect(await state()).toMatchObject({ id: "copilot", status: "not-installed", tokenMasked: null });
  });

  it("sets up from a PAT: one download, a registered agent that passes Test", async () => {
    const [a, b] = await Promise.all([
      admin.post("/api/coding-agents/builtin/copilot/setup", { token: PAT }),
      admin.post("/api/coding-agents/builtin/copilot/setup", { token: PAT }),
    ]);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    const ready = await until(state, (s) => s.status !== "downloading");
    expect(ready).toMatchObject({ status: "ready", installedVersion: COPILOT_VERSION, tokenMasked: "gith…abcd" });
    expect(registry.requests.filter((r) => r.endsWith(".tgz"))).toHaveLength(1);

    const agents = ((await (await admin.get("/api/coding-agents/agents")).json()) as CodingAgentsResponse).agents;
    const builtin = agents.find((x) => x.id === "copilot-builtin")!;
    expect(builtin).toMatchObject({ title: "GitHub Copilot (built-in)", args: ["--acp"], builtin: "copilot" });
    expect(builtin.env!.map((e) => e.key).sort()).toEqual(["COPILOT_GITHUB_TOKEN", "COPILOT_HOME"]);

    const test = (await (
      await admin.post("/api/coding-agents/agents/copilot-builtin/test", {})
    ).json()) as CodingAgentTestResult;
    expect(test.failure).not.toBe("start");
  });

  it("requires a token for the first setup, and keeps the stored one after", async () => {
    expect((await admin.post("/api/coding-agents/builtin/copilot/setup", {})).status).toBe(400);
    await admin.post("/api/coding-agents/builtin/copilot/setup", { token: PAT });
    await until(state, (s) => s.status !== "downloading");
    expect((await admin.post("/api/coding-agents/builtin/copilot/setup", {})).status).toBe(202);
    expect((await until(state, (s) => s.status !== "downloading")).tokenMasked).toBe("gith…abcd");
  });

  it("replaces the token and removes everything", async () => {
    await admin.post("/api/coding-agents/builtin/copilot/setup", { token: PAT });
    await until(state, (s) => s.status !== "downloading");
    const replaced = await admin.put("/api/coding-agents/builtin/copilot/token", {
      token: "github_pat_22OTHER00000000000000000wxyz",
    });
    expect(replaced.status).toBe(200);
    expect((await state()).tokenMasked).toBe("gith…wxyz");
    expect((await admin.delete("/api/coding-agents/builtin/copilot")).status).toBe(204);
    expect(await state()).toMatchObject({ status: "not-installed", tokenMasked: null });
    const agents = ((await (await admin.get("/api/coding-agents/agents")).json()) as CodingAgentsResponse).agents;
    expect(agents.some((x) => x.id === "copilot-builtin")).toBe(false);
  });

  it("reports a failed download and keeps no half install", async () => {
    await registry.close();
    registry = await fakeRegistry({ packageName, version: COPILOT_VERSION, corrupt: true });
    process.env.PENGUIN_NPM_REGISTRY = registry.url;
    await admin.post("/api/coding-agents/builtin/copilot/setup", { token: PAT });
    const failed = await until(state, (s) => s.status !== "downloading");
    expect(failed.status).toBe("failed");
    expect(failed.message).toMatch(/checksum/);
    expect(failed.installedVersion).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/server && npx vitest run test/builtin-agents.test.ts`
Expected: FAIL, with 404s on `/api/coding-agents/builtin`.

- [ ] **Step 3: Add types and the mechanism**

Add the **Produces** API types to `packages/server/src/api/types.ts`, after `CodingAgentsResponse`.

Create `packages/server/src/mechanisms/builtin-agents.ts`:

```ts
/**
 * The built-in agents mechanism: agents Penguin downloads, runs and updates itself (Models →
 * Built-in), declared apart from the service that implements it.
 */
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { BuiltinAgentInfo } from "../api/types.js";

export abstract class BuiltinAgents extends Interface<{
  list(): BuiltinAgentInfo[];
  /**
   * Store the token (when given) and start downloading the pinned runtime; answers at once
   * with the downloading state. A first setup needs a token. A second call while one is
   * downloading joins it. Not named `setup`: that is the kernel's lifecycle hook.
   */
  startSetup(id: "copilot", token?: string): BuiltinAgentInfo;
  cancel(id: "copilot"): void;
  replaceToken(id: "copilot", token: string): BuiltinAgentInfo;
  /** Delete the runtime, the token and the agent definition. Past sessions stay readable. */
  remove(id: "copilot"): Promise<void>;
}>() {}
```

Before writing this, look at how `mechanisms/coding-agents.ts` closes its `Interface<{…}>` declaration, and copy it exactly.

- [ ] **Step 4: Implement the service**

Create `packages/server/src/coding-agents/builtin/service.ts`:

```ts
/**
 * Built-in agents: GitHub Copilot, run from the Copilot CLI's own platform package, which this
 * service downloads into the data root and registers as an ordinary coding agent
 * (`copilot-builtin`, over ACP) with the admin's PAT as COPILOT_GITHUB_TOKEN. Download state
 * lives here; the definition and its variables live with the other coding agents.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import fs from "node:fs/promises";
import path from "node:path";
import type { BuiltinAgentInfo } from "../../api/types.js";
import { Config } from "../../hmr/capabilities.js";
import { BuiltinAgents } from "../../mechanisms/builtin-agents.js";
import { CodingAgents } from "../../mechanisms/coding-agents.js";
import { maskApiKey } from "../../services/project-config-service.js";
import { COPILOT_VERSION, copilotPackageName, isMuslLinux } from "./copilot-package.js";
import {
  RuntimeInstallError,
  cleanRuntimes,
  installRuntime,
  installedRuntime,
} from "./runtime-install.js";

const AGENT_ID = "copilot-builtin";
const TITLE = "GitHub Copilot (built-in)";

@Component()
export class BuiltinAgentsService implements BuiltinAgents {
  @Use() private readonly config!: Config;
  @Use() private readonly codingAgents!: CodingAgents;

  private download: {
    controller: AbortController;
    received: number;
    total: number | null;
  } | null = null;
  private failure: string | null = null;
  private installed: string | null = null;
  private readonly packageName = copilotPackageName(process.platform, process.arch, isMuslLinux());

  async setup(): Promise<void> {
    const definition = this.definition();
    const version = definition !== undefined ? this.versionOfCommand(definition.command) : null;
    this.installed = version !== null && (await installedRuntime(this.runtimesDir(), version)) ? version : null;
    await cleanRuntimes(this.runtimesDir(), this.installed);
  }
```

`setup()` above is the kernel lifecycle hook, as in `coding-agents/routes.ts`; `platform.ts:184` shows it may be `async`. The mechanism's method is `startSetup`, so the two never clash. The route path stays `/setup`.

Continue the class:

```ts
  list(): BuiltinAgentInfo[] {
    return [this.info()];
  }

  startSetup(id: "copilot", token?: string): BuiltinAgentInfo {
    void id;
    if (this.packageName === null) return this.info();
    const stored = this.definition()?.env?.COPILOT_GITHUB_TOKEN;
    const pat = token?.trim() || stored;
    if (pat === undefined || pat === "") {
      throw new RuntimeInstallError("start", "Paste a GitHub personal access token to set up Copilot.");
    }
    if (token !== undefined && this.installed !== null) this.writeDefinition(this.installed, pat);
    this.pendingToken = pat;
    if (this.download === null) void this.run(pat);
    return this.info();
  }

  cancel(): void {
    this.download?.controller.abort();
  }

  replaceToken(_id: "copilot", token: string): BuiltinAgentInfo {
    const pat = token.trim();
    if (pat === "") throw new RuntimeInstallError("start", "Paste a GitHub personal access token.");
    if (this.installed === null) throw new RuntimeInstallError("start", "Set up Copilot first.");
    this.writeDefinition(this.installed, pat);
    return this.info();
  }

  async remove(): Promise<void> {
    this.download?.controller.abort();
    this.codingAgents.removeBuiltinDefinition(AGENT_ID);
    this.installed = null;
    this.failure = null;
    await fs.rm(this.runtimesDir(), { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(this.copilotHome(), { recursive: true, force: true }).catch(() => undefined);
  }

  // --- internals ---------------------------------------------------------------------------

  private pendingToken: string | null = null;

  private async run(token: string): Promise<void> {
    const controller = new AbortController();
    this.download = { controller, received: 0, total: null };
    this.failure = null;
    try {
      const runtime = await installRuntime({
        registry: (process.env.PENGUIN_NPM_REGISTRY ?? "https://registry.npmjs.org").replace(/\/+$/u, ""),
        packageName: this.packageName!,
        version: COPILOT_VERSION,
        runtimesDir: this.runtimesDir(),
        signal: controller.signal,
        onProgress: (received, total) => {
          if (this.download !== null) this.download = { ...this.download, received, total };
        },
      });
      this.writeDefinition(runtime.version, this.pendingToken ?? token);
      const previous = this.installed;
      this.installed = runtime.version;
      if (previous !== null && previous !== runtime.version) {
        await cleanRuntimes(this.runtimesDir(), runtime.version);
      }
    } catch (error) {
      this.failure =
        error instanceof RuntimeInstallError && error.kind === "cancelled"
          ? null
          : `Could not set up Copilot: ${(error as Error).message}`;
    } finally {
      this.download = null;
      this.pendingToken = null;
    }
  }

  private writeDefinition(version: string, token: string): void {
    const program = this.programPath(version);
    this.codingAgents.saveBuiltinDefinition({
      id: AGENT_ID,
      title: TITLE,
      command: program,
      args: ["--acp"],
      env: { COPILOT_GITHUB_TOKEN: token, COPILOT_HOME: this.copilotHome() },
      builtin: "copilot",
    });
  }

  private info(): BuiltinAgentInfo {
    const definition = this.definition();
    const token = definition?.env?.COPILOT_GITHUB_TOKEN;
    const status: BuiltinAgentInfo["status"] =
      this.packageName === null
        ? "unsupported"
        : this.download !== null
          ? "downloading"
          : this.failure !== null
            ? "failed"
            : this.installed === null
              ? "not-installed"
              : this.installed !== COPILOT_VERSION
                ? "update-available"
                : "ready";
    return {
      id: "copilot",
      agentId: AGENT_ID,
      title: TITLE,
      status,
      installedVersion: this.installed,
      pinnedVersion: COPILOT_VERSION,
      downloadSize: this.download?.total ?? null,
      progress: this.download === null ? null : { received: this.download.received, total: this.download.total },
      tokenMasked: token !== undefined && this.installed !== null ? maskApiKey(token) : null,
      message:
        this.packageName === null
          ? `Copilot has no build for this machine (${process.platform}-${process.arch}).`
          : this.failure,
    };
  }

  private definition() {
    return this.codingAgents
      .listDefinitionsForBuiltin()
      .find((d) => d.id === AGENT_ID && d.builtin === "copilot");
  }

  private runtimesDir(): string {
    return path.join(this.config.root, "runtimes", "copilot");
  }

  private copilotHome(): string {
    return path.join(this.config.root, "coding-agents", AGENT_ID, "copilot-home");
  }

  /** The version folder a saved command points into, or null. */
  private versionOfCommand(command: string): string | null {
    const relative = path.relative(this.runtimesDir(), command);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return relative.split(path.sep)[0] ?? null;
  }

  private programPath(version: string): string {
    // installRuntime returned it, but writeDefinition also runs for a token-only update.
    return this.cachedProgram.get(version) ?? path.join(this.runtimesDir(), version, "copilot");
  }

  private readonly cachedProgram = new Map<string, string>();
}
```

Record the real program path from the install result rather than guessing it: in `run`, call `this.cachedProgram.set(runtime.version, runtime.program)` before `writeDefinition`. In `setup()`, after `installedRuntime(...)` succeeds, store its `program` the same way. Then `programPath` never falls back in practice. Keep the fallback only as a type-level default.

The service reads definitions with their real env, which `listAgents` deliberately masks. Add a method to the `CodingAgents` mechanism (Task 2's file) and implement it in `service.ts`:

```ts
  /** For the built-in agents service only: definitions with their env, to read its own token. */
  listDefinitionsForBuiltin(): AgentServerDefinition[];
```

```ts
  listDefinitionsForBuiltin(): AgentServerDefinition[] {
    return this.loadDefinitions().filter((d) => d.builtin !== undefined);
  }
```

- [ ] **Step 5: Register the service and add the routes**

In `packages/server/src/platform.ts`, import `BuiltinAgentsService` and `BuiltinAgents`, then change the module:

```ts
@Module({
  children: [CodingAgentService, BuiltinAgentsService, CodingAgentsRoutes],
  exports: [CodingAgents, BuiltinAgents],
})
export class CodingAgentsModule {}
```

In `packages/server/src/coding-agents/routes.ts`, add `@Use() private readonly builtinAgents!: BuiltinAgents;` and pass `builtinAgents: this.builtinAgents` into `codingAgentsRoutes({...})`.

In `packages/server/src/http/routes/coding-agents.ts`:
- Add `builtinAgents: BuiltinAgents` to `CodingAgentsRouteDeps`, and import the type.
- Add the five routes to the header comment.
- Add the handlers:

```ts
  const requireAdmin = (c: Context<AppEnv>) => {
    if (!c.var.user.isAdmin) throw new HttpError(403, "forbidden", "Admin access is required.");
  };
  const requireCopilot = (c: Context<AppEnv>) => {
    if (c.req.param("id") !== "copilot") throw new HttpError(404, "not_found", "No such built-in agent.");
  };
  const builtinCall = <T>(work: () => T): T => {
    try {
      return work();
    } catch (error) {
      if (error instanceof Error && error.name === "RuntimeInstallError") throw badRequest(error.message);
      throw error;
    }
  };

  app.get("/builtin", (c) => {
    requireAdmin(c);
    return c.json({ agents: deps.builtinAgents.list() });
  });

  app.post("/builtin/:id/setup", async (c) => {
    requireAdmin(c);
    requireCopilot(c);
    const body = (await readJson(c)) as { token?: unknown };
    if (body.token !== undefined && typeof body.token !== "string") throw badRequest("token must be a string.");
    const token = body.token as string | undefined;
    return c.json({ agent: builtinCall(() => deps.builtinAgents.startSetup("copilot", token)) }, 202);
  });

  app.post("/builtin/:id/cancel", (c) => {
    requireAdmin(c);
    requireCopilot(c);
    deps.builtinAgents.cancel("copilot");
    return c.body(null, 204);
  });

  app.put("/builtin/:id/token", async (c) => {
    requireAdmin(c);
    requireCopilot(c);
    const token = requireString(await readJson(c), "token", { maxLen: 8192, label: "token" });
    return c.json({ agent: builtinCall(() => deps.builtinAgents.replaceToken("copilot", token)) });
  });

  app.delete("/builtin/:id", async (c) => {
    requireAdmin(c);
    requireCopilot(c);
    await deps.builtinAgents.remove("copilot");
    return c.body(null, 204);
  });
```

If `readJson` rejects an empty body, then `setup` with `{}` from the tests is fine, since the tests always send a JSON object.

- [ ] **Step 6: Run the tests and the type check**

Run: `cd packages/server && npx vitest run test/builtin-agents.test.ts test/builtin-runtime-install.test.ts test/coding-agent-env.test.ts test/coding-agents.test.ts && cd ../.. && pnpm gen:ifaces && cd packages/server && npx tsc --noEmit -p .`
Expected: all pass; `ifaces.json` regenerated; no type errors.

If the Test assertion (`failure !== "start"`) fails because the fake agent cannot start through `.cmd` under the sandboxed env, check that the stub quotes `process.execPath`. The node path contains `Program Files`.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src packages/server/test
git commit -m "feat(server): built-in GitHub Copilot, downloaded and run on a PAT"
```

### Task 7: The Built-in tab

**Files:**
- Create: `packages/web/src/features/models/builtin-model.ts`
- Create: `packages/web/src/features/models/builtin-panel.tsx`
- Modify: `packages/web/src/features/models/models-page.tsx:713-735`, `:1118-1128`
- Modify: `packages/web/src/features/chat/coding-agent-models.ts` (`VENDOR_LOGOS`)
- Modify: `packages/web/src/api/endpoints.ts`
- Modify: `packages/web/src/lib/strings-en.ts`, `packages/web/src/lib/strings-types.ts`
- Create: `changelog/unreleased/2026-09-25-builtin-copilot.md`
- Test: `packages/web/test/builtin-model.test.ts` (create)

**Interfaces:**
- Consumes: `BuiltinAgentInfo`, `BuiltinAgentsResponse` and the routes (Task 6).
- Produces:
  - `builtinActions(info: BuiltinAgentInfo): { setup: boolean; cancel: boolean; test: boolean; replaceToken: boolean; update: boolean; remove: boolean; retry: boolean; needsToken: boolean }`
  - `progressPercent(info: BuiltinAgentInfo): number | null`
  - endpoints: `listBuiltinAgents`, `setupBuiltinCopilot(token?: string)`, `cancelBuiltinCopilot`, `replaceBuiltinCopilotToken(token: string)`, `removeBuiltinCopilot`

- [ ] **Step 1: Write the failing view-model tests**

```ts
import { describe, expect, it } from "vitest";
import type { BuiltinAgentInfo } from "@prismshadow/penguin-server/api";
import { builtinActions, progressPercent } from "../src/features/models/builtin-model";

const base: BuiltinAgentInfo = {
  id: "copilot",
  agentId: "copilot-builtin",
  title: "GitHub Copilot (built-in)",
  status: "not-installed",
  installedVersion: null,
  pinnedVersion: "1.0.88",
  downloadSize: null,
  progress: null,
  tokenMasked: null,
  message: null,
};

describe("built-in card actions", () => {
  it("offers setup with a token field when not set up", () => {
    expect(builtinActions(base)).toMatchObject({ setup: true, needsToken: true, test: false, remove: false });
  });
  it("offers only cancel while downloading", () => {
    const a = builtinActions({ ...base, status: "downloading", progress: { received: 5, total: 10 } });
    expect(a).toEqual({ setup: false, cancel: true, test: false, replaceToken: false, update: false, remove: false, retry: false, needsToken: false });
  });
  it("offers test, replace token and remove when ready, plus update when a new version is pinned", () => {
    const ready = { ...base, status: "ready" as const, installedVersion: "1.0.88", tokenMasked: "gith…abcd" };
    expect(builtinActions(ready)).toMatchObject({ test: true, replaceToken: true, remove: true, update: false });
    expect(builtinActions({ ...ready, status: "update-available", installedVersion: "1.0.80" })).toMatchObject({ update: true, test: true });
  });
  it("offers retry after a failure, asking for a token only when none is stored", () => {
    expect(builtinActions({ ...base, status: "failed", message: "x" })).toMatchObject({ retry: true, needsToken: true });
    expect(builtinActions({ ...base, status: "failed", message: "x", installedVersion: "1.0.80", tokenMasked: "gith…abcd" })).toMatchObject({ retry: true, needsToken: false, test: true });
  });
  it("offers nothing on an unsupported machine", () => {
    expect(Object.values(builtinActions({ ...base, status: "unsupported" })).some(Boolean)).toBe(false);
  });
  it("turns progress into a percentage when the size is known", () => {
    expect(progressPercent({ ...base, status: "downloading", progress: { received: 25, total: 100 } })).toBe(25);
    expect(progressPercent({ ...base, status: "downloading", progress: { received: 25, total: null } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/web && npx vitest run test/builtin-model.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the view model and endpoints**

Create `packages/web/src/features/models/builtin-model.ts`:

```ts
/** What a built-in agent's card offers in each state (Models → Built-in). */
import type { BuiltinAgentInfo } from "@prismshadow/penguin-server/api";

export function builtinActions(info: BuiltinAgentInfo) {
  const installed = info.installedVersion !== null;
  const none = { setup: false, cancel: false, test: false, replaceToken: false, update: false, remove: false, retry: false, needsToken: false };
  switch (info.status) {
    case "unsupported":
      return none;
    case "downloading":
      return { ...none, cancel: true };
    case "not-installed":
      return { ...none, setup: true, needsToken: true };
    case "failed":
      return { ...none, retry: true, needsToken: info.tokenMasked === null, test: installed, replaceToken: installed, remove: installed };
    case "update-available":
      return { ...none, update: true, test: true, replaceToken: true, remove: true };
    case "ready":
      return { ...none, test: true, replaceToken: true, remove: true };
  }
}

export function progressPercent(info: BuiltinAgentInfo): number | null {
  const p = info.progress;
  if (p === null || p.total === null || p.total === 0) return null;
  return Math.min(100, Math.round((p.received / p.total) * 100));
}
```

In `packages/web/src/api/endpoints.ts`, after `setCodingAgentEnv`:

```ts
// --- Built-in agents (Models → Built-in) ------------------------------------------------

export const listBuiltinAgents = () => apiFetch<BuiltinAgentsResponse>("/api/coding-agents/builtin");
export const setupBuiltinCopilot = (token?: string) =>
  apiFetch<{ agent: BuiltinAgentInfo }>("/api/coding-agents/builtin/copilot/setup", {
    method: "POST",
    body: token !== undefined ? { token } : {},
  });
export const cancelBuiltinCopilot = () =>
  apiFetch<void>("/api/coding-agents/builtin/copilot/cancel", { method: "POST", body: {} });
export const replaceBuiltinCopilotToken = (token: string) =>
  apiFetch<{ agent: BuiltinAgentInfo }>("/api/coding-agents/builtin/copilot/token", {
    method: "PUT",
    body: { token },
  });
export const removeBuiltinCopilot = () =>
  apiFetch<void>("/api/coding-agents/builtin/copilot", { method: "DELETE" });
```

Import `BuiltinAgentInfo` and `BuiltinAgentsResponse`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/web && npx vitest run test/builtin-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Strings**

`strings-types.ts`, in `models`:

```ts
    viewBuiltin: string;
    builtinIntro: string;
    builtinCopilotAbout: string;
    builtinDownloadSize: (mb: number) => string;
    builtinTokenLabel: string;
    builtinTokenHint: string;
    builtinTokenCreate: string;
    builtinTerms: string;
    builtinTermsLink: string;
    builtinSetup: string;
    builtinDownloading: (percent: number | null) => string;
    builtinCancel: string;
    builtinReady: (version: string) => string;
    builtinUpdateAvailable: (installed: string, pinned: string) => string;
    builtinUpdate: string;
    builtinRetry: string;
    builtinReplaceToken: string;
    builtinReplaceTokenTitle: string;
    builtinToken: (masked: string) => string;
    builtinRemove: string;
    builtinRemoveTitle: string;
    builtinRemoveBody: string;
    builtinPatHint: string;
```

`strings-en.ts`:

```ts
    viewBuiltin: "Built-in",
    builtinIntro:
      "Agents Penguin downloads, runs and updates for you. You give it a token; nothing is installed on the server machine by hand.",
    builtinCopilotAbout:
      "GitHub Copilot, run from GitHub's own Copilot program. Penguin downloads it into its data folder and runs it with your personal access token.",
    builtinDownloadSize: (mb) => `Downloads about ${mb} MB.`,
    builtinTokenLabel: "GitHub personal access token",
    builtinTokenHint: "A fine-grained token (github_pat_…) with the Copilot Requests permission.",
    builtinTokenCreate: "Create a token on GitHub",
    builtinTerms: "Setting up accepts the GitHub Copilot CLI license.",
    builtinTermsLink: "Read the license",
    builtinSetup: "Set up",
    builtinDownloading: (percent) => (percent === null ? "Downloading…" : `Downloading… ${percent}%`),
    builtinCancel: "Cancel",
    builtinReady: (version) => `Ready · version ${version}`,
    builtinUpdateAvailable: (installed, pinned) => `Version ${installed} installed; ${pinned} is available.`,
    builtinUpdate: "Update",
    builtinRetry: "Try again",
    builtinReplaceToken: "Replace token",
    builtinReplaceTokenTitle: "Replace the token",
    builtinToken: (masked) => `Token ${masked}`,
    builtinRemove: "Remove",
    builtinRemoveTitle: "Remove built-in Copilot?",
    builtinRemoveBody:
      "Deletes the downloaded program and the stored token. Sessions that used it stay readable in history.",
    builtinPatHint:
      "If a session is refused, check that the token has not expired and has the Copilot Requests permission.",
```

- [ ] **Step 6: Build the panel**

Create `packages/web/src/features/models/builtin-panel.tsx`:

```tsx
/**
 * Models → Built-in: agents Penguin downloads, runs and updates itself. One card for GitHub
 * Copilot: paste a PAT, Set up, and it becomes a coding agent like the Local CLI ones. Polls
 * while a download runs. Admin-only, like the routes it calls.
 */
import { useCallback, useEffect, useState } from "react";
import type { BuiltinAgentInfo, CodingAgentTestResult } from "@prismshadow/penguin-server/api";
import {
  cancelBuiltinCopilot,
  listBuiltinAgents,
  removeBuiltinCopilot,
  replaceBuiltinCopilotToken,
  setupBuiltinCopilot,
  testCodingAgent,
} from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk, toneStrip } from "../../lib/tone";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Modal } from "../../components/ui/modal";
import { PasswordInput } from "../../components/ui/password-input";
import { ProviderLogo } from "../../components/ui/provider-logo";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError } from "../../components/ui/toast";
import { builtinActions, progressPercent } from "./builtin-model";

const PAT_URL = "https://github.com/settings/personal-access-tokens/new";
const LICENSE_URL = "https://github.com/github/copilot-cli/blob/main/LICENSE.md";
const APPROX_MB = 150;

export function BuiltinPanel() {
  const [agents, setAgents] = useState<BuiltinAgentInfo[] | null>(null);
  const load = useCallback(() => {
    void listBuiltinAgents()
      .then((res) => setAgents(res.agents))
      .catch((e: unknown) => toastError(apiErrorText(e)));
  }, []);
  useEffect(load, [load]);
  const downloading = agents?.some((a) => a.status === "downloading") === true;
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(load, 1000);
    return () => clearInterval(timer);
  }, [downloading, load]);

  return (
    <section aria-label={S.models.viewBuiltin}>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">{S.models.builtinIntro}</p>
      {agents === null ? (
        <SkeletonList rows={1} />
      ) : (
        <ul className="space-y-2">
          {agents.map((agent) => (
            <CopilotCard key={agent.id} info={agent} onChanged={load} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CopilotCard({ info, onChanged }: { info: BuiltinAgentInfo; onChanged: () => void }) {
  const actions = builtinActions(info);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [tested, setTested] = useState<CodingAgentTestResult | null>(null);
  const act = (work: () => Promise<unknown>) => {
    setBusy(true);
    work()
      .then(onChanged)
      .catch((e: unknown) => toastError(apiErrorText(e)))
      .finally(() => setBusy(false));
  };
  const percent = progressPercent(info);

  return (
    <li className="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex min-w-0 items-center gap-3">
        <ProviderLogo provider="github" className="h-8 w-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{info.title}</div>
          <div className="truncate text-xs text-gray-500 dark:text-gray-400">
            {info.status === "downloading"
              ? S.models.builtinDownloading(percent)
              : info.status === "update-available" && info.installedVersion !== null
                ? S.models.builtinUpdateAvailable(info.installedVersion, info.pinnedVersion)
                : info.installedVersion !== null
                  ? S.models.builtinReady(info.installedVersion)
                  : S.models.builtinDownloadSize(APPROX_MB)}
            {info.tokenMasked !== null && <span className="ml-2 font-mono">{S.models.builtinToken(info.tokenMasked)}</span>}
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {info.status === "not-installed" && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{S.models.builtinCopilotAbout}</p>
        )}
        {info.message !== null && (
          <p role="status" className={`rounded-md border px-3 py-2 text-xs ${toneStrip.danger}`}>
            {info.message}
          </p>
        )}
        {actions.needsToken && (
          <div className="space-y-1.5">
            <PasswordInput
              size="sm"
              label={S.models.builtinTokenLabel}
              hint={S.models.builtinTokenHint}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="font-mono"
              autoComplete="off"
            />
            <a href={PAT_URL} target="_blank" rel="noreferrer" className="text-xs font-medium text-[var(--accent-fg)] underline-offset-2 hover:underline">
              {S.models.builtinTokenCreate}
            </a>
          </div>
        )}
        {(actions.setup || actions.update) && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {S.models.builtinTerms}{" "}
            <a href={LICENSE_URL} target="_blank" rel="noreferrer" className="font-medium text-[var(--accent-fg)] underline-offset-2 hover:underline">
              {S.models.builtinTermsLink}
            </a>
          </p>
        )}
        {tested !== null && (
          <p role="status" className={`rounded-md border px-3 py-2 text-xs ${tested.ok ? toneStrip.success : toneStrip.danger}`}>
            {tested.ok
              ? S.models.cliTestOk(info.title, tested.ms, tested.reply)
              : `${S.models.cliTestStart(info.title, tested.message ?? "")} ${S.models.builtinPatHint}`}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {(actions.setup || actions.retry) && (
            <Button
              size="sm"
              variant="primary"
              disabled={busy || (actions.needsToken && token.trim() === "")}
              onClick={() => act(() => setupBuiltinCopilot(actions.needsToken ? token.trim() : undefined))}
            >
              {actions.setup ? S.models.builtinSetup : S.models.builtinRetry}
            </Button>
          )}
          {actions.update && (
            <Button size="sm" variant="primary" disabled={busy} onClick={() => act(() => setupBuiltinCopilot())}>
              {S.models.builtinUpdate}
            </Button>
          )}
          {actions.cancel && (
            <Button size="sm" disabled={busy} onClick={() => act(cancelBuiltinCopilot)}>
              {S.models.builtinCancel}
            </Button>
          )}
          {actions.test && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setTested(null);
                act(() => testCodingAgent(info.agentId).then(setTested));
              }}
            >
              {S.models.cliTest}
            </Button>
          )}
          {actions.replaceToken && (
            <Button size="sm" disabled={busy} onClick={() => setReplacing(true)}>
              {S.models.builtinReplaceToken}
            </Button>
          )}
          {actions.remove && (
            <Button size="sm" variant="danger" disabled={busy} onClick={() => setRemoving(true)}>
              {S.models.builtinRemove}
            </Button>
          )}
        </div>
      </div>

      <Modal
        open={replacing}
        title={S.models.builtinReplaceTokenTitle}
        onClose={() => setReplacing(false)}
        footer={
          <>
            <Button size="sm" onClick={() => setReplacing(false)}>{S.common.cancel}</Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || token.trim() === ""}
              onClick={() => {
                act(() => replaceBuiltinCopilotToken(token.trim()));
                setToken("");
                setReplacing(false);
              }}
            >
              {S.common.save}
            </Button>
          </>
        }
      >
        <PasswordInput
          size="sm"
          label={S.models.builtinTokenLabel}
          hint={S.models.builtinTokenHint}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="font-mono"
          autoComplete="off"
        />
      </Modal>

      <ConfirmModal
        open={removing}
        title={S.models.builtinRemoveTitle}
        confirmLabel={S.models.builtinRemove}
        onClose={() => setRemoving(false)}
        onConfirm={() => {
          setRemoving(false);
          act(removeBuiltinCopilot);
        }}
      >
        {S.models.builtinRemoveBody}
      </ConfirmModal>
    </li>
  );
}
```

Check that `ProviderLogo` knows `"github"`: `grep -n "github" packages/web/src/components/ui/provider-logo.tsx`. Use whatever key the Local CLI Copilot card resolves to via `codingAgentLogo("copilot", …)`. In `coding-agent-models.ts`, add `"copilot-builtin"` to `VENDOR_LOGOS` with the same value as `copilot`, so the model picker shows the right logo.

`toneInk` is imported only if it ends up used; drop the import otherwise.

- [ ] **Step 7: Add the third tab**

In `models-page.tsx`:

```ts
  const viewParam = searchParams.get("view");
  const view: "local" | "builtin" | "api" =
    viewParam === "local" ? "local" : viewParam === "builtin" && isAdmin ? "builtin" : "api";
```

Find how this page knows the user is an admin (`grep -n "isAdmin\|useAuth" packages/web/src/features/models/models-page.tsx`). If it doesn't, add `const { user } = useAuth(); const isAdmin = user?.isAdmin === true;` using `useAuth` from `../../state/auth`.

```tsx
      <Segmented
        cols={isAdmin ? 3 : 2}
        options={[
          { value: "local", label: S.models.viewLocalCli },
          ...(isAdmin ? [{ value: "builtin", label: S.models.viewBuiltin }] : []),
          { value: "api", label: S.models.viewApiProviders },
        ]}
        value={view}
        onChange={(next) =>
          setSearchParams(
            (params) => {
              if (next === "api") params.delete("view");
              else params.set("view", next);
              return params;
            },
            { replace: true },
          )
        }
      />
```

Widen the wrapper from `max-w-md` to `max-w-lg` if three labels truncate. After the `if (view === "local") {…}` block, add:

```tsx
  if (view === "builtin") {
    return (
      <div className="h-full overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-5xl">
          {viewSwitch}
          <h1 className="mb-2 text-xl font-semibold">{S.models.title}</h1>
          <BuiltinPanel />
        </div>
      </div>
    );
  }
```

Check `Segmented`'s `cols` prop type (`packages/web/src/components/ui/segmented.tsx`). If it is a union like `2 | 3`, the expression above type-checks; if it is fixed, pass `options.length`.

- [ ] **Step 8: Type-check, test, and try it for real**

Run: `cd packages/web && npx tsc --noEmit -p . && npx vitest run test/builtin-model.test.ts test/agent-cards.test.ts test/agent-env.test.ts`
Expected: PASS.

Then the one manual run, on this Windows machine with the dev app running. It needs a real fine-grained PAT with **Copilot Requests**; ask the user to paste it in the UI themselves, and never handle it in the terminal.
1. **Models → Built-in**: the card shows "Downloads about 150 MB". Paste the PAT and click **Set up**. The progress percentage climbs to "Ready · version 1.0.88".
2. Click **Test**. It should pass. If it fails, the card shows Copilot's own reason.
3. **Chat**: "GitHub Copilot (built-in)" appears in the model picker. Send a message.
4. **Activities → test6**: pick it as Generation agent and run one stage.
5. **Models → Local CLI** does not list the built-in. A member account sees no Built-in tab.

- [ ] **Step 9: Changelog and commit**

Create `changelog/unreleased/2026-09-25-builtin-copilot.md`:

```markdown
# GitHub Copilot, built in

- **Date:** 2026-09-25
- **Type:** feat
- **Scope:** `server`, `web`

**Models → Built-in** is a new tab for agents Penguin downloads, runs and updates itself.
Its first is GitHub Copilot: an admin pastes a fine-grained personal access token with the
**Copilot Requests** permission and clicks **Set up**, and Penguin downloads the Copilot
program for the server machine from npm, checks it against its published checksum, and
registers "GitHub Copilot (built-in)" as a coding agent. It then appears in the chat model
picker and the activity editor's Generation agent list, and runs like the other coding
agents, with nothing installed by hand.

The version is pinned with each Penguin release; when a newer one is pinned, the card
offers **Update**. **Replace token** and **Remove** are on the card. The built-in agent
keeps its own Copilot settings folder, apart from any Copilot login on the machine.
Setting the `PENGUIN_NPM_REGISTRY` environment variable points the download at a mirror.
```

```bash
git add packages/web changelog/unreleased/2026-09-25-builtin-copilot.md
git commit -m "feat(web): Models → Built-in, with GitHub Copilot"
```

### Task 8: Whole-branch checks

**Files:** none new.

- [ ] **Step 1: Run every suite this work touched, plus the type checks**

Run each, from the repo root:

```bash
cd packages/coding-agents && npx vitest run && npx tsc --noEmit -p .
```

```bash
cd packages/server && npx vitest run test/coding-agent-env.test.ts test/builtin-agents.test.ts test/builtin-runtime-install.test.ts test/builtin-copilot-package.test.ts test/coding-agents.test.ts test/coding-agent-sessions.test.ts test/coding-agent-adapter-upgrade.test.ts test/coding-agent-model-rows.test.ts test/activity-generation.test.ts && npx tsc --noEmit -p .
```

```bash
cd packages/web && npx vitest run && npx tsc --noEmit -p .
```

Expected: all pass, except the known `model-grouping.test.ts` baseline failure in web. Report any other failure with its output.

- [ ] **Step 2: Confirm the release blocker with the user**

Ask the user to confirm that the Copilot CLI license (linked on the card) is acceptable for Part 2's release. Do not merge Part 2 until they say so. Part 1 does not depend on it.
