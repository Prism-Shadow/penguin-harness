PenguinHarness 0.2.20 is a fix release on top of 0.2.19. Workbenches load again in the desktop app, where 0.2.19 failed them with `TS2688`. A workbench that fails to load now offers **Fix with AI** and **[Report]** beside **Reload**. A compaction or model switch that produced no full summary shows its hand-over in its **Compacted** row. The plugin market lists the published plugin index again and says why each failed source could not be read.

## Install

**Desktop app**: get your platform's installer from [penguin.ooo/download](https://penguin.ooo/download) — the page measures both sources on every visit and keeps GitHub unless the OSS mirror is measurably faster. A manual selector sits beside the result. The macOS builds are Developer ID signed and notarized, and the Windows installers are Authenticode-signed. Neither platform needs a first-launch unblock.

**Windows desktop app of 0.2.16 or earlier: install this release by hand once**, as for 0.2.17. The updater of 0.2.16 and earlier refuses installers signed with the new certificate. Download the installer from [penguin.ooo/download](https://penguin.ooo/download) and run it.

CLI / server (Linux, macOS; bundled Node runtime):

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Windows (PowerShell):

```powershell
irm https://penguin.ooo/install.ps1 | iex
penguin web
```

Or via npm (needs Node >= 24):

```sh
npm install -g @prismshadow/penguin-cli
```

Or the official Docker image (`linux/amd64` and `linux/arm64`):

```sh
docker run -d --name penguin -p 127.0.0.1:7364:7364 -v penguin-data:/data hiyouga/penguinharness:0.2.20
```

`0.2.20` is built from this release's tag. `latest` follows changes to the image's runtime or build inputs on `main`. The example publishes the port on the host's loopback, so a fresh deployment answers only on the machine running Docker.

## Highlights

### A workbench that fails to load offers Fix with AI

Wherever the Web App shows that a workbench's files did not load, it now offers two actions besides **Reload**: **Fix with AI** and **[Report]**.

![A workbench that failed its type-check, in its App Center window: the error, Reload, Fix with AI and Report](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/assets/blog-assets/penguinharness-0-2-20-workbench-fix-en.png)

**Fix with AI** asks first, then opens a new chat for the default agent in a temporary Workspace, with the repair prompt in the composer, not sent. The prompt names the workbench, its agent and machine, its folder (`<app_data_dir>/agents/<agent>/agent_state/workbenches/<id>/`) and the load error verbatim. It explains that a load type-checks `index.ts` under options the host fixes, that saving a file loads it again, and that `.build/status.json` records the result. The agent is asked to say what it will change before changing anything. When the error comes from what the platform provides (Node or TypeScript declarations, host types, packaging), it is told to say so, change nothing and suggest a report. A workbench on a connected machine is repaired on that machine, by that machine's default agent.

**[Report]** opens the shared problem report with the workbench, whether it runs on a connected machine, and the masked load error.

The actions appear in the App Center window of an app with no page to show (**Reload** is now the primary button there), in the App Center's **Show error** dialog, and in the **More** menu of a failed workbench row in **Agent settings**. **[Report]** alone appears in the toast after an import whose load failed and on the app's full page.

### A hand-over without a summary shows in its Compacted row

When a compaction completes without a full summary, the next context opens with a hand-over instead: the hand-off note, or, for an in-session model switch, the Trace hand-over. The chat now shows that text in the compaction row it follows. The row settles to **Compacted**, and its mark says why there was no summary.

![A real glm-5.3-flash turn, then a switch away from a model no longer configured: the Compacted row open at its Hand-off note, and the Model switched divider](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/assets/blog-assets/penguinharness-0-2-20-handover-en.png)

The row's body is folded by default. Its **Hand-off note** section takes the result section's place and lists the reason in the mark's words, the Trace file the note names, and the note itself with its tags stripped. Long paths wrap inside the section, and all of it is selectable text.

A switch whose current model cannot be reached sends no compaction request, so its row is derived from the hand-over: it settles with no wall time, and the mark's first line reads "The previous model was unavailable, so no summary was requested". The **Model switched** divider keeps its label and no longer has a hover hint. Everything is derived from records the Trace already holds.

### The plugin market says why a source failed

The published plugin index lists again. Its `npm` channel, added to nineteen rows, carries no `url`. The index reader had refused the whole document at the first such row, so the market reported a source it had reached as unreachable. The reader now requires a `url` only on the `github` channel, the one an install fetches.

![The plugin market's notice unfolded: a source whose document was refused and a source whose host did not resolve, each with the server's reason](https://raw.githubusercontent.com/Prism-Shadow/penguin-harness-community/main/assets/blog-assets/penguinharness-0-2-20-market-sources-en.png)

The market's notice gains **Details**, which lists each failed source by its address with the server's reason, as selectable text followed by **[Report]**. A refused row names the document, its position, the package and the field at fault. A failed fetch names what lies under undici's bare `fetch failed`: the errno or its code, a certificate refusal's code, and each address of a host that resolved to several. A source tried over several addresses (its own and its mirrors) reports every address's failure in order.

## Notable in this release

- **Desktop**: Workbenches load again in the desktop app. The packed app carries the declarations of `@types/node` and `undici-types`, which electron-builder's `*.d.ts` exclusion had stripped. The server takes a `@types/node` only when its entry declarations are present, and with no complete copy a workbench that does not import `node:` still loads. `verify-packed-cli.mjs` fails a packed app without those declarations.
- **Remote machines**: Connecting a machine on the **Machines** page no longer stops at the Sync config step with `it answered 503 when asked its version` while the machine's server is still starting. The version, handshake and config sync questions wait out that answer for up to a minute, and a restart is done when the App answers, not when the port does. A refusal names the reason the machine's server gave, at most 200 characters.
- **Agents**: The default system prompt's `# Success criteria`, `# Stop rules` and `# Tool use` sections gain six refinements: deliverable verification, reuse of documented checks, low-cost failure narrowing before rerunning suites, saving complete candidate files early, unattended Debian installs (`DEBIAN_FRONTEND=noninteractive`), and persistent services started on their own. The kernel version is `2026-11-26`.
- **Interface**: Tooltips break a run with no break opportunity, such as a file path, at the panel's edge instead of running past it.
- **Release pipeline**: The npm publish job runs its test suites with an empty npm user config, as CI's test jobs do; build and publish keep setup-node's file.

### Upgrading

- **Existing agents**: Run **Update kernel** on the **Agents** page to bring the refined default system prompt to agents whose prompt tab is still the built-in default.
- **Remote machines**: Remote machines must run the server's version. Update each from the **Machines** page.
- **Hand-off notes in a live view**: A compaction that degrades to its hand-off note with no model switch shows its **Hand-off note** section in an open conversation only after a reload; the note is written with the next Trace file and is not on the live stream. A model switch's hand-over shows at once.

## Requirements

Linux or macOS (x64 / arm64), or Windows 10+ (x64). The desktop app and the CLI installers bundle their own runtime. Installing from npm needs Node >= 24; the official Docker image carries its own. Running the built-in Benchmarks needs Docker with Compose v2 and [uv](https://docs.astral.sh/uv/) on the server's machine. The Browser extension needs Chrome 116 or later. All data stays under `~/.penguin/data` — the `/data` volume in the container.

Full detail: [changelog/0.2.20/](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.20).
