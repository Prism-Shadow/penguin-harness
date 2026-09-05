# @prismshadow/penguin-plugin-languages

Syntax highlighting for **Typst, Swift, Kotlin, C# and Dart** in PenguinHarness.

## Install

Add the specifier to your deployment's `plugins.json` and restart, or push a platform that
carries it:

```json
{ "plugins": ["@prismshadow/penguin-plugin-languages"] }
```

Code fences and the Workspace file viewer pick the new languages up on the next page load. No
configuration.

| Language | Fence | File plugins |
| --- | --- | --- |
| Typst | `typst`, `typ` | `.typ` |
| Swift | `swift` | `.swift` |
| Kotlin | `kotlin`, `kt`, `kts` | `.kt`, `.kts` |
| C# | `csharp`, `cs`, `c#` | `.cs` |
| Dart | `dart` | `.dart` |

## How it works

The Web App resolves its bundled grammars at build time, so installing something cannot grow that
set. This package hands the server five TextMate grammars instead; the App fetches each one the
first time a conversation shows that language and loads it into the same Shiki core as a bundled
grammar.

A grammar is data, not code — a document Shiki's JavaScript regex engine interprets. Nothing on
the path from this package to the browser evaluates anything it ships.

The grammars are re-exported from [`@shikijs/langs`](https://github.com/shikijs/shiki), the same
package the App's own grammars come from, so each is the exact document the bundled path would
have loaded. Upstream attribution and licensing ride with that package.

## Why not just bundle them

The App carries the languages a session most often shows and stops there on purpose: importing
Shiki's full bundle costs an oniguruma WASM chunk and a 332-grammar registry on the *first* code
block of a conversation — about 230 KB gzip before a single token is colored. A plugin is how
a deployment pays for the languages it actually reads, and nothing more.

## License

MIT.
