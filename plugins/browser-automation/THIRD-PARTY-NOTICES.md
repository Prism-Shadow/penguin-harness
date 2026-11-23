# Third-party notices

This package adapts the following third-party code.

## GenericAgent — the built-in browser's page scripts

The page scripts under `src/server/page-scripts/` (the DOM simplification that `penguin browser
scan` returns, and the change monitor behind `penguin browser exec`), bundled into `dist/index.js`,
are ported from GenericAgent's `simphtml.py`; each ported file says so at its top. The
`penguin browser` commands and the `browser-automation` skill follow GenericAgent's `web_scan` /
`web_execute_js` tools and its browser operating notes.

**License: MIT**, reproduced in full:

```text
MIT License

Copyright (c) 2025 lsdefine

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
