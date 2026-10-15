# Windows signing transition candidate

- **Date:** 2026-10-15
- **Type:** fix
- **Scope:** `desktop`, `web`, `ci`, `docs`

[中文版](2026-10-15-windows-signing-transition.zh.md)

Windows updates kept electron-updater's SHA-512 integrity check and required a valid Authenticode signature without matching publisher names, certificate fingerprints or certificate authorities. Cached installers received the same trust check before becoming available to install. Verification errors, timeouts and unexpected output were rejected.

Signatures were checked again before installation. A rejected installer was discarded, with an error shown in the web or native update flow. Checking for updates and downloading again remained available.

The web dialog stopped waiting for a restart when the shell reported installation failure, showing the error and retry action without waiting for the restart timeout.

## Details

The transition candidate selected EVSign's `-cert 2021` certificate. Build acceptance required valid NaisNet Technology Co., Ltd. signatures and timestamps for the application, elevation helper, NSIS uninstaller and final installer. Final acceptance checked update metadata, regenerated the blockmap for comparison and ran the legacy publisher verifier against the installer. The application identity, version and update sources were preserved.

Update origin trust relies primarily on the GitHub/OSS distribution channels and their account security after removing publisher matching. An ordinary hash does not independently authenticate the source. No signed-manifest system was introduced.
