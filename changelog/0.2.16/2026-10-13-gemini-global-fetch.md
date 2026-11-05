# Server: Google's official Gemini endpoint works again

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1088](https://github.com/Prism-Shadow/penguin-harness/pull/1088)

[中文版](2026-10-13-gemini-global-fetch.zh.md)

Requests to Google's official Gemini endpoint failed inside the server before they were sent, with `Unexpected HTTP client error: TypeError: Failed to parse URL from [object Request]`. The server's startup had replaced `globalThis.fetch` with the fetch of the npm `undici` package, and the Gemini SDK builds every call as a `Request` of the runtime's own class, which that fetch does not recognise. The startup now installs only the proxy dispatcher, and the runtime's own fetch, which reads the same process-wide dispatcher, sends every outbound request.

## Details

- The admin proxy settings apply as before: the application switch, an explicit `http(s)://` or `socks5://` address, the proxy variables, and local destinations going direct. A change still takes effect on the next request without a restart.
- A request body built with the global `FormData` class now goes out through the global fetch as multipart, rather than as the text `[object FormData]`.
