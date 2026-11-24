# Documented the CLI used by the development server

- **Date:** 2026-11-24
- **Type:** process
- **Scope:** `tooling`, `docs`

[中文版](2026-11-24-dev-cli-launcher-guide.zh.md)

The contributor guide now explains when the development server runs the CLI from source.

## Details

The launcher uses the checkout's TypeScript source when the server runs from source and
can resolve `tsx`. The guide also explains the built CLI fallback and when to rebuild it.
