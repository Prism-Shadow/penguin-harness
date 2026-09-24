# A first-party vendor group carries built-in models only

- **Date:** 2026-09-21
- **Type:** fix
- **Scope:** `web`, `server`, `cli`, `core`
- **PR:** [#843](https://github.com/Prism-Shadow/penguin-harness/pull/843)

[中文版](2026-09-21-vendor-group-presets-only.zh.md)

Configuring a model of one's own inside a first-party vendor group — DeepSeek, Google, OpenAI,
Anthropic, Z.AI, Moonshot, MiniMax, Penguin Go — produced an entry that could not start. Those
groups persist no `client_type`, so AgentHub places each entry by the spelling of the upstream
model id alone, and an id outside its routing rules was answered at request time with AgentHub's
own sentence: `qwen/qwen3.8-flash-next is not supported. Supported client types: minimax-m3,
gemini-3.8, …`. The connectivity test relayed that sentence verbatim, and the dialog offered no
way out of it. The groups now carry the built-in catalog and nothing else, and the ways into that
state were closed.

## The predicate

`isVendorGroup` (core, `packages/core/src/state/model-catalog.ts`) answers "is this a group that
routes by model id alone?" for the whole app: a group the catalog knows, that is not `custom`,
carries no gateway base URL and pins no protocol of its own. `unroutableVendorModel` pairs it with
`resolveModelEnv`, which already mirrors AutoLLMClient's routing rules branch for branch, to answer
"would this entry be unplaceable?" — no surface matches on the upstream message text.

## The models page

- The add-model entry point was dropped from every vendor group header. Custom, user-defined and
  gateway groups keep theirs, and the page's other group actions — the bulk API key, the speed
  test, the console link — are unchanged everywhere. The add dialog's vendor-group title and
  protocol note went with it, along with the base URL the Penguin Go add pre-filled.
- A row whose id does not route now carries a warning on its card, and the way out follows what
  the catalog knows about that exact `(provider, model_id)` pair (`unroutableFix`): a pair the
  catalog holds is a built-in model saved before the catalog pinned the protocol its id needs, and
  is offered **sync presets**, the page header's own merge; a pair the catalog does not hold was
  added by hand and is offered **move to a custom group**, which opens the config dialog with the
  row already moved, where the protocol can be picked from the base URL field's suffix menu or
  detected from the endpoint. The config dialog's own inline warning makes the same split, so one
  row never reads two ways.
- The connectivity test on such an entry reports what is wrong and which of the two fixes applies,
  instead of relaying AgentHub's sentence. The upstream text goes to the browser console, so a
  developer reading a report still has it.

## The models PUT and the CLI

`PUT /api/projects/:projectId/models` refuses an entry the request introduces into a vendor group
under an unroutable id, with `400 model_not_routable` and a message naming the entry and the way
out; the Web App localizes it by code. An entry already stored under that key is written back
untouched — see [backward compatibility](2026-09-21-backward-compatibility.md).

`penguin config model add` writes the config file directly rather than through that route, so it
refuses the same configuration (exit code 1, nothing written) when the entry is new. An entry that
already exists is updated as before, and an explicit `--client-type` — or a catalog row that pins
one, as MiniMax M3 and the direct `deepseek-flash` do — makes the id routable and is accepted.

## The catalog's own guard

"A built-in model must satisfy id routing" became a rule of the catalog, so it is pinned by a test
beside the catalog's other invariants: every `MODEL_CATALOG` row in a vendor group resolves through
`resolveModelEnv`, by its pinned `client_type` or by its id.
