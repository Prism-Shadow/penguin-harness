# Built-in GitHub Copilot and coding-agent environment variables

- **Date:** 2026-09-25
- **Status:** design approved in conversation; awaiting review of this written spec
- **Packages:** `coding-agents`, `server`, `web`

## Goal

An admin can run GitHub Copilot as a coding agent by pasting a GitHub personal access
token, with nothing installed on the server machine. Along the way, any Local CLI agent
can be given its own environment variables (an API key, a token), which today is only
possible when adding an agent by hand.

Success looks like this:

1. On **Models → Built-in**, an admin pastes a fine-grained PAT with the **Copilot
   Requests** permission, clicks **Set up**, and after the download a **Test** passes.
2. "GitHub Copilot (built-in)" is offered wherever coding agents are: the chat model
   picker and the activity editor's **Generation agent** list. An activity stage runs on it.
3. On **Models → Local CLI**, an admin adds `GEMINI_API_KEY` to Gemini CLI (or
   `COPILOT_GITHUB_TOKEN` to the Copilot CLI), and the next **Test** starts the agent with it.

## Decisions already made

- **Approach 1, not the SDK.** The built-in Copilot is the Copilot CLI's own runtime,
  downloaded by Penguin and driven over ACP (`--acp`) through the existing coding-agent
  path. The GitHub Copilot SDK (a second, parallel runtime) is out of scope; its extras
  (per-session tokens, custom tools, bring-your-own-key) are not needed for this goal.
- **A third tab named "Built-in"** beside **Local CLI** and **API providers**. It holds
  agents Penguin downloads, runs and updates itself, configured with a token. Local CLI
  keeps meaning "installed on this machine, signed in its own way".
- **Downloaded on demand**, never bundled into Penguin's package: the runtime is about
  150 MB per platform.
- **Environment variables are stored like Penguin's other secrets** (API provider keys,
  the Agent Vault): plaintext on the server, masked at the API, never returned to the
  browser. No new encryption is introduced.

## Out of scope

- An SDK-based runtime, per-user or per-session tokens, bring-your-own-key.
- Built-in versions of other agents. The tab and the download are written so another can
  be added, but only Copilot ships.
- Encrypting secrets at rest.

## Part 1: environment variables for coding agents

### Storage

`AgentServerDefinition.env` (`packages/coding-agents/src/types.ts`) already exists and is
applied at spawn by `CodingAgentService.envFor`. It stays the single home for an agent's
variables, persisted with the definition in `server_settings` (`coding_agent_servers`).

Every path that rewrites a definition must carry `env` over. Today three drop it:

- `saveAgent` (`POST /api/coding-agents/agents`) replaces the whole entry, so re-saving
  without `env` erases it. With this change, a save that omits `env` keeps the stored one.
- Rediscovery / `ensureDefinition`, which materializes a detected agent's definition.
- `upgradeAdapterPackage`, which rewrites a legacy adapter command.

### API

