# A machine gets the Model credentials its Agents need

- **Date:** 2026-09-01
- **Type:** feature
- **Scope:** `server`
- **PR:** [#575](https://github.com/Prism-Shadow/penguin-harness/pull/575)

[中文版](2026-09-01-machines-models.zh.md)

An Agent running on a machine calls the model endpoint **from over there**, against **that machine's** config. So a machine with no credentials is connected and unusable: picking a model here and starting the Session there failed with "Model is not in the Project config". Connecting a machine now hands it the Model config of the Projects that use it.

## Which Projects, and why the routes are under one

Only the Projects on this server that actually list that machine. A machine is shared — one host, one program, adopted by whichever Projects want it — but a credential is not: it belongs to the Project that holds it. That asymmetry is the reason the machines routes sit under a Project at all.

Editing a Model here syncs it outward too, to every machine that should have it. Not awaited: the person editing a key is not the one who should wait on a set of ssh tunnels.

## Merged, not replaced

The machine's `PUT /models` is a whole-table replace, so every entry that exists only over there is re-sent — **without** its `apiKey`, since omitting it keeps the stored value and a GET reports keys masked. On a collision this side wins. A machine that someone configured by hand keeps what it had, and does not silently lose a key this server has never seen.

Only entries worth carrying are sent: an entry with an inline key or its own base URL is something the machine cannot already have, while a bare catalog entry is a preset every server seeds for itself.

## Over the tunnel, as that machine's admin

The key travels inside the forward, to the machine's own authenticated `PUT /models`, which writes `.project_config.toml` at mode 0600 — whoever can do this already has ssh to that machine and can read that file. An ordinary API call rather than a far-side script, because the endpoint is what validates, invalidates cached runtimes and tells open tabs.

A failed sync is **reported, never fatal**: the connect log says what the machine said, and the machine stays connected. What is on it did not become wrong because a later step did not happen.
