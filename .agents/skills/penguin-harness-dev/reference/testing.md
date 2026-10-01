# Writing tests: scenarios first, behaviour only

A test earns its place by failing when a user-visible promise breaks, and by staying green through
a refactor that keeps the promise. "Paying twice for one order must not charge twice" is a test.
"`PRICE_TABLE.gpt5` equals `1.25`" is not: it restates the source, fails on every legitimate edit,
and proves nothing a reader of the source did not already see. Every test also costs CI minutes on
three platforms. Write fewer, better ones.

## 1. Write the scenarios before the code (BDD)

Before writing a test file, write down its scenarios in plain words. Each one is a behaviour
somebody depends on:

```ts
/**
 * Model balance, as the models page and the sidebar read it.
 *
 * - Given a group with a stored key, when the balance is asked for, the vendor is called once
 *   and the amount comes back in the vendor's currency.
 * - Given the same question twice within a minute, the vendor is called once (cached).
 * - Given no key anywhere, the answer is `no_key` and the vendor is never called.
 * - Given the vendor times out, the answer is `upstream_failed` and nothing is cached.
 */
describe("model balance", () => {
  it("a stored key is sent to the vendor once, and the amount comes back", async () => { … });
  it("a second ask within a minute is answered from the cache", async () => { … });
  …
});
```

- The file header lists the scenarios. One `it` per scenario, and its name says the behaviour in
  the Given/When/Then shape (or its short form: "a second ask within a minute is answered from the
  cache"). A reviewer must be able to read the list and judge coverage without reading a line of
  test code.
- Arrange through the public surface the user or the caller has: an HTTP route, an exported
  function, a rendered component, a CLI command. Assert on what that caller can observe: the
  response, the stored state read back through the same surface, the emitted records, what the
  screen shows.
- The important scenarios are the ones where the system must *not* do something: a retry must not
  duplicate a record, a refused request must not write, a cancelled run must not keep billing, a
  second click must not start a second flow. Look for these first.

## 2. What never earns a test

Delete these on sight, and do not write new ones:

- **Constants and tables restated.** `expect(DEFAULT_TIMEOUT).toBe(30_000)`,
  `expect(Object.keys(MAP)).toEqual([...])`, a price or label copied from the source. If a value
  matters, test the behaviour it drives (the request times out; the bill uses the rate).
- **Implementation mirrors.** Asserting which private helper was called, how many times an
  internal function ran, the exact shape of an intermediate object — anything a refactor that keeps
  the behaviour would break.
- **Copy and markup snapshots.** Asserting a UI string equals its dictionary entry, or a
  className contains a token. The one exception is text that is load-bearing for a user (an error
  that names the fix, a zh/en pair that must stay in step) — then assert the behaviour: the error
  reaches the screen when the case happens.
- **Source-grep "contracts"** (`expect(readFileSync(src)).toContain("…")`). They pass on dead code
  and fail on renames. The exception is a repo-wide invariant with no other way to hold it, kept in
  one guard file per rule (`deslop.test.ts`, `no-native-title.test.ts`, `shortcut-guard.test.ts`,
  the plugin-version check). A new one needs the same justification.
- **Type-level facts** the compiler already enforces.
- **Duplicates.** The same scenario tested at two layers: keep the one closest to the user, unless
  the lower one covers branches the upper cannot reach cheaply.

## 3. One way to fake each boundary

Fake at the edge of the system, never inside it. Each package keeps its fakes in one place —
`test/helpers/` (server's is `test/helpers.ts` plus `test/fixtures/`, core's `test/helpers/` and
`test/fixtures/`, web's `test/helpers/`) — and a new test reuses them before writing its own.

| Boundary | The one fake |
| --- | --- |
| An LLM provider | The package's mock LLM (a scripted AgentHub client in core; `mock-llm.mjs` for e2e). Never `vi.mock("@prismshadow/agenthub")` in a new test when the scripted client can do it. |
| Outbound HTTP (vendors, gateways, messaging platforms) | One fetch fake per package that records requests and answers from a script; installed with `vi.stubGlobal("fetch", …)` and restored in `afterEach`. No real network. |
| The server, from a test | The package's `createTestApp()` / request helpers against a temp data root. Build one app per `describe` when the scenarios do not interfere, not one per `it`. |
| Filesystem | A real temp directory (`mkdtemp`) removed in `afterEach`. Do not mock `fs`. |
| Time | `vi.useFakeTimers()` and advancing it. Never a real `sleep` to wait for something: wait on the event, or advance the clock. |
| Processes | Spawn only when the process *is* the behaviour (a sandbox, a PTY). Otherwise call the function the process would run. |
| Browser state (web) | The package's storage/DOM helpers; a component is rendered through the shared render helper, not a hand-built harness per file. |

`vi.mock` of the package's *own* modules is a smell: it tests the caller against a fake of code you
own, and the real integration goes unchecked (see the seam-fakes note in `verification.md`).

## 4. Coverage is measured by branches

- Each package can run `vitest run --coverage` (v8 provider, `coverage.all` over `src/`). What
  matters is **branch** coverage of the code a change touches: every `if`, `??`, early return and
  error path the change adds is taken by some scenario, both ways where both ways are behaviour.
- A PR that adds branches without scenarios for them is unfinished. A PR that deletes tests must
  not lower the package's branch coverage; state before/after in the PR body when you prune.
- Coverage is a map for finding untested behaviour, not a target to pad. A test written only to
  turn a line green, asserting nothing a user depends on, is the junk from §2.

## 5. Keep the suite fast

- A test that takes more than ~1 s is suspicious: a real timeout, a real sleep, a per-test server,
  a per-test install. Fix the cause, do not raise `testTimeout`.
- Share expensive setup across a `describe` (`beforeAll`) when the scenarios read but do not
  mutate; reset only what they mutate.
- Parameterize instead of copying: `it.each` over the table of cases for one behaviour.
- CI runs every suite on Linux, macOS and Windows. A slow or flaky test costs three times.

## Checklist for a test PR

- [ ] The scenario list is in the file header, and each `it` name is a behaviour.
- [ ] Every assertion is observable by the caller; nothing restates a constant or the source.
- [ ] Fakes come from the package's helpers; nothing of the package's own is `vi.mock`ed.
- [ ] The branches the change adds are exercised; pruning did not lower branch coverage.
- [ ] No real sleeps, no network, no per-test servers where one per `describe` would do.