- `PUT /api/coding-agents/agents/:agentId/env`, admin only. Body:
  `{ entries: { key: string; value?: string }[] }`.
  - Replaces the agent's whole set of variables.
  - An entry without `value` keeps the stored value for that key (the Vault's rule), so
    the browser never needs a real value to keep it.
  - A key not listed is removed.
  - Works for any saved or detected agent; a detected agent's definition is materialized
    first (as `ensureDefinition` does).
- The agent listing (`listAgents` and the save response) gains
  `env: { key: string; valueMasked: string }[]`, masked with the same rule as
  `maskApiKey` in `project-config-service.ts` (`***` up to 12 characters, else
  `first4…last4`). Real values are never returned.

### Validation (server-side, mirrored in the form)

- Key matches `^[A-Za-z_][A-Za-z0-9_]*$` (the Agent Vault's rule).
- Reserved keys are refused:
  - everything the sandbox passes through (the `PASS_THROUGH` list in
    `coding-agents/src/env.ts`)
  - `NO_BROWSER`
  - any key starting with `PENGUIN_`

  Overriding these would break how the agent starts or how Penguin tracks it.
- Values up to 8192 characters; no newlines.
- A rejected request saves nothing and names the offending key.

### Applying a change

An agent's process is started once and shared by its sessions, and reads its environment
only at start. After a successful save:

- If no session is using the agent, the service closes its connection so the next use
  starts it with the new values.
- If sessions are live, the connection is closed when the last one ends, and the listing
  reports `envPending: true` so the card can say it applies once those sessions end.

### UI

On **Models → Local CLI**, the expanded agent card gets an **Environment** section,
admin only, modelled on the Agent Vault tab (`features/agents/vault-tab.tsx`):

- One row per variable: name, masked value, remove.
- **Add variable**: a name `Input` and a value `PasswordInput`.
- **Save**. Changes stay local to the card until saved.
- When `envPending`, a note that the change applies once running sessions end.

The Add agent dialog's `KEY=value` textarea is replaced by the same editor. Non-admins do
not see the section.

## Part 2: the Built-in tab and GitHub Copilot

### What is downloaded

- **Package:** the Copilot CLI's platform package from the npm registry,
  `@github/copilot-<platform>`. It is the program the existing `copilot` recipe already
  runs with `--acp`.
- **Platforms:**
  - `win32-x64`, `win32-arm64`
  - `darwin-x64`, `darwin-arm64`
  - `linux-x64`, `linux-arm64`
  - `linuxmusl-x64`, `linuxmusl-arm64`, chosen via libc detection

  Any other platform is reported as unsupported.
- **Version:** a version pinned in Penguin's source, updated deliberately with a Penguin
  release. Never "latest".

### How it is downloaded

A server kernel service (`BuiltinAgentsService`, behind an `Interface` class and registered
in `platform.ts`, per the repo's service conventions) does the following:

1. Reads the pinned version's metadata from the registry: `dist.tarball` and
   `dist.integrity`.
2. Downloads the tarball through Penguin's proxy setting, if one is configured, and
   verifies it against `dist.integrity` (sha512). No `npm` is needed on the machine.
3. Unpacks it into a temporary folder under `<data root>/runtimes/copilot/`, then renames
   it into `<data root>/runtimes/copilot/<version>/` in one step.
4. Runs the program with `--version` to confirm it starts.

Rules around this:

- A failed, cancelled or partial download never replaces a working version.
- Leftover temporary folders are removed when the server starts.
- Concurrent **Set up** clicks share one download.
- Progress is reported as bytes received out of the total.

### The agent

The built-in Copilot is an ordinary saved `AgentServerDefinition`:

- id `copilot-builtin`, title "GitHub Copilot (built-in)"
- `command`: the downloaded program; `args`: `["--acp"]`
- `env.COPILOT_GITHUB_TOKEN`: the PAT, stored and masked as in Part 1
- a new `builtin: "copilot"` marker on the definition, so it lists only under **Built-in**,
  while a detected `copilot` CLI stays under **Local CLI**

Because it is a normal definition, it needs no new session runtime. Approvals, Trace,
cancellation, the model picker, the activity stages and **Test** all work on it
unchanged.

**Isolation from the machine's own login.** The built-in agent must not fall back to a
`copilot` login on the server machine, nor share its settings. It gets its own config
folder under its agent home. The CLI's variable or flag for that is to be confirmed while
planning. If none exists, the fallback is documented as a known limitation, since a PAT
takes priority over a stored login anyway.

### API (admin only)

- `GET /api/coding-agents/builtin`: each built-in's state (`not-installed`,
  `downloading` with progress, `ready` with version, `update-available`, `failed` with
  reason), the masked token, and the download size.
- `POST /api/coding-agents/builtin/copilot/setup` with `{ token }`: stores the token and
  starts the download. Without `token` it keeps the stored one (used by **Update** and
  **Try again**).
- `POST .../copilot/cancel`: cancels a download.
- `PUT .../copilot/token` with `{ token }`: **Replace token**, applied as in Part 1.
- `DELETE .../copilot`: **Remove**, which deletes the runtime folder, the token and the
  definition. Past sessions stay readable in history.

### UI: the Built-in tab

Rules for the tab:

- A third segment on the Models page, after **Local CLI** and **API providers**, admin only.
- One card per built-in agent.
- Setting up, updating and removing are admin actions.

The Copilot card changes with its state:

| State | Shows | Actions |
|---|---|---|
| Not set up | What it is, the ~150 MB download, a link to create a fine-grained PAT with **Copilot Requests**, a note that setting up accepts GitHub Copilot's terms (linked) | PAT field, **Set up** |
| Downloading | Progress | **Cancel** |
| Ready | Version, masked token | **Test**, **Replace token**, **Remove** |
| Update available | Installed and new pinned version | **Update**, plus Ready's actions |
| Failed | The reason | **Try again** |

## Errors

| Where | Failure | What the admin sees |
|---|---|---|
| Environment save | Invalid, reserved or oversized key/value | The field is marked with the reason; nothing is saved |
| Test / session start | The agent refuses (bad key) | The agent's own reason (relayed since the 2026-09-25 fix) |
| Download | Network, proxy, registry | "Could not download Copilot: …" and **Try again** |
| Download | Integrity mismatch | "The download did not match its published checksum and was discarded." |
| Download | Unsupported platform | "Copilot has no build for this machine (…)"; **Set up** disabled |
| First run | The program does not start | The start error. On an update the previous version stays in use |
| Session | PAT expired, revoked, or lacking **Copilot Requests** | Copilot's refusal, plus a hint to check the PAT's permission |

## Conformance

- Every user-facing string goes in `lib/strings-en.ts` / `strings-types.ts`. Status colour
  comes only from `lib/tone.ts`. Controls use `size="sm"`. The tab switcher uses the
  existing segmented control.
- Stateful server logic (download state, progress, locking) lives in a kernel service, not
  in route handlers. Run `gen-ifaces` after adding it.
- Changelog entries under `changelog/unreleased/` for each part.

## Testing

**Unit tests (coding-agents, server)**
- Environment validation, including reserved keys.
- Keep-stored-value semantics and masking.
- Every definition rewrite path preserving `env`.
- The platform-to-package map, including musl detection.
- Integrity verification against a local tarball served by a fake registry.
- The one-step rename, and cleanup after a failure or cancellation.

**Server route tests**
- `PUT .../env`: admin-only, never echoes a value.
- Built-in setup, cancel, update, replace token and remove against a fake registry, with a
  stub program that answers `--version` and a scripted ACP handshake. Tests never download
  the real package.

**Web tests**
- The Environment editor: add, keep, remove, reserved-key error.
- The Built-in card in each state.

**Manual, once**
- A real **Set up** on Windows with a real PAT: download, **Test**, a chat, and an activity
  stage on the built-in Copilot.

## Release blocker

The Copilot CLI package is not MIT ("SEE LICENSE IN LICENSE.md"). Before shipping Part 2,
confirm that its license allows Penguin to download and run it on a user's behalf in this
way, and that the "accepts GitHub Copilot's terms" note links to the right terms. Part 1
has no such dependency and can ship first.

## Delivery order

1. Part 1: environment variables. Useful on its own; Copilot works on a PAT wherever the
   CLI is installed.
2. Part 2: the Built-in tab and the Copilot download.
