# The community health files GitHub looks for, all under .github/

- **Date:** 2026-08-27
- **Type:** process
- **Scope:** `docs`, `tooling`
- **PR:** [#514](https://github.com/Prism-Shadow/penguin-harness/pull/514)

[中文版](2026-08-27-community-standards.zh.md)

GitHub's Community Standards page listed five unchecked entries — code of conduct,
contributing, security policy, issue templates, pull request template. All five were
written, and every file GitHub recognizes from inside `.github/` was placed there, so the
repository root gains nothing but keeps `README.md`, `CHANGELOG.md` and `LICENSE`.

## Details

- `CONTRIBUTING.md` **moved** from the root to `.github/CONTRIBUTING.md` (a rename, not a
  copy) with its content intact and its repo-relative links re-anchored one level up. It
  gained a Code of Conduct and security-policy pointer at the top, a section on filing a
  bug or a feature request, and a pull-request bullet naming the English title, the
  `## Verification` section and the template. `README.md`, `README.zh.md`,
  `.github/workflows/release.yml` and the `penguin-harness-dev` skill now point at the new
  path.
- `.github/CODE_OF_CONDUCT.md` is the Contributor Covenant 2.1 verbatim, with
  <hiyouga@buaa.edu.cn> as the enforcement contact. Its Chinese counterpart is the
  Covenant's own zh-cn translation, so neither file is a paraphrase and a later version
  bump is a clean diff against upstream.
- `.github/SECURITY.md` routes reports to GitHub's private "Report a vulnerability" form,
  with the maintainer's address as the fallback, and states that only the most recent
  release is supported — the project is pre-1.0, ships from `main`, and backports nothing.
  It also draws the scope line the product needs: an approval bypass, a `[command_policy]`
  evasion, a credential reaching a log or a Trace, and a break in the server's multi-user
  boundary are in scope, while an agent doing what an approved tool call permits is the
  documented design.
- `.github/ISSUE_TEMPLATE/` holds `bug_report.yml` and `feature_request.yml` as form
  schemas, plus a `config.yml` that turns off blank issues and links Discord, the docs and
  the security advisory form. The bug form asks for the version (`penguin version`), the
  install shape, the OS, and whether the problem survives a fresh data root; both forms and
  the contributor guide state plainly that a config file, a `.env` or a full log is likely
  to carry a provider key or a bot token and does not belong in a public issue.
- `.github/PULL_REQUEST_TEMPLATE.md` asks for what changed, a `## Verification` section
  naming what was run, and a changelog entry pair under `changelog/unreleased/`.
- The two documents a reporter or a newcomer reads rather than a maintainer — the Code of
  Conduct and the security policy — ship with `.zh.md` counterparts, as does the
  contributor guide. The GitHub-rendered templates do not: GitHub selects neither an issue
  form nor a pull request template by language, so a `.zh` twin would either be ignored or
  double the entries in the issue picker.
