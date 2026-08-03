# Tooling: Alibaba Cloud OSS distribution for Release assets

Release downloads no longer depend on GitHub's reachability alone (#166).

- A new `mirror-oss` release job downloads the exact assets attached to the GitHub Release, re-verifies their checksums, and mirrors the same bytes to an Alibaba Cloud OSS bucket; `latest.json` is uploaded last and only after every asset landed, so the mirror never advertises a partially mirrored version. The job reads its provider/role ARNs and bucket settings from the `oss-production` environment and fails fast with a named error when one is missing.
- `install.sh` / `install.ps1` gain a download-source switch: `PENGUIN_DOWNLOAD_SOURCE=auto` (default) prefers the OSS mirror and falls back to the same version on GitHub when the mirror is unavailable; `oss` and `github` pin one source. `PENGUIN_DOWNLOAD_BASE_URL` / `PENGUIN_DOWNLOAD_FALLBACK_BASE_URL` override the asset directories directly (https-validated), and download progress names the source it is actually using.
- An `oss-staging` workflow plus `scripts/publish-release-to-oss.sh`, `scripts/install-ossutil.sh` and `scripts/test-oss-staging.sh` exercise the mirror path end to end before production, and the hermetic installer tests cover the source switch on both platforms.
- The installation docs document the download-source row for both languages.
