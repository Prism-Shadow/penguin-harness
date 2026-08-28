PenguinHarness 0.2.9 — the release where the model library starts telling you what it costs. TokenDance leads the page as the recommended group, its promoted rows carry a declared discount the card shows and the cost center bills at, and DeepSeek's peak and off-peak tiers are billed per request rather than at whichever tier you happen to open the page in. WeChat joins as a fourth chat channel, bound only by scanning. Alongside that: a Machines page that installs this build onto another host over SSH, one update-all button on every page with updates waiting, and a new Project whose default model can read a picture.

## Install

**Desktop app**: grab your platform's installer from [penguin.ooo/download](https://penguin.ooo/download) — the page measures both sources on every visit and keeps GitHub unless the OSS mirror is measurably faster, with a manual selector beside the result. The macOS builds are Developer ID signed and notarized and the Windows installers are Authenticode-signed, so neither platform needs a first-launch unblock.

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

## Highlights

**A promoted model says what it actually costs.** The catalog stores list prices and a promoted row declares a `discount` beside them, so the billed rate is derived rather than pasted in — a lapsed promotion is one field to delete, with the rate to return to still on the row. Six TokenDance rows carry one, the card shows the price being billed with the rate as a badge, and what a new Project stores is the number the gateway charges. Two DeepSeek list prices had been recorded at their promotional value; both were corrected, which is why the badge can show at all.

**Peak and off-peak are billed per request.** DeepSeek's official tiers are half price outside Beijing weekday 09:00–12:00 and 14:00–18:00. A scheduled row keeps its peak price on disk — the one number that is true whatever hour it is written — and the cost center decides the tier from **each usage record's own timestamp**, splitting the aggregation before it prices anything. A range that straddles a boundary is billed at the rate each request ran at, and a finished week reports the same number whenever it is read.

**WeChat, bound only by scanning.** A Session's fourth channel is WeChat's official claw bot, behind the connector seam the other three already sat behind. There is no console to copy a credential out of, so the scan is not the convenient path but the only one — and the platform's poll handle, which is what turns a scan into a token, never leaves the server. Inbound is a long poll, so no public callback URL is involved. It is the only channel here carrying text, images and files in both directions: a reply's pictures and attachments go up to the platform's CDN and arrive as real images and files, a voice message arrives as WeChat's own transcription of it, and a video arrives as a file. It receives direct chats only, which the panel says under the controls rather than inside a fold.

**Install a server on another machine.** **Machines**, a new page under Models, lists the hosts in the server's own `~/.ssh/config` and installs this build onto the one you pick, replacing the desktop app's menu entry that shipped only inside the Electron shell. Targets come from the config text alone, read once, with no `ssh -G` and no network until you install; an alias is resolved only when it is installed to, so `Match` and wildcard inheritance behave exactly as ssh says.

**One button for everything waiting on a page.** The notice under a page title that said what a nav dot was pointing at is now one shared block on all four pages that carry one, and on Agents, Skills and Models it acts on everything it counts in a single press. Each bulk write confirms first, in that page's own existing words, and lists exactly which objects it would write to; a partial failure names the ones that did not take it. The Agent kernel trail became dismissible with the other three, so an Agent deliberately left on the defaults generation it was tuned against no longer keeps a dot lit.

**A new Project can read a pasted screenshot.** The default model moved to `deepseek-v4-flash-vision-exp` — the same context window at the same published price, with image input on top. Before, a fresh install had neither a vision session model nor a vision proxy, so a screenshot had no path to being read at all.

## Notable in this release

- **No breaking changes.** Nothing in this release needs anything done to data or configuration already on disk.
- **The catalog's prices moved, so every Project sees the preset-update badge** until it syncs or dismisses it. Accepting the sync changes the cost the cost center reports for usage that already happened — those figures have always been priced against current pricing rather than against the rate in force when each request ran. See [`2026-08-28-catalog-tokendance-discounts`](2026-08-28-catalog-tokendance-discounts.md).
- **A dropped QQ gateway connection stops counting as a defect.** A close the platform makes and the connector recovers from within its backoff is `expected`; a credential or an intent that will meet the same refusal forever stays `unexpected`, because "reconnects" is not the criterion — "reconnecting fixes it" is.
- **A Project owner can empty the error table**, scoped to the filter on screen rather than the Project's whole history, behind a confirmation that names the range, the Agent and the count. Errors with no Project attribution are outside every clear, admin included.
- **A retry ladder is one line in the transcript**, counting up, instead of one line per attempt. The line's own "retry now" and "give up" stay usable on every countdown in the ladder.
- **Authorizing a provider key reports its outcome in the dialog** rather than in a toast fired at a window nobody was looking at — the authorization happens in another tab, which is the whole reason the old announcement was missed.
- **The messaging HTTP surface stops being written once per channel.** A `MessagingChannelSpec` carries what a channel actually differs in, so adding WeChat was one entry plus the genuinely bespoke handlers.
- **The Chinese UI renames the three price buckets** to 缓存命中 / 缓存未命中 / 输出, wherever a price bucket is shown — the models page, the cost center's labels and legends, and the CLI's `--price-*` options. English labels, field names and wire keys are untouched.

## Requirements

Linux or macOS (x64 / arm64), or Windows 10+ (x64). The desktop app and the CLI installers bundle their own runtime; installing from npm needs Node >= 24. All data stays under `~/.penguin/data`.

Full detail: [changelog/0.2.9/](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.9).
