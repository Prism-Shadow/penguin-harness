# A route group's auth flag holds wherever the group is mounted

- **Date:** 2026-09-18
- **Type:** fix
- **Scope:** `server`
- **PR:** [#793](https://github.com/Prism-Shadow/penguin-harness/pull/793)

[中文版](2026-09-18-route-group-auth-per-group.zh.md)

The platform's HTTP surface mounted its sign-in gate once, on `/api/*`, ahead of the first
protected route group. The gate is now mounted on each protected group's own prefix, so a group's
`auth` flag no longer depends on its `order`.

## Details

- A group contributed with `auth: "none"` under `/api` stays public when it is ordered after a
  protected group. Before, it answered 401 to a request without a session.
- A protected group is gated on its own prefix, the bare prefix included, whether or not the prefix
  is under `/api`. A request whose path passes several protected prefixes is authenticated once.
- A path that no route group serves is declined by the platform and answers 404. Before, such a
  path under `/api` answered 401 to a request without a session.
- In the `GET /api/contributions` response, a contribution's `id` and `from` are always the
  server's own. Before, a contribution whose data carried a field of either name replaced it.
