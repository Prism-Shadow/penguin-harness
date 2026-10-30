# PRFC-0021 Distro Channels: the shared vocabulary of how the harness reaches a machine

[中文版](PRFC-0021-distros.zh.md)

- Feature Name: `distro-channels`
- Start Date: 2026-10-23
- PRFC PR: none yet (native to this repository)
- Implementation PR: — (this RFC fixes a vocabulary; the per-channel work it feeds — harness meta provisioning and CLI resolution — is carried by its own RFCs)

## Summary
[summary]: #summary

This RFC defines a **distro channel**: one reproducible path by which a machine ends up running this harness. Six channels exist today: the npm package, the release tarball with its universal variant, the Docker image, the desktop application, the source checkout, and the peer machine installed by the machines feature. Every channel is described by the same four facets, so a question about the distribution surface can be asked once and answered per channel. The list is open: a new way of shipping joins by being listed.

## Motivation
[motivation]: #motivation

### The distribution surface needs one shared set of nouns

Discussions of the distribution surface need one shared set of nouns for "how this machine got its harness". Today each discussion either lists the ways of installing again or skips the list and speaks of "installations" in general, and almost every distribution question is answered with "it depends on the channel". A fixed list gives that answer something to point at.

### The channels diverge in facts nobody records

A read-only survey compared the channels facet by facet and found them diverging on facts nobody records: the npm package and the release tarball ship a pushed-CLI loader, the Docker image and the desktop application do not; the harness record is written only when a hot push arrives or when a machine installs from a peer, so the other channels' roots start from "no record". The divergence is the current state; the defect lies in how it had to be found — from the code up, because no earlier document held the list.

### Why the list is written down

The RFCs that follow this direction — harness meta always present (PRFC-0023) chief among them — make claims "on every channel". Those claims need a citable list of channels with citable facet names, or each of them lists the channels again and the lists drift. This RFC is that list: it predates them and defines the nouns they cite.

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### What a channel is

A **distro channel** is one reproducible path by which a machine ends up running this harness. It describes a way of shipping: the same physical machine can carry installs from several channels, and a channel is identified by how the harness got there.

### The four facets every channel answers

Each channel is described by the same four facets:

1. **Entry** — how a person, or a supervising process, starts the harness's CLI from this channel.
2. **Harness data root** — which data root the channel provisions, and what provisions it.
3. **Pushed-CLI reachability** — whether a hot-pushed CLI can be found, loaded, and re-run on this channel.
4. **Carried harness image** — whether the channel's product carries a complete harness image of its own, in push format.

The facets are questions; the answers are facts about the current state. The facet names are the fixed part: a later RFC that changes a channel changes its facts.

### The list is open

New ways of shipping appear, and the list grows by listing them. A new channel joins the channels already named, and the document's revision records the addition; the channels already named keep their meaning. This rule is "listed, but not limited", and it is one of the invariants below.

### What the list answers

The list answers "is this a way the harness reaches machines". A channel's presence means every claim made "on every channel" has to say what it means for that channel. Feature completeness and support levels are answered by other documents.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

The six channels as they stand. The facts below come from a read-only survey and will change as later RFCs land; the durable part of this document is the channel identities and the facet names.

### The npm package

Installed from the package registry. **Entry**: the two bin links the package declares — the main CLI and the pushed-CLI loader. **Harness data root**: the default profile root, provisioned on first run. **Pushed-CLI reachability**: both entries are present and the loader resolves, so a server started from this channel can re-run through the pushed CLI. **Carried harness image**: none — the package carries no prebuilt harness image.

### The release tarball and the universal bundle

Installed by the release scripts into a directory of launcher, libraries, and a bundled runtime; the universal variant carries no bundled runtime. **Entry**: the launcher script beside the installed CLI pair. **Harness data root**: the default profile root. **Pushed-CLI reachability**: the loader ships beside the entry, so re-running through the pushed CLI works. **Carried harness image**: yes — the release directory carries a push-format harness image of its own build, used today only for machine installs.

### The Docker image

**Entry**: an extension-less symlink on `PATH` pointing at the CLI inside the image. **Harness data root**: a volume, provisioned on first run of the container. **Pushed-CLI reachability**: the loader is in the image and nothing resolves it, so pushed CLI changes do not take effect on this channel today. **Carried harness image**: none.

