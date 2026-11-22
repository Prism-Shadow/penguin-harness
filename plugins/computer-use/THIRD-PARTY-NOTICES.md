# Third-party notices

## agent-desktop

<https://github.com/vercel-labs/agent-desktop>, by vercel-labs. **License: Apache-2.0**; its full text is this package's `LICENSE` (the same licence). The upstream repository carries no `NOTICE` file.

- **Adapted into this package**: `skills/computer-use/SKILL.md` and its `reference/` files are adapted from the guides agent-desktop 1.3.1 bundles (`agent-desktop skills get desktop` and `skills get platform`). Each file says so and how it was changed: rewritten for `penguin computer` and this plugin's policy, shortened, and safety rules added.
- **Not redistributed**: the agent-desktop program is downloaded at run time from the npm registry (`agent-desktop@1.3.1`), checked against the digests in `src/pin.ts`, and kept under the server's data root. It keeps its own licence.
