# The Windows signing identity is NaisNet Technology Co., Ltd., and the updater keeps a list

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `desktop`, `ci`
- **PR:** [#477](https://github.com/Prism-Shadow/penguin-harness/pull/477)
- **Breaking:** yes — a Windows desktop client installed from 0.2.4 or earlier refuses this update and has to be reinstalled by hand

[中文版](2026-08-27-windows-signing-publisher.zh.md)

The certificate that Authenticode-signs the Windows desktop build changed subject: builds are
signed by `CN="NaisNet Technology Co., Ltd."`, issued by `Certum Extended Validation Code Signing
2021 CA`, where releases through v0.2.4 carried `RushRush Network Technology Ltd`. Both places that
named the old identity were reworked, in opposite directions — the build-time assertion stopped
pinning a name, and the name the updater checks became a list.

## Details

- `publisherName` in `packages/desktop/electron-builder.yml` is what electron-builder writes into
  the `app-update.yml` shipped inside the installer, and electron-updater verifies a downloaded
  update against it. It now lists the current identity and the previous one, each in the full-DN
  and bare-CN forms the verifier compares, so a client installed from this release still accepts a
  build signed by the next certificate. Removing the key was considered and is not available: a
  missing `publisherName` makes electron-updater skip update-signature verification altogether and
  install whatever it downloaded.
- The release job's checks in `.github/workflows/desktop-build.yml` asserted one exact organisation
  name and failed the whole Windows desktop job on the rotation. Both desktop verify steps were
  redrawn along one line: a release stops only when a required build output is missing, an artifact
  that must be signed carries no signature, or a signature is present and does not validate.
  Everything else those steps look at — which organisation signed, what `app-update.yml` records,
  whether `latest.yml` still describes the installer, whether a notarization ticket or Gatekeeper
  assessment comes back clean — is now a `::warning` carrying the values it saw, on the run summary
  and in the log, and the step exits 0. The macOS step keeps `codesign --verify --deep --strict` as
  a hard failure and warns on `stapler validate` and `spctl --assess`; notarization is still
  performed and failed hard by the notarize step ahead of it. The required-output checks, the
  `REQUIRE_WINDOWS_SIGNING` dry-run gate and the separate check that authenticates the downloaded
  EVSign CLI before it is handed a signing key are unchanged.
- The Linux packages and the CLI installers are not involved; neither verifies a Windows publisher
  name.

## Compatibility

electron-updater checks a downloaded update against the publisher list recorded in **the installed
app's** `app-update.yml`, written once at install time. A Windows desktop client installed from
0.2.4 or earlier holds only `RushRush Network Technology Ltd` there, so it rejects a NaisNet-signed
installer and stays on the version it has. Reinstall once from
[penguin.ooo/download](https://penguin.ooo/download); the reinstall touches nothing under
`~/.penguin/data`, and from that install onward auto-update works again and accepts either
identity. Recorded with the rest of this release's compatibility handling in
[backward compatibility](2026-08-25-backward-compatibility.md).
