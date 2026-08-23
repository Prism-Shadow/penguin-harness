# Boot-failure recovery re-boots the version that was actually running

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `server`

[中文版](2026-08-23-hot-update-recovery-reboots-the-running-version.zh.md)

When a pushed platform failed to boot, the host
[re-booted the previous version](2026-08-20-hot-update-failure-modes.md) from the parked
document — but chose *which* bundle to re-boot by comparing the running bundle's `id`
against the packaged default's, and falling back to `harness.json` when they differed.
Neither signal identified the running version. A push delivers the packaged export itself,
so every bundle `scripts/deploy.mjs` built carried the packaged id and the comparison never
fired; and the manifest names the last version written to disk, which is a different
version whenever a push landed live but could not be persisted.

On a machine that had been deployed to, a failed push therefore dropped the live process
back to the platform the installation shipped with: the endpoints that deployment had added
stopped answering, the only error reported was the push's own, and the next restart brought
them back — so the running code and the committed code disagreed with nothing to say so.

Recovery re-boots the bundle that was running, held as the loaded object rather than
re-derived, so it is the same version by construction in both cases.

## Details

- The host records the platform bundle behind every successful boot — the packaged
  default, a version restored from `harness.json`, and a pushed version alike — and
  boot-failure recovery re-boots that object against the parked document the kernel hands
  back.
- Recovery no longer reads `harness.json` or re-imports from the store, so it also works
  for a version whose push reported `persisted: false`.
