# A held connection is not a running server

- **Date:** 2026-09-07
- **Type:** fix
- **Scope:** `web`

[中文版](2026-09-07-machine-linked-but-stopped.zh.md)

The Machines page called a machine **Connected** when the connection was held but the last probe had found no server running over there — and then withheld `use`, the one action that would start it again, because the row looked ready.

A held connection is not liveness. The connection is an ssh process on **this** side and outlives the far server, so it says the tunnel has somewhere to go, never that anything answers. It used to win outright in the row's reading; what the last probe found has the say now, and a machine whose server has stopped reads as its own state — with `use` offered, because that is what starts it.
