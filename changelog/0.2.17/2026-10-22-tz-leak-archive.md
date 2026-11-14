# Benchmark export in any time zone, and no time-zone leak between server test files

- **Date:** 2026-10-22
- **Type:** fix
- **Scope:** `server`, `ci`
- **PR:** [#1298](https://github.com/Prism-Shadow/penguin-harness/pull/1298)

[中文版](2026-10-22-tz-leak-archive.zh.md)

A Benchmark's export no longer depends on the time zone the server process was in when it started, and the server suite's daylight-saving scenarios no longer leave a Windows test worker in another zone.

## Details

- The fixed time every exported entry carries (1980-01-01 00:00, in the local time a zip stores) is built when the zip is written instead of once at module load. Built at load, it read as 1979-12-31 once the process's zone had moved west of the zone it was built in, and the export answered 500 with `date not in range 1980-2099`. The exported bytes are unchanged. The export's same-bytes scenario also exports at UTC-11 and UTC+14.
- Server tests change the process's time zone through `test/helpers/time-zone.ts`, which puts the zone back by setting `TZ` to it before restoring `TZ` as it was. On Windows, Node moves the process's zone only when `TZ` is set, so deleting it had left `usage.test.ts`'s `America/New_York` in place for every later file in the same worker. Three export scenarios in `benchmarks-archive.test.ts` failed whenever that file ran after it in one worker, and the Windows server shard ran again in full.
