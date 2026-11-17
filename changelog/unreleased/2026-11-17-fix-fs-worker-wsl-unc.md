# Core: map WSL UNC paths inside the sandboxed file helper

- **Date:** 2026-11-17
- **Type:** fix
- **Scope:** `core`

[中文版](2026-11-17-fix-fs-worker-wsl-unc.zh.md)

Under the WSL sandbox backend (`#1570`), `toLinuxPath` translates `\\wsl.localhost\<distro>\...` and `\\wsl$\<distro>\...` workspaces into POSIX paths for bwrap, but the file-tool helper (`FS_WORKER_SOURCE` in `packages/core/src/environment/tools/fs-worker.ts`) only mapped Windows drive-letter paths (`C:\...`). Confined `read_file`, `edit_file`, and `write_file` calls against a WSL UNC workspace failed inside Linux with `ENOENT`.

## Details

- `toLocal` and `fromLocal` in `FS_WORKER_SOURCE` now recognize `\\wsl.localhost\<distro>\...`, `\\wsl$\<distro>\...`, and `\\?\UNC\...` WSL paths when `<distro>` matches `process.env.WSL_DISTRO_NAME` case-insensitively, mapping them to `/...` inside the distro and back to the caller's UNC prefix on `realpath`/`readlink` answers.
- Paths targeting another distro or seen outside WSL (empty `WSL_DISTRO_NAME`) remain untouched.
- Added worker round-trip tests in `packages/core/test/sandbox-fs-helper.test.ts`.
