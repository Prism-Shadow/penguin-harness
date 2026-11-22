# Cost Center rate lines break where there is nothing to rate

- **Date:** 2026-11-19
- **Type:** fix
- **Scope:** `web`, `ui`
- **PR:** [#1611](https://github.com/Prism-Shadow/penguin-harness/pull/1611)

[中文版](2026-11-19-isolated-request-success-rates.zh.md)

A success rate measured in a single bucket drew nothing in the Requests charts, so the reader saw only the count bar and read its height against the percentage axis. The rate lines were redrawn: a lone rate became a point at its value on the right-hand axis, and a line joined only neighbouring buckets that both had a rate.

## Details

- The success-rate lines and the cache hit-rate curve stopped crossing a bucket with nothing to rate at the top of the axis (100%); the line broke there, and at every axis break. The hover table kept `0%` for a measured failure and a dash for nothing to rate.
- The legend of the two Requests charts named the axes: requests on the left, success rate on the right.
- The Requests, Token and Cost charts, and the company finance page's cost trend, became inspectable without a mouse: Tab focused a chart, the arrow keys and Home / End moved through its buckets, Esc closed the bubble, and a tap opened the bucket under it.
