# Landing homepage leads with the desktop app

The homepage now presents the desktop download as the first install path; CLI and self-host content sits below the fold at the quick start.

- Hero: the CLI one-liner install box is replaced by a platform-aware "Download for \<OS\>" primary button linking to `/download` (generic label when detection fails), an "All platforms" line, and a "CLI and self-hosted install ↓" link down to the quick start; the GitHub button stays.
- Closing CTA: primary → `/download`, secondary → quick start; "Read the docs" kept.
- Quick start step 1's desktop note now reads from the "already on the desktop app?" angle (shared local data root), still linking to the download page.
- OS detection is extracted to `src/lib/platform.ts` and shared by the hero and the download page; the `/download` page itself — artifact links, mirror resolution, checksums, first-launch FAQ — is unchanged, as are the section order, nav anchors, and route shells.
