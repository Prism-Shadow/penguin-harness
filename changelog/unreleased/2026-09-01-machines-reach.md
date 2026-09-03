# Reaching a machine: connect it, proxy it, browse it

- **Date:** 2026-09-01
- **Type:** feature
- **Scope:** `server`, `docs`
- **PR:** [#574](https://github.com/Prism-Shadow/penguin-harness/pull/574)

[中文版](2026-09-01-machines-reach.zh.md)

An installed machine can now be **connected**: this server brings its `penguin server` up over ssh and keeps the connection to it open, through which its API answers at `/server/<machineId>/api/…` on this origin. Nothing new listens anywhere, and nothing new is opened — the one connection a machine already has carries it.

## Connect, and what it costs

Connecting is a job: ask the machine what is running over there, start its server when nothing is, and keep the connection open. The connection itself is the one this server already holds per machine — an `ssh -T -D` session — so connecting opens nothing new; what it does is make sure the far side has a server to answer, and remember the port it is on.

## Facts that name the layer they measured

Two new facts on a machine, deliberately not merged with the one #568 added:

- `connection` — this server holds its session to it. A fact about a process on **this** side, which outlives the far server.
- `api` — the machine's API answered, or did not, when this server's proxy last carried a request to it. Stamped by traffic that flows anyway rather than by a probe of its own: no timer, no loop, and a machine nobody asks about is simply not measured.

Reading one of these for the other is the connect loop of #561: a live connection to a dead server read as connected, so every caller that found the machine silent asked for another connect and was told "already connected", forever. **Connect now asks what is actually running over there even when the connection is held**, and starts the server when nothing is — which is also what makes reconnecting, to pick up a new key or retry, cost one probe instead of a refusal.

## The same-origin proxy

`/server/<machineId>/api/…` is dialled through the session to the machine's server. Only `/api` paths — the frontend stays local, so nothing here can leave a window unable to say whether anyone is logged in.

Addressed by the machine's **own id** (#568's), not by its ssh alias: an alias is a line in one config file, so keying URLs on it would break them the moment someone renamed a host, and being base64url, an id needs no percent-encoding in a path.

**One identity.** The caller is this server's admin, and this server's admin is that machine's admin — the ssh access that installed the program there is what authorizes both. The session presented over there is minted through that access (`penguin auth token` on the machine, over the held connection) and reused until near its TTL. The browser's cookies never travel, and the machine's never come back. The proxy mounts inside this server's own auth middleware, admins only.

## What the routes gained

`POST …/connect` is a job of the same shape as an install, `job.kind` telling them apart. `POST …/disconnect` drops the connection and leaves the remote server running — it is that machine's own, and other people may be on it. `GET …/dirs?path=` lists a machine's subdirectories over the connection, so choosing a directory on it costs one command and no round trip to its API.

An App that boots reconnects what was connected, five machines at a time, closing the session the previous generation left behind on its way.
