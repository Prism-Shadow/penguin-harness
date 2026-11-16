# @prismshadow/penguin-theme-pack

Reads, validates and writes PenguinHarness theme packs (PRFC-0026). A pack is a folder with a
`pack.json` manifest and a few stylesheets. An admin imports one per server as a zip, and any
pack, built-in or imported, exports to the same zip.

```ts
import { readPackArchive, validateThemePack } from "@prismshadow/penguin-theme-pack";

const pack = await validateThemePack(readPackArchive(zip), { api: 1, tokens });
// pack.files: what is kept (re-emitted stylesheets, no index.css)
// pack.indexCss: the stylesheet the browser loads, layered, urls on the files route at pack.v
```

A refusal is a `ThemePackError` with a `kind` (`invalid`, `too_large`, `api_unsupported`) and a
`problem` naming the file, the reason and, inside a stylesheet or the manifest, the line and
column.

The server runs this at import. The UI package's suite runs the same validator over the built-in
packs in their export form (`builtinExportFiles`), so a built-in can never do what an import may
not. The package is private and is consumed as TypeScript source; the server's build inlines it.
