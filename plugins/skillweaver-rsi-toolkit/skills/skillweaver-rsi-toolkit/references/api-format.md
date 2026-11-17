# API script format

An API is the PenguinHarness counterpart of upstream's Playwright skill function: one Node ES module in `APIS/<name>.mjs` that drives the agent browser through the shipped runtime `skillweaver-api.mjs`. `TOOL check <file>` enforces every rule marked **checked**; a file that fails one is dropped whole.

## Shape

```js
import { browser, runApi } from "./skillweaver-api.mjs";

export const meta = {
  name: "search_products_by_keyword",
  description:
    "Search the store for a keyword and return the products on the first result page, in page order. " +
    "The search is a substring match on product names; an empty result shows 'Your search returned no results.'",
  params: {
    keyword: { type: "string", description: "Words to search for, as a shopper would type them." },
  },
  returns: "An array of {name, price} for the first result page; [] when nothing matches.",
  usage_log: [
    "iter_3: keyword 'green tea' returned 12 products; prices are shown with a currency sign.",
  ],
};

export async function run({ keyword }) {
  browser.open("/catalogsearch/result/?q=" + encodeURIComponent(keyword));
  browser.waitFor("document.querySelector('.products, .message.notice')");
  return browser.exec(`
    return [...document.querySelectorAll('.product-item')].map((el) => ({
      name: el.querySelector('.product-item-link')?.textContent.trim(),
      price: el.querySelector('.price')?.textContent.trim(),
    }));
  `);
}

runApi(import.meta.url, meta, run);
```

## Rules

- **checked** The only import is `./skillweaver-api.mjs`; no dynamic `import()`, `require`, `process.exit` or `process.env`.
- **checked** `meta.name` is snake_case, 3–64 characters, equal to the file name, and does not start with `test_`, `verify_`, `explore_` or `check_`.
- **checked** `meta.description` documents the behaviour, including anything unexpected; `meta.returns` says what the result holds; `meta.usage_log` lists at least one observed use, as strings, and a new version keeps every earlier entry.
- **checked** `meta.params` maps snake_case names to `{type, description}` with `type` one of `string`, `number`, `boolean` (`optional: true` for one that may be left out). No name that is an id or a URL (`*_id`, `*_url`, `id`, `url`).
- **checked** `export async function run(args)` receives exactly those parameters. Its **first** browser call is `browser.open("/…")` with a site-relative path, which sets the page so the API works from anywhere; it makes at least two browser calls (a single click or read is not a skill).
- **checked** The file ends with `runApi(import.meta.url, meta, run);`, which runs it only when executed, checks the arguments, and prints the result.
- The browser calls are synchronous: `browser.open(path)`, `browser.exec(script)` (returns the script's `return` value; build any value into the script with `JSON.stringify`), `browser.click(selector, {index})`, `browser.type(text, {selector, submit})`, `browser.waitFor(jsExpression, {timeoutMs})`, `browser.text()`. Each throws when the browser reports a failure; let it, unless the API can truly recover.
- Prefer selectors on stable attributes and visible text over positions and generated class names; match counts and other numbers that change with a regular expression, never literally.
- Return plain JSON data (strings, numbers, booleans, arrays, objects), never DOM elements.
- No cookie-banner handling, no sign-in, and nothing outside the site.

Called as `node APIS/<name>.mjs --args '{"keyword":"green tea"}'`, the script prints `{"ok":true,"result":[…]}`, or `{"ok":false,"error":"…"}` with exit code 1 on a missing, unknown or mistyped argument or a failed browser call.
