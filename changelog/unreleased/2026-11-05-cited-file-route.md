# A route that opens a file cited in an organization

- **Date:** 2026-11-05
- **Type:** feature
- **Scope:** `server`, `docs`
- **PR:** [#1483](https://github.com/Prism-Shadow/penguin-harness/pull/1483)
- **Issue:** [#1440](https://github.com/Prism-Shadow/penguin-harness/issues/1440)

[中文版](2026-11-05-cited-file-route.zh.md)

`GET /api/projects/:projectId/organizations/:orgId/file?path=<cited path>` returns a file an employee cited, for any member of the Project. The path is taken as written: `<app_data_dir>/…`, `~/…`, or absolute.

## Details

- The file must lie, after links are resolved, under the organization's handbook, its shared workspace, or the workspace of an employee in its chart. An employee whose workspace a person pointed at another directory counts too. The roots are read from the chart on each request.
- `.project_config.toml` and `.vault.toml` are refused wherever they lie, by the name written and by the name a link resolves to.
- Anything outside those roots answers `403 org_file_refused`. A missing file or a directory answers `404 org_file_not_found`, and a relative path answers `400 org_file_invalid`.
- The file is served the way the Files panel serves one: inline, `?download=1`, and HTML as text unless `?preview=1` asks for the sandboxed page.
