# Desktop installers on the OSS mirror, and a landing download page

## Distribution

Desktop installers move to version-less artifact names following the CLI bundle convention — `penguin-desktop-darwin-{arm64,x64}.dmg` / `.zip`, `penguin-desktop-win32-x64.exe`, `penguin-desktop-linux-x86_64.AppImage` / `penguin-desktop-linux-amd64.deb` — with the version carried by the Release tag and `SHA256SUMS.desktop`. The OSS mirror job now mirrors all seven installers plus `SHA256SUMS.desktop` into the immutable per-tag prefix, verified as a set through `SHA256SUMS.desktop`; the CLI bundles' canonical manifest is unchanged.

## Landing site

New `/download` page in the classic software-download shape: one card per platform with the visitor's OS badged, click-to-download buttons that start on GitHub's static `releases/latest/download/<name>` links and swap to the OSS mirror's per-tag URLs once the bucket's `latest.json` pointer resolves client-side (validated exactly like the installer forwarders validate it — a failed fetch, e.g. missing CORS, silently keeps the GitHub links), a manual GitHub/OSS source toggle, checksum and all-releases links, and the unsigned-build first-launch notes. The nav (landing and its docs parity copy), footer, quick-start hint, sitemap and Pages route shells are wired accordingly, and the README (en/zh) gains a desktop app install section pointing at the page.
