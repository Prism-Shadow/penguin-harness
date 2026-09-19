# Connected ChatGPT subscriptions from Models

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `model-catalog`
- **PR:** [#12](https://github.com/nicolaepocroianu/penguin-harness/pull/12), AgentHub [#4](https://github.com/nicolaepocroianu/agenthub/pull/4)

[中文](./2026-09-19-chatgpt-subscription.zh.md)

Added **Connect ChatGPT** to Models. Device authorization imported the account's visible
subscription models for use with Penguin's agent loop, tools, approvals, and history.

## Project credentials

Stored subscription credentials in the project's existing configuration file, refreshed them
before expiry, and kept rotations from being overwritten by older model-form saves. Disconnect
removed credentials for future requests, including requests from existing sessions.

## Experimental transport

Added an AgentHub transport for the undocumented Codex backend. The separate Codex delegation
plugin remained available. Subscription usage carried no dollar price; the backend controlled
output limits and did not accept temperature. Refreshes were serialized within one server process.