### The desktop application

**Entry**: the desktop shell starts its server process directly from a bundled server entry. **Harness data root**: the shared release-profile root, provisioned on first run. **Pushed-CLI reachability**: the current product ships no pushed-CLI loader, so the pushed CLI is unreachable; the user-facing command shim points at the bundled CLI. One implementation line already demonstrates the shape that ships the loader and consults the record before starting. **Carried harness image**: yes — the application bundle carries a push-format image of its own build.

### The source checkout

The development channel. **Entry**: dev scripts for source runs; a built CLI pair for built runs. A source run has no re-spawnable entry, which is a documented boundary. **Harness data root**: the dev profile root. **Pushed-CLI reachability**: the built pair works; a checkout can also build a harness image on demand, and that image is deliberately laid out for machine installs, not into the dev data root. **Carried harness image**: built on demand.

### The machines-installed peer

A remote machine installed from a peer by the machines feature. **Entry**: the installed peer's loader is its only CLI face, and remote commands invoke it directly. **Harness data root**: provisioned at install and seeded by copying the sender's harness record, so the peer's root carries harness meta from the moment the install completes. **Pushed-CLI reachability**: the whole channel is the pushed CLI. **Carried harness image**: none — the record is copied from the sender at install.

### Facts drift, channels stay

The sections above answer "which channel did you mean", and the four facets answer "what can be asked about a channel". When a later RFC changes the facts — harness meta provisioning changes every channel's data-root facet, CLI resolution changes the reachability facet of two of them — the sections here are revised, and the channels remain the same channels.

## Invariants
[invariants]: #invariants

### The list stays open

> However the ways of shipping the harness multiply, the channel list still works as a shared vocabulary: a new way joins by being listed, and the channels already named keep their meaning.

The list is a vocabulary, and a vocabulary that closes would make every unlisted way of shipping unreadable on the design surface. A new channel has to join without a rewrite of what the existing channels mean, and the revision mechanism carries the addition.

### Every channel answers the same facets

> However support for a channel grows or shrinks, its description still answers the same four facets as every other channel's.

A channel that stops answering a facet, or answers a different set, destroys the comparability this list exists for. A claim made "on every channel" holds only because the channels can be asked the same four questions.

## Drawbacks
[drawbacks]: #drawbacks

A list invites misreadings: presence read as feature parity, six read as always six, and a facet answer read as a support commitment. Granularity will be argued — the universal variant shares a section with the plain tarball, and the machines-installed peer counts as a channel while being downstream of another one. The list also needs maintenance: a new channel, or a changed fact, costs a revision.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**A vocabulary RFC of its own**: two RFCs cite the channels; a list cited by several documents belongs to none of them and must live somewhere with its own anchor.

**Facets fixed, facts free**: fixing the facts as norms would freeze the current state into the design surface; the facets are the reusable half and the facts are the perishable half.

**Six sections, coalescing near siblings**: the universal bundle differs from the tarball only in runtime bundling; the machines-installed peer gets its own section because its entry and data-root shape differ from every shipping channel's.

**The cost of leaving this out**: every distribution-surface RFC re-lists the channels informally, and the lists drift.

## Prior art
[prior-art]: #prior-art

Operating systems had distribution channels as a first-class concept long before they had package matrices. Browsers name their channels (stable, beta, dev) separately from what any channel supports. Electron and its peers document distribution targets as a closed list per release while keeping the notion of a new target open across releases. The common practice is to name the ways of shipping first and then say what each way promises.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

A few details are left to the implementation or to a later revision.

- Whether the universal variant earns its own section or stays folded into the tarball's.
- Whether a channel is the shipping path or the running environment: the Docker image is both, and this RFC counts it once, as a shipping path.
- Whether the machines-installed peer is a channel or a consumer of channels; it counts as a channel here, and the boundary deserves another pass when a later RFC lands.
- Whether the four facets need a fifth, an update channel for instance; this RFC fixes four.

## Future possibilities
[future-possibilities]: #future-possibilities

A channel-by-feature support matrix, maintained at the release surface. Release assertions can be phrased per channel ("every channel's product ships a loadable loader"). A new channel — a future package ecosystem, an appliance image — joins here first and then inherits the sibling RFCs' claims.

---

## Changes

### v1.0.0

- Initial version (draft, native to this repository).
