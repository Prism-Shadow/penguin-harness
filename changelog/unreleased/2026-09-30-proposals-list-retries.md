# The proposals list is read again after a failure

- **Date:** 2026-09-30
- **Type:** fix
- **Scope:** `web`

[中文版](2026-09-30-proposals-list-retries.zh.md)

Company mode reads the open organization's proposals list once per organization entry, and again only when the proposals plugin's event says a proposal moved. That list is what every roadmap row's status pill and every `proposal:<n>` capsule reads. A failed read stayed failed until the organization was re-entered — and when the failure came from a dropped link to the machine the organization runs on, the event that would have re-read it travelled over that same link.

## Details

- A failed read is tried again on its own, waiting 2 s, then doubling up to 30 s between tries, until one answers. Leaving the organization or the proposals plugin going away stops the retries; any other read of the list replaces a retry still waiting.
- The list is also read again when the user channel reconnects past its replay buffer (`resync_required`), with the other company snapshots, since a proposal event may have been lost.
- The list is also read again when the machine the open organization runs on answers again after it did not.
