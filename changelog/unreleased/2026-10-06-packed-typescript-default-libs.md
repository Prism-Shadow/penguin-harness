# The desktop package carries TypeScript's default library, and a pushed compiler comes first

- **Date:** 2026-10-06
- **Type:** fix
- **Scope:** `desktop`, `server`

[中文版](2026-10-06-packed-typescript-default-libs.zh.md)

On a machine running a desktop package built after the compiler was staged into it, every workflow failed to load: `.build/status.json` said `ok: false` with `…/resources/app/dist/node_modules/typescript/lib/lib.es2022.full.d.ts not found`.

- The desktop package now carries the compiler's default library files (`lib.*.d.ts`) beside its entry. electron-builder leaves every `*.d.ts` out of `files`, so they travel as extra resources into the same directory.
- `verify-packed-cli.mjs` fails a packed app that lacks any file of the staged compiler.
- The server looks for the compiler in the assets a push carried first, then beside its own module, then beside the running program. The push's copy used to come last.
- A compiler whose default library files are missing is passed over for the next place. When none can be used, the error says what each place lacked, naming the missing file.

A machine that already has an incomplete package recovers with its next push; it does not need to be reinstalled.
