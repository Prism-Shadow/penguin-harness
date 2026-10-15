# Windows updates accept signing-certificate rotations

- **Date:** 2026-10-15
- **Type:** fix
- **Scope:** `desktop`, `web`, `ci`, `docs`
- **PR:** [#1144](https://github.com/Prism-Shadow/penguin-harness/pull/1144)

[中文版](2026-10-15-windows-update-signature.zh.md)

Windows updates stopped comparing signing-certificate names while retaining Authenticode validity checks and the update feed's SHA-512 verification. Cached installers were checked before becoming ready, and signatures were checked again before installation. Missing, invalid, or unverifiable signatures were refused.

An installer rejected by the final check was discarded, with an error shown in the web or native update flow. Checking for updates and downloading again remained available.

The web dialog stopped waiting for a restart when the shell reported installation failure, showing the error and retry action without waiting for the restart timeout.

## Details

The default EVSign invocation was retained without selecting the old certificate. Release verification made missing timestamps and mismatched signed-file metadata fatal. The security documentation recorded the reliance on publishing-channel security rather than a pinned publisher.

## Compatibility

Older clients retain their embedded publisher checks. They need a compatible transitional release or a manual installation to accept installers from the new signer. This change did not publish a transitional release or modify update feeds.
